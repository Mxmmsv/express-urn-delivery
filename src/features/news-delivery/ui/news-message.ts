import { EmbedBuilder, escapeMarkdown } from "discord.js";

import type { NewsItem } from "../../../entities/news/index.js";

function truncate(text: string, length: number): string {
  if (text.length <= length) return text;
  // Do not cut a Unicode surrogate pair in half.
  let end = length - 1;
  const code = text.charCodeAt(end - 1);
  if (code >= 0xd800 && code <= 0xdbff) end -= 1;
  return `${text.slice(0, end).trimEnd()}…`;
}

export function buildNewsMessage(
  news: NewsItem,
  roleIds: string[],
  nonce: string,
) {
  const embed = new EmbedBuilder()
    .setTitle(truncate(news.title, 256))
    .setURL(news.url)
    .setColor(0xe89b44)
    .setFooter({ text: "Steam • Deadlock" });
  // HTML line breaks are preserved by the RSS converter with word wrapping off.
  const firstParagraph = news.text.trim().split(/\r?\n/, 1)[0] ?? "";
  if (firstParagraph)
    embed.setDescription(truncate(escapeMarkdown(firstParagraph), 1000));
  if (news.publishedAt) embed.setTimestamp(new Date(news.publishedAt));
  if (news.imageUrl) embed.setImage(news.imageUrl);
  return {
    ...(roleIds.length
      ? { content: roleIds.map((id) => `<@&${id}>`).join(" ") }
      : {}),
    embeds: [embed],
    allowedMentions: {
      parse: [] as const,
      roles: roleIds,
      users: [],
      repliedUser: false,
    },
    nonce,
    enforceNonce: true,
  };
}
