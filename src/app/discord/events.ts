import type { Client } from "discord.js";
import { Events } from "discord.js";

import type { SettingsMenuController } from "../../features/news-settings/index.js";
import {
  registerCommands,
  registerGuildCommands,
} from "./register-commands.js";

export function registerClientEvents(
  client: Client,
  settingsMenus: SettingsMenuController,
): void {
  client.once(Events.ClientReady, (readyClient) => {
    if (!readyClient.isReady() || !readyClient.token) return;
    console.log(`Connected to Discord as ${readyClient.user.tag}`);
    void registerCommands(readyClient).catch((error: unknown) => {
      console.error("Failed to register server commands:", error);
    });
  });

  client.on(Events.GuildCreate, (guild) => {
    if (!client.isReady() || !client.token) return;
    void registerGuildCommands(guild).catch((error: unknown) => {
      console.error(`Failed to register commands in guild ${guild.id}:`, error);
    });
  });

  client.on(Events.InteractionCreate, (interaction) => {
    void settingsMenus
      .handleInteraction(interaction)
      .catch((error: unknown) => {
        console.error("Failed to respond to a settings interaction:", error);
      });
  });

  client.on(Events.Error, (error) => {
    console.error("Discord client error:", error);
  });
}
