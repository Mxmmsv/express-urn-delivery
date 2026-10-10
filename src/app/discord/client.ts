import { Client, GatewayIntentBits } from "discord.js";

import type { SettingsMenuController } from "../../features/news-settings/index.js";
import { registerClientEvents } from "./events.js";

export function createClient(settingsMenus: SettingsMenuController): Client {
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  registerClientEvents(client, settingsMenus);
  return client;
}
