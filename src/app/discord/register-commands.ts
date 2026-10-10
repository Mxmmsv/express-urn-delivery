import type { Client, Guild } from "discord.js";
import { ApplicationCommandType } from "discord.js";

import { startCommand } from "../../features/news-settings/index.js";

export async function registerGuildCommands(guild: Guild): Promise<void> {
  await guild.commands.create(startCommand);
  console.log(`Registered /start in ${guild.name} (${guild.id}).`);
}

export async function registerCommands(client: Client<true>): Promise<void> {
  for (const guild of client.guilds.cache.values()) {
    await registerGuildCommands(guild);
  }

  const globalCommands = await client.application.commands.fetch();
  const globalStart = globalCommands.find(
    (command) =>
      command.name === startCommand.name &&
      command.type === ApplicationCommandType.ChatInput,
  );
  if (globalStart) {
    await globalStart.delete();
    console.log(
      "Removed the global /start command after registering it in servers.",
    );
  }
}
