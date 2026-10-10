import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { getProjectPath } from "../../../shared/lib/project-path.js";
import type {
  DeliveryAttempt,
  DeliveryReceipt,
  NewsItem,
  NewsState,
  PendingNews,
} from "./types.js";
import { isNewsState } from "./validate-state.js";

export function createNewsStore() {
  const path = getProjectPath("data", "news-state.json");
  let state: NewsState = { version: 1, guilds: {} };
  let loaded = false;
  let pendingWrite: Promise<void> = Promise.resolve();

  async function load(): Promise<void> {
    let content: string;
    try {
      content = await readFile(path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        loaded = true;
        return;
      }
      throw error;
    }
    const data: unknown = JSON.parse(content);
    if (!isNewsState(data))
      throw new Error(
        "Invalid news history. Delivery is paused to preserve existing records.",
      );
    state = data;
    loaded = true;
  }

  function change(update: (next: NewsState) => boolean): Promise<void> {
    const write = pendingWrite.then(async () => {
      if (!loaded) throw new Error("Load news history before updating it.");
      const next = structuredClone(state);
      if (!update(next)) return;
      await mkdir(dirname(path), { recursive: true });
      const temporaryPath = `${path}.tmp`;
      await writeFile(
        temporaryPath,
        `${JSON.stringify(next, null, 2)}\n`,
        "utf8",
      );
      await rename(temporaryPath, path);
      state = next;
    });
    pendingWrite = write.catch(() => undefined);
    return write;
  }

  function synchronize(
    guildId: string,
    news: readonly NewsItem[],
  ): Promise<void> {
    const snapshot = structuredClone(news);
    return change((next) => {
      if (snapshot.length === 0) return false;
      const guild = next.guilds[guildId];
      if (!guild) {
        const latest = snapshot.at(-1);
        if (!latest) return false;
        next.guilds[guildId] = {
          knownIds: snapshot.map((item) => item.id),
          pending: [{ news: latest, attempt: null }],
          delivered: [],
        };
        return true;
      }
      const known = new Set(guild.knownIds);
      const unseen = snapshot.filter((item) => !known.has(item.id));
      if (!unseen.length) return false;
      guild.knownIds.push(...unseen.map((item) => item.id));
      guild.pending.push(
        ...unseen.map((item) => ({ news: item, attempt: null })),
      );
      guild.pending.sort((a, b) =>
        a.news.publishedAt && b.news.publishedAt
          ? Date.parse(a.news.publishedAt) - Date.parse(b.news.publishedAt)
          : 0,
      );
      return true;
    });
  }

  function getPending(guildId: string): PendingNews[] {
    return structuredClone(state.guilds[guildId]?.pending ?? []);
  }

  function beginAttempt(
    guildId: string,
    newsId: string,
    attempt: DeliveryAttempt,
  ): Promise<void> {
    const snapshot = structuredClone(attempt);
    return change((next) => {
      const entry = next.guilds[guildId]?.pending.find(
        (item) => item.news.id === newsId,
      );
      if (!entry)
        throw new Error(`News ${newsId} is not queued for guild ${guildId}.`);
      entry.attempt = snapshot;
      return true;
    });
  }

  function markDelivered(
    guildId: string,
    receipt: DeliveryReceipt,
  ): Promise<void> {
    const snapshot = structuredClone(receipt);
    return change((next) => {
      const guild = next.guilds[guildId];
      if (!guild)
        throw new Error(`No news history exists for guild ${guildId}.`);
      if (guild.delivered.some((item) => item.newsId === snapshot.newsId))
        return false;
      const index = guild.pending.findIndex(
        (item) => item.news.id === snapshot.newsId,
      );
      if (index === -1)
        throw new Error(
          `News ${snapshot.newsId} is not queued for guild ${guildId}.`,
        );
      guild.pending.splice(index, 1);
      guild.delivered.push(snapshot);
      return true;
    });
  }

  async function waitForWrites(): Promise<void> {
    await pendingWrite;
  }

  return {
    load,
    synchronize,
    getPending,
    beginAttempt,
    markDelivered,
    waitForWrites,
  };
}

export type NewsStore = ReturnType<typeof createNewsStore>;
