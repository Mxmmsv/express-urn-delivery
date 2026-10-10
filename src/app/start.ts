import { createGuildSettingsStore } from "../entities/guild-settings/index.js";
import { createSettingsMenuController } from "../features/news-settings/index.js";
import { createClient } from "./discord/client.js";
import { registerShutdownHandlers } from "./discord/shutdown.js";

export async function startBot(): Promise<void> {
  const token = process.env.DISCORD_TOKEN?.trim();
  if (!token) {
    throw new Error("Set DISCORD_TOKEN in .env before starting the bot.");
  }

  const settingsStore = createGuildSettingsStore();
  await settingsStore.load();

  const settingsMenus = createSettingsMenuController(settingsStore);
  const client = createClient(settingsMenus);
  registerShutdownHandlers(client, settingsMenus.dispose);

  try {
    await client.login(token);
  } catch (error) {
    console.error("Failed to connect to Discord:", error);
    process.exitCode = 1;
    settingsMenus.dispose();
    await client.destroy();
  }
}
