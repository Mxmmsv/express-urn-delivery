import { Events } from "discord.js";

import { createGuildSettingsStore } from "../entities/guild-settings/index.js";
import { createNewsStore } from "../entities/news/index.js";
import { createNewsDelivery } from "../features/news-delivery/index.js";
import { createSettingsMenuController } from "../features/news-settings/index.js";
import { getRssPollIntervalMs } from "./config.js";
import { createClient } from "./discord/client.js";
import { registerShutdownHandlers } from "./discord/shutdown.js";

export async function startBot(): Promise<void> {
  const token = process.env.DISCORD_TOKEN?.trim();
  if (!token) {
    throw new Error("Set DISCORD_TOKEN in .env before starting the bot.");
  }

  const pollIntervalMs = getRssPollIntervalMs();
  const settingsStore = createGuildSettingsStore();
  await settingsStore.load();

  const settingsMenus = createSettingsMenuController(settingsStore);
  const client = createClient(settingsMenus);
  const newsStore = createNewsStore();
  const newsDelivery = createNewsDelivery({
    client,
    settingsStore,
    newsStore,
    pollIntervalMs,
  });
  try {
    await newsStore.load();
    client.once(Events.ClientReady, () => {
      if (client.isReady() && client.token) newsDelivery.start();
    });
  } catch (error) {
    console.error(
      "News delivery is disabled because its history could not be loaded:",
      error,
    );
  }
  const dispose = async (): Promise<void> => {
    settingsMenus.dispose();
    await newsDelivery.stop();
  };
  registerShutdownHandlers(client, dispose);

  try {
    await client.login(token);
  } catch (error) {
    console.error("Failed to connect to Discord:", error);
    process.exitCode = 1;
    await dispose();
    await client.destroy();
  }
}
