import { XMLParser, XMLValidator } from "fast-xml-parser";
import { convert } from "html-to-text";

import type { NewsItem } from "../../../entities/news/index.js";

export const steamRssUrl = "https://steamcommunity.com/games/1422450/rss";

const parser = new XMLParser({
  parseTagValue: false,
  trimValues: true,
  isArray: (_name, path) => path === "rss.channel.item",
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (isRecord(value) && typeof value["#text"] === "string")
    return value["#text"].trim();
  return "";
}

function readUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.href
      : null;
  } catch {
    return null;
  }
}

function readDescription(html: string): {
  text: string;
  imageUrl: string | null;
} {
  let imageUrl: string | null = null;
  const text = convert(html, {
    wordwrap: false,
    selectors: [
      { selector: "img", format: "newsImage" },
      { selector: "a", options: { ignoreHref: true } },
      { selector: "h1", options: { uppercase: false } },
      { selector: "h2", options: { uppercase: false } },
      { selector: "h3", options: { uppercase: false } },
    ],
    formatters: {
      newsImage: (element: { attribs?: Record<string, string> }) => {
        const fallback = element.attribs?.["data-fallback-src"];
        const src = element.attribs?.src;
        if (!imageUrl) {
          imageUrl =
            (fallback ? readUrl(fallback) : null) ||
            (src ? readUrl(src) : null);
        }
      },
    },
  }).trim();
  return { text, imageUrl };
}

export function parseSteamRss(xml: string): NewsItem[] {
  const validation = XMLValidator.validate(xml);
  if (validation !== true)
    throw new Error(`Invalid Steam RSS XML: ${validation.err.msg}`);
  const document: unknown = parser.parse(xml);
  if (
    !isRecord(document) ||
    !isRecord(document.rss) ||
    !isRecord(document.rss.channel)
  ) {
    throw new Error("Invalid Steam RSS: expected an RSS channel.");
  }
  const rawItems: unknown = document.rss.channel.item;
  if (rawItems === undefined) return [];
  if (!Array.isArray(rawItems))
    throw new Error("Invalid Steam RSS: expected news items.");

  const news: NewsItem[] = [];
  const seen = new Set<string>();
  for (const item of rawItems as unknown[]) {
    if (!isRecord(item)) {
      console.warn("Skipping a malformed Steam RSS item.");
      continue;
    }
    const url = readUrl(readText(item.link));
    const title = convert(readText(item.title), { wordwrap: false }).trim();
    const id = readText(item.guid) || url;
    if (!url || !title || !id) {
      console.warn(
        "Skipping a Steam RSS item with a missing ID, title, or valid link.",
      );
      continue;
    }
    if (seen.has(id)) continue;
    const timestamp = Date.parse(readText(item.pubDate));
    news.push({
      id,
      title,
      url,
      publishedAt: Number.isFinite(timestamp)
        ? new Date(timestamp).toISOString()
        : null,
      ...readDescription(readText(item.description)),
    });
    seen.add(id);
  }
  if (rawItems.length > 0 && news.length === 0) {
    throw new Error(
      "Steam RSS contains no valid news items. History was not changed.",
    );
  }
  return news
    .reverse()
    .sort((a, b) =>
      a.publishedAt && b.publishedAt
        ? Date.parse(a.publishedAt) - Date.parse(b.publishedAt)
        : 0,
    );
}

export async function fetchSteamNews(signal: AbortSignal): Promise<NewsItem[]> {
  const response = await fetch(steamRssUrl, {
    signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
    headers: { Accept: "application/rss+xml, application/xml, text/xml" },
  });
  if (!response.ok)
    throw new Error(`Steam RSS request failed with HTTP ${response.status}.`);
  return parseSteamRss(await response.text());
}
