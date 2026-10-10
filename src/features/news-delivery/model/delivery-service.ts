import type { Client } from "discord.js";

import type { GuildSettingsStore } from "../../../entities/guild-settings/index.js";
import type { NewsItem, NewsStore } from "../../../entities/news/index.js";
import { sendNews } from "../api/send-news.js";
import { fetchSteamNews } from "../api/steam-rss.js";

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
  let timer: NodeJS.Timeout | undefined;
  let activeCycle: Promise<void> | undefined;
  let request: AbortController | undefined;
  let steamFailures = 0;
  let nextDelayMs = pollIntervalMs;

  function isRunning(): boolean {
    return running && client.isReady();
  }

  async function runCycle(): Promise<void> {
    if (!isRunning()) return;
    let feed: NewsItem[] | undefined;
    request = new AbortController();
    try {
      feed = await fetchSteamNews(request.signal);
      steamFailures = 0;
      nextDelayMs = pollIntervalMs;
    } catch (error) {
      if (!running) return;
      steamFailures += 1;
      nextDelayMs = Math.max(
        pollIntervalMs,
        Math.min(
          15 * 60_000,
          pollIntervalMs * 2 ** Math.min(steamFailures, 10),
        ),
      );
      console.error(
        `Failed to fetch Steam news. Next RSS check in ${nextDelayMs / 1000} seconds:`,
        error,
      );
    } finally {
      request = undefined;
    }

    for (const { guildId, settings } of settingsStore.list()) {
      if (!isRunning()) return;
      if (!settings.channelId) continue;
      const guild = client.guilds.cache.get(guildId);
      if (!guild) continue;
      try {
        if (feed) await newsStore.synchronize(guildId, feed);
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
            `Delivered Steam news ${entry.news.id} to guild ${guildId}, channel ${result.receipt.channelId}.`,
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

  function checkNow(): void {
    if (!running) return;
    activeCycle = runCycle()
      .catch((error: unknown) => {
        console.error("News delivery cycle failed:", error);
      })
      .finally(() => {
        activeCycle = undefined;
        if (!running) return;
        timer = setTimeout(checkNow, nextDelayMs);
        timer.unref();
      });
  }

  function start(): void {
    if (running) return;
    running = true;
    console.log(
      `Steam news delivery started. Poll interval: ${pollIntervalMs / 1000} seconds.`,
    );
    checkNow();
  }

  async function stop(): Promise<void> {
    running = false;
    clearTimeout(timer);
    timer = undefined;
    request?.abort();
    await activeCycle;
    await newsStore.waitForWrites();
  }

  return { start, stop };
}
