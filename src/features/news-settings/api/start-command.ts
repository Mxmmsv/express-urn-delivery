import { PermissionFlagsBits, SlashCommandBuilder } from "discord.js";

export const startCommand = new SlashCommandBuilder()
  .setName("start")
  .setDescription("Configure the news channel and notification roles")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);
