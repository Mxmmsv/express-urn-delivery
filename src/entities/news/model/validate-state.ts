import type { NewsItem, NewsState } from "./types.js";

const snowflake = /^\d{17,20}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isSnowflake(value: unknown): value is string {
  return typeof value === "string" && snowflake.test(value);
}

function isUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

export function isNewsItem(value: unknown): value is NewsItem {
  return (
    isRecord(value) &&
    isId(value.id) &&
    isId(value.title) &&
    isUrl(value.url) &&
    typeof value.text === "string" &&
    (value.publishedAt === null ||
      (typeof value.publishedAt === "string" &&
        Number.isFinite(Date.parse(value.publishedAt)))) &&
    (value.imageUrl === null || isUrl(value.imageUrl))
  );
}

export function isNewsState(value: unknown): value is NewsState {
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.guilds))
    return false;
  for (const [guildId, guild] of Object.entries(value.guilds)) {
    if (
      !isSnowflake(guildId) ||
      !isRecord(guild) ||
      !Array.isArray(guild.knownIds) ||
      !guild.knownIds.every(isId) ||
      !Array.isArray(guild.pending) ||
      !Array.isArray(guild.delivered)
    )
      return false;
    const knownIds = new Set<string>(guild.knownIds);
    if (knownIds.size !== guild.knownIds.length) return false;
    const queuedIds = new Set<string>();
    for (const entry of guild.pending as unknown[]) {
      if (!isRecord(entry) || !isNewsItem(entry.news)) return false;
      const attempt = entry.attempt;
      if (
        attempt !== null &&
        (!isRecord(attempt) ||
          !isSnowflake(attempt.channelId) ||
          (attempt.boundaryMessageId !== null &&
            !isSnowflake(attempt.boundaryMessageId)) ||
          typeof attempt.nonce !== "string" ||
          !/^[a-f0-9]{24}$/.test(attempt.nonce))
      )
        return false;
      if (!knownIds.has(entry.news.id) || queuedIds.has(entry.news.id))
        return false;
      queuedIds.add(entry.news.id);
    }
    const deliveredIds = new Set<string>();
    for (const receipt of guild.delivered as unknown[]) {
      if (
        !isRecord(receipt) ||
        !isId(receipt.newsId) ||
        !isSnowflake(receipt.channelId) ||
        !isSnowflake(receipt.messageId) ||
        !knownIds.has(receipt.newsId) ||
        queuedIds.has(receipt.newsId) ||
        deliveredIds.has(receipt.newsId)
      )
        return false;
      deliveredIds.add(receipt.newsId);
    }
  }
  return true;
}
