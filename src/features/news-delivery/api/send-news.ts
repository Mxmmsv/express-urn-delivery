import { createHash } from "node:crypto";

import type { Guild } from "discord.js";
import { PermissionFlagsBits } from "discord.js";

import type { GuildSettingsStore } from "../../../entities/guild-settings/index.js";
import type {
  DeliveryReceipt,
  NewsStore,
  PendingNews,
} from "../../../entities/news/index.js";
import { buildNewsMessage } from "../ui/news-message.js";
import { fetchNewsChannel } from "./news-channel.js";
import { recoverDelivery } from "./recover-delivery.js";

type DeliveryResult =
  | { status: "delivered"; receipt: DeliveryReceipt }
  | { status: "deferred"; reason: string };

export async function sendNews(
  guild: Guild,
  entry: PendingNews,
  settingsStore: GuildSettingsStore,
  newsStore: NewsStore,
  isRunning: () => boolean,
): Promise<DeliveryResult> {
  const roles = await guild.roles.fetch();
  const bot = await guild.members.fetchMe({ force: true });
  const recovery = await recoverDelivery(guild, bot, entry, isRunning);
  if (recovery.status === "found")
    return { status: "delivered", receipt: recovery.receipt };
  if (recovery.status === "deferred") return recovery;

  const settings = settingsStore.get(guild.id);
  if (!settings.channelId)
    return { status: "deferred", reason: "No news channel is configured." };
  const channel = await fetchNewsChannel(guild, settings.channelId);
  if (!channel)
    return {
      status: "deferred",
      reason:
        "The news channel is unavailable. Choose another channel with /start.",
    };
  const permissions = channel.permissionsFor(bot);
  if (
    !permissions.has([
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.EmbedLinks,
      PermissionFlagsBits.ReadMessageHistory,
    ])
  )
    return {
      status: "deferred",
      reason:
        "The news channel requires View Channel, Send Messages, Embed Links, and Read Message History.",
    };

  const roleIds = settings.roleMentionsEnabled
    ? settings.roleIds.filter((id) => {
        const role = roles.get(id);
        const allowed =
          id !== guild.id &&
          role &&
          (role.mentionable ||
            permissions.has(PermissionFlagsBits.MentionEveryone));
        if (!allowed)
          console.warn(
            `Skipping unavailable notification role ${id} in guild ${guild.id}.`,
          );
        return Boolean(allowed);
      })
    : [];
  const latestMessages = await channel.messages.fetch({
    limit: 1,
    cache: false,
  });
  const nonce = createHash("sha256")
    .update(`${guild.id}:${entry.news.id}`)
    .digest("hex")
    .slice(0, 24);
  if (!isRunning())
    return { status: "deferred", reason: "News delivery is stopping." };
  await newsStore.beginAttempt(guild.id, entry.news.id, {
    channelId: channel.id,
    boundaryMessageId: latestMessages.first()?.id ?? null,
    nonce,
  });
  if (!isRunning())
    return { status: "deferred", reason: "News delivery is stopping." };
  const message = await channel.send(
    buildNewsMessage(entry.news, roleIds, nonce),
  );
  return {
    status: "delivered",
    receipt: {
      newsId: entry.news.id,
      channelId: message.channelId,
      messageId: message.id,
    },
  };
}
