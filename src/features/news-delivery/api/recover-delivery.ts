import type { Guild, GuildMember } from "discord.js";
import { PermissionFlagsBits } from "discord.js";

import type {
  DeliveryReceipt,
  PendingNews,
} from "../../../entities/news/index.js";
import { fetchNewsChannel } from "./news-channel.js";

type RecoveryResult =
  | { status: "found"; receipt: DeliveryReceipt }
  | { status: "absent" }
  | { status: "deferred"; reason: string };

export async function recoverDelivery(
  guild: Guild,
  bot: GuildMember,
  entry: PendingNews,
  isRunning: () => boolean,
): Promise<RecoveryResult> {
  if (!entry.attempt) return { status: "absent" };
  const { channelId, boundaryMessageId } = entry.attempt;
  const channel = await fetchNewsChannel(guild, channelId);
  if (!channel) return { status: "absent" };
  if (
    !channel
      .permissionsFor(bot)
      .has([
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.ReadMessageHistory,
      ])
  ) {
    return {
      status: "deferred",
      reason: `Cannot verify the previous delivery in channel ${channelId}. View Channel and Read Message History are required.`,
    };
  }

  let before: string | undefined;
  while (isRunning()) {
    const messages = await channel.messages.fetch({
      limit: 100,
      ...(before ? { before } : {}),
      cache: false,
    });
    for (const message of messages.values()) {
      if (boundaryMessageId && BigInt(message.id) <= BigInt(boundaryMessageId))
        continue;
      if (
        message.author.id === bot.id &&
        message.embeds.some((embed) => embed.url === entry.news.url)
      ) {
        return {
          status: "found",
          receipt: { newsId: entry.news.id, channelId, messageId: message.id },
        };
      }
    }
    const oldest = messages.last();
    if (
      !oldest ||
      messages.size < 100 ||
      (boundaryMessageId && BigInt(oldest.id) <= BigInt(boundaryMessageId))
    )
      return { status: "absent" };
    before = oldest.id;
  }
  return { status: "deferred", reason: "News delivery is stopping." };
}
