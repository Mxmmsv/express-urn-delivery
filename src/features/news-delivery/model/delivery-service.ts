import type { Client } from "discord.js";

import type { GuildSettingsStore } from "../../../entities/guild-settings/index.js";
import type { NewsStore } from "../../../entities/news/index.js";
import { sendNews } from "../api/send-news.js";
import { fetchSteamNews } from "../api/steam-rss.js";
import {
  fetchLatestUndeadlockPatch,
  fetchUndeadlockPatchesAfter,
} from "../api/undeadlock.js";

interface DeliveryOptions {
  client: Client;
  settingsStore: GuildSettingsStore;
  newsStore: NewsStore;
  pollIntervalMs: number;
}

export function createNewsDelivery({
  client,
  settingsStore,
  newsStore,
  pollIntervalMs,
}: DeliveryOptions) {
  let running = false;
  let stopPolls: (() => Promise<void>)[] = [];
  let delivery = Promise.resolve();

  function isRunning(): boolean {
    return running && client.isReady();
  }

  function configuredGuildIds(): string[] {
    return settingsStore
      .list()
      .filter(
        ({ guildId, settings }) =>
          settings.channelId && client.guilds.cache.has(guildId),
      )
      .map(({ guildId }) => guildId);
  }

  async function pollSteam(signal: AbortSignal): Promise<void> {
    const feed = await fetchSteamNews(signal);
    for (const guildId of configuredGuildIds()) {
      if (!isRunning()) return;
      await newsStore.synchronize(guildId, feed);
    }
  }

  async function pollUndeadlock(signal: AbortSignal): Promise<void> {
    const guilds = configuredGuildIds().map((id) => ({
      id,
      cursor: newsStore.getUndeadlockCursor(id),
    }));
    if (!guilds.length) return;
    const cursors = guilds.flatMap(({ cursor }) =>
      cursor === undefined ? [] : [cursor],
    );
    if (cursors.length) {
      const patches = await fetchUndeadlockPatchesAfter(
        Math.min(...cursors),
        signal,
      );
      const latest = patches.at(-1);
      if (latest) {
        for (const { id, cursor } of guilds) {
          if (!isRunning()) return;
          if (cursor === undefined || cursor >= latest.id) continue;
          const news = patches.flatMap((patch) =>
            patch.id > cursor && patch.news ? [patch.news] : [],
          );
          await newsStore.synchronizeUndeadlock(id, latest.id, news);
        }
      }
    }
    const newGuilds = guilds.filter(({ cursor }) => cursor === undefined);
    if (!newGuilds.length || !isRunning()) return;
    const initial = await fetchLatestUndeadlockPatch(signal);
    if (!initial) return;
    for (const { id } of newGuilds) {
      if (!isRunning()) return;
      await newsStore.synchronizeUndeadlock(id, initial.cursor, initial.news);
    }
  }

  async function deliverPending(): Promise<void> {
    for (const guildId of configuredGuildIds()) {
      if (!isRunning()) return;
      const guild = client.guilds.cache.get(guildId);
      if (!guild) continue;
      try {
        for (const entry of newsStore.getPending(guildId)) {
          if (!isRunning()) return;
          const result = await sendNews(
            guild,
            entry,
            settingsStore,
            newsStore,
            isRunning,
          );
          if (result.status === "deferred") {
            if (running)
              console.warn(
                `News delivery deferred for guild ${guildId}: ${result.reason}`,
              );
            break;
          }
          await newsStore.markDelivered(guildId, result.receipt);
          console.log(
            `Delivered news ${entry.news.id} to guild ${guildId}, channel ${result.receipt.channelId}.`,
          );
        }
      } catch (error) {
        console.error(
          `Failed to deliver news to guild ${guildId}. Pending news will be retried:`,
          error,
        );
      }
    }
  }

  function startPolling(
    source: string,
    poll: (signal: AbortSignal) => Promise<void>,
  ): () => Promise<void> {
    const request = new AbortController();
    let timer: NodeJS.Timeout | undefined;
    let activeCycle: Promise<void>;
    let failures = 0;

    async function runCycle(): Promise<void> {
      let delay = pollIntervalMs;
      if (isRunning()) {
        try {
          await poll(request.signal);
          failures = 0;
        } catch (error) {
          if (!running) return;
          failures += 1;
          delay = Math.max(
            pollIntervalMs,
            Math.min(15 * 60_000, pollIntervalMs * 2 ** Math.min(failures, 10)),
          );
          console.error(
            `Failed to check ${source} news. Retrying in ${delay / 1000} seconds:`,
            error,
          );
        }
      }
      if (!running) return;
      delivery = delivery.then(deliverPending).catch((error: unknown) => {
        console.error("News delivery cycle failed:", error);
      });
      await delivery;
      if (!running) return;
      timer = setTimeout(checkNow, delay);
      timer.unref();
    }

    function checkNow(): void {
      if (!request.signal.aborted) activeCycle = runCycle();
    }

    activeCycle = runCycle();
    return async () => {
      clearTimeout(timer);
      request.abort();
      await activeCycle;
    };
  }

  function start(): void {
    if (running) return;
    running = true;
    console.log(
      `Steam and unDeadlock news delivery started. Poll interval: ${pollIntervalMs / 1000} seconds.`,
    );
    stopPolls = [
      startPolling("Steam", pollSteam),
      startPolling("unDeadlock", pollUndeadlock),
    ];
  }

  async function stop(): Promise<void> {
    running = false;
    await Promise.all(stopPolls.map((stopPoll) => stopPoll()));
    await delivery;
    await newsStore.waitForWrites();
  }

  return { start, stop };
}
