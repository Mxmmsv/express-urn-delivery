import type { Guild } from "discord.js";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  EmbedBuilder,
  RoleSelectMenuBuilder,
} from "discord.js";

import type { GuildSettings } from "../../../entities/guild-settings/index.js";
import { settingsComponentIds } from "../model/component-ids.js";

export type SettingsMenuStatus = "editing" | "saving" | "saved";

export function buildSettingsMenu(
  guild: Guild,
  settings: GuildSettings,
  status: SettingsMenuStatus = "editing",
  error?: string,
) {
  const locked = status !== "editing";
  const channelMenu = new ChannelSelectMenuBuilder()
    .setCustomId(settingsComponentIds.channel)
    .setPlaceholder("Select a news channel")
    .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
    .setMinValues(1)
    .setMaxValues(1)
    .setDisabled(locked);

  const channel = settings.channelId
    ? guild.channels.cache.get(settings.channelId)
    : undefined;
  if (
    channel &&
    (channel.type === ChannelType.GuildText ||
      channel.type === ChannelType.GuildAnnouncement)
  ) {
    channelMenu.setDefaultChannels(channel.id);
  }

  const roles = settings.roleMentionsEnabled
    ? settings.roleIds.filter((id) => guild.roles.cache.has(id))
    : [];
  const roleMenu = new RoleSelectMenuBuilder()
    .setCustomId(settingsComponentIds.roles)
    .setPlaceholder("Select roles to notify (optional)")
    .setMinValues(0)
    .setMaxValues(25)
    .setDefaultRoles(...roles)
    .setDisabled(locked || !settings.roleMentionsEnabled);

  const description =
    status === "saved"
      ? "Settings saved successfully."
      : status === "saving"
        ? "Saving settings..."
        : "Choose your news channel and notification roles, then click Save.";

  const embed = new EmbedBuilder()
    .setTitle("Paige Express • Settings")
    .setDescription(error ? `${description}\n\n${error}` : description)
    .setColor(status === "saved" ? 0x57f287 : 0xe89b44)
    .addFields(
      {
        name: "News channel",
        value: channel
          ? `<#${channel.id}>`
          : settings.channelId
            ? "Saved channel is no longer available. Select another channel."
            : "Not configured — select a channel below.",
      },
      {
        name: "Notification roles",
        value: !settings.roleMentionsEnabled
          ? "Disabled"
          : settings.roleIds.length
            ? settings.roleIds.map((id) => `<@&${id}>`).join(" ")
            : "None",
      },
    )
    .setImage(
      status === "saved"
        ? "attachment://Succesfull.png"
        : "attachment://Settings.png",
    )
    .setFooter({
      text:
        status === "saved"
          ? "This message will close in 10 seconds."
          : status === "saving"
            ? "Please wait while your settings are saved."
            : "Only members with Manage Server can change settings. Closes after 1 minute of inactivity.",
    });

  const toggleButton = new ButtonBuilder()
    .setCustomId(settingsComponentIds.toggleRoles)
    .setLabel(
      settings.roleMentionsEnabled
        ? "Disable role mentions"
        : "Enable role mentions",
    )
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(locked);

  const saveButton = new ButtonBuilder()
    .setCustomId(settingsComponentIds.save)
    .setLabel("Save")
    .setStyle(ButtonStyle.Success)
    .setDisabled(locked || !settings.channelId);

  return {
    embeds: [embed],
    components:
      status === "saved"
        ? []
        : [
            new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
              channelMenu,
            ),
            new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(
              roleMenu,
            ),
            new ActionRowBuilder<ButtonBuilder>().addComponents(
              toggleButton,
              saveButton,
            ),
          ],
    allowedMentions: { parse: [] as const },
  };
}
