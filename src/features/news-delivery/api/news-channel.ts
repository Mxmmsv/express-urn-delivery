import type { Guild } from "discord.js";
import { ChannelType, DiscordAPIError, RESTJSONErrorCodes } from "discord.js";

export async function fetchNewsChannel(guild: Guild, channelId: string) {
  try {
    const channel = await guild.channels.fetch(channelId, { force: true });
    if (
      channel &&
      (channel.type === ChannelType.GuildText ||
        channel.type === ChannelType.GuildAnnouncement)
    )
      return channel;
    return null;
  } catch (error) {
    if (
      error instanceof DiscordAPIError &&
      error.code === RESTJSONErrorCodes.UnknownChannel
    )
      return null;
    throw error;
  }
}
