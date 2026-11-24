import {
  type NewsItem,
  undeadlockNewsIdPrefix,
} from "../../../entities/news/index.js";

const origin = "https://undeadlock.com";

interface PatchEntry {
  id: number;
  news: NewsItem | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCursor(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function parseEntry(entry: unknown): PatchEntry {
  if (!isRecord(entry) || !isCursor(entry.id) || !isRecord(entry.view)) {
    throw new Error("Invalid unDeadlock patch entry.");
  }
  const { official, patch } = entry.view;
  if (isRecord(official)) return { id: entry.id, news: null };
  if (
    official !== null ||
    !isRecord(patch) ||
    typeof patch.slug !== "string" ||
    !/^\d{4}-\d{2}-\d{2}-\d+$/.test(patch.slug) ||
    typeof entry.date !== "string" ||
    !Number.isFinite(Date.parse(entry.date))
  ) {
    throw new Error("Invalid unDeadlock patch details.");
  }
  const title = typeof entry.headline === "string" ? entry.headline.trim() : "";
  if (!title && !isCursor(entry.toVersion)) {
    throw new Error("Missing unDeadlock patch title and build number.");
  }
  const url = `${origin}/ru/patches/${patch.slug}`;
  return {
    id: entry.id,
    news: {
      id: `${undeadlockNewsIdPrefix}${entry.id}`,
      title: title || `Сборка ${String(entry.toVersion)}`,
      url,
      publishedAt: entry.date,
      text: typeof entry.tldr === "string" ? entry.tldr : "",
      imageUrl: `${url}/card/16x9`,
    },
  };
}

async function fetchPatchPage(
  signal: AbortSignal,
  direction: "after" | "before",
  cursor?: number,
) {
  const url = new URL("/api/patch-feed?locale=ru", origin);
  if (cursor !== undefined) url.searchParams.set(direction, String(cursor));
  const response = await fetch(url, {
    signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`unDeadlock patch feed returned HTTP ${response.status}.`);
  }
  const page: unknown = await response.json();
  if (
    !isRecord(page) ||
    !Array.isArray(page.entries) ||
    (page.nextCursor !== null && !isCursor(page.nextCursor))
  ) {
    throw new Error("Invalid unDeadlock patch feed.");
  }
  const entries = page.entries.map(parseEntry).sort((a, b) => a.id - b.id);
  const edge = direction === "after" ? entries.at(-1) : entries[0];
  if (
    (page.nextCursor !== null && page.nextCursor !== edge?.id) ||
    entries.some(
      (entry, index) =>
        entry.id === entries[index - 1]?.id ||
        (cursor !== undefined &&
          (direction === "after" ? entry.id <= cursor : entry.id >= cursor)),
    )
  ) {
    throw new Error("Invalid unDeadlock patch feed pagination.");
  }
  return { entries, nextCursor: page.nextCursor };
}

export async function fetchLatestUndeadlockPatch(signal: AbortSignal) {
  let page = await fetchPatchPage(signal, "before");
  const cursor = page.entries.at(-1)?.id;
  if (cursor === undefined) return;

  while (true) {
    for (const entry of page.entries.reverse()) {
      if (entry.news) return { cursor, news: [entry.news] };
    }
    if (page.nextCursor === null) return { cursor, news: [] };
    page = await fetchPatchPage(signal, "before", page.nextCursor);
  }
}

export async function fetchUndeadlockPatchesAfter(
  cursor: number,
  signal: AbortSignal,
): Promise<PatchEntry[]> {
  const entries: PatchEntry[] = [];
  let nextCursor: number | null = cursor;
  while (nextCursor !== null) {
    const page = await fetchPatchPage(signal, "after", nextCursor);
    entries.push(...page.entries);
    nextCursor = page.nextCursor;
  }
  return entries;
}
