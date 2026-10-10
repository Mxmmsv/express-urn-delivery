import type { Guild } from "discord.js";
import { ChannelType, PermissionFlagsBits } from "discord.js";

import type { GuildSettings } from "../../../entities/guild-settings/index.js";

export async function validateSettings(
  guild: Guild,
  settings: GuildSettings,
): Promise<string | null> {
  if (!settings.channelId) return "Select a news channel before saving.";
  const channel = await guild.channels.fetch(settings.channelId, {
    force: true,
  });
  if (
    !channel ||
    (channel.type !== ChannelType.GuildText &&
      channel.type !== ChannelType.GuildAnnouncement)
  ) {
    return "Select a text or announcement channel for news.";
  }

  const roles = await guild.roles.fetch();
  const bot = await guild.members.fetchMe({ force: true });
  const permissions = channel.permissionsFor(bot);
  if (
    !permissions.has([
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.EmbedLinks,
      PermissionFlagsBits.ReadMessageHistory,
    ])
  ) {
    return "I need View Channel, Send Messages, Embed Links, and Read Message History permissions in the selected channel.";
  }

  for (const roleId of settings.roleMentionsEnabled ? settings.roleIds : []) {
    const role = roles.get(roleId);
    if (!role || roleId === guild.id) {
      return "Select existing notification roles. The @everyone role is not supported.";
    }
    if (
      !role.mentionable &&
      !permissions.has(PermissionFlagsBits.MentionEveryone)
    ) {
      return "Make the selected roles mentionable or grant me Mention Everyone in the news channel.";
    }
  }
  return null;
}
