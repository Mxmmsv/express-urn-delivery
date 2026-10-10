import type {
  ChatInputCommandInteraction,
  Guild,
  Interaction,
  MessageComponentInteraction,
} from "discord.js";
import {
  AttachmentBuilder,
  DiscordAPIError,
  MessageFlags,
  PermissionFlagsBits,
  RESTJSONErrorCodes,
} from "discord.js";

import type {
  GuildSettings,
  GuildSettingsStore,
} from "../../../entities/guild-settings/index.js";
import { getProjectPath } from "../../../shared/lib/project-path.js";
import type { SettingsMenuStatus } from "../ui/settings-menu.js";
import { buildSettingsMenu } from "../ui/settings-menu.js";
import { settingsComponentIds } from "./component-ids.js";
import { validateSettings } from "./validate-settings.js";

type MenuInteraction =
  ChatInputCommandInteraction<"cached"> | MessageComponentInteraction<"cached">;

interface MenuSession {
  messageId: string;
  ownerId: string;
  guild: Guild;
  draft: GuildSettings;
  status: SettingsMenuStatus;
  saveQueued: boolean;
  interaction: MenuInteraction;
  timer: NodeJS.Timeout | undefined;
  pending: Promise<void>;
}

const idleTimeout = 60_000;
const successTimeout = 10_000;

export function createSettingsMenuController(store: GuildSettingsStore) {
  const sessions = new Map<string, MenuSession>();
  let disposed = false;

  function isActive(session: MenuSession): boolean {
    return !disposed && sessions.get(session.messageId) === session;
  }

  function clearTimer(session: MenuSession): void {
    clearTimeout(session.timer);
    session.timer = undefined;
  }

  async function closeMenu(session: MenuSession): Promise<void> {
    if (!isActive(session)) return;
    clearTimer(session);
    sessions.delete(session.messageId);
    try {
      await session.interaction.deleteReply();
    } catch (error) {
      if (
        error instanceof DiscordAPIError &&
        error.code === RESTJSONErrorCodes.UnknownMessage
      )
        return;
      console.error("Failed to delete the settings menu:", error);
    }
  }

  function startTimer(session: MenuSession, duration = idleTimeout): void {
    clearTimer(session);
    if (!isActive(session)) return;
    if (
      duration === idleTimeout &&
      (session.saveQueued || session.status === "saving")
    )
      return;
    session.timer = setTimeout(() => {
      void closeMenu(session);
    }, duration);
    session.timer.unref();
  }

  async function showError(
    session: MenuSession,
    interaction: MenuInteraction,
    error: string,
    replaceBanner = false,
  ): Promise<void> {
    if (!isActive(session)) return;
    session.status = "editing";
    startTimer(session);
    await interaction.editReply({
      ...buildSettingsMenu(session.guild, session.draft, "editing", error),
      ...(replaceBanner
        ? {
            attachments: [],
            files: [
              new AttachmentBuilder(getProjectPath("assets", "Settings.png"), {
                name: "Settings.png",
              }),
            ],
          }
        : {}),
    });
  }

  async function openMenu(
    interaction: ChatInputCommandInteraction<"cached">,
  ): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const draft = store.get(interaction.guildId);
    const message = await interaction.editReply({
      ...buildSettingsMenu(interaction.guild, draft),
      files: [
        new AttachmentBuilder(getProjectPath("assets", "Settings.png"), {
          name: "Settings.png",
        }),
      ],
    });
    if (disposed) {
      await interaction.deleteReply();
      return;
    }
    const session: MenuSession = {
      messageId: message.id,
      ownerId: interaction.user.id,
      guild: interaction.guild,
      draft,
      status: "editing",
      saveQueued: false,
      interaction,
      timer: undefined,
      pending: Promise.resolve(),
    };
    sessions.set(message.id, session);
    startTimer(session);
  }

  async function saveMenu(
    session: MenuSession,
    interaction: MessageComponentInteraction<"cached">,
  ): Promise<void> {
    session.status = "saving";
    session.saveQueued = false;
    clearTimer(session);
    let validationError: string | null;
    try {
      await interaction.editReply(
        buildSettingsMenu(session.guild, session.draft, "saving"),
      );
      validationError = await store.save(
        session.guild.id,
        session.draft,
        (settings) => validateSettings(session.guild, settings),
      );
    } catch (error) {
      console.error("Failed to save news settings:", error);
      await showError(
        session,
        interaction,
        "Unable to save settings. Check the channel, roles, and bot permissions, then try again.",
      );
      return;
    }
    if (validationError) {
      await showError(session, interaction, validationError);
      return;
    }
    if (!isActive(session)) return;

    session.status = "saved";
    try {
      await interaction.editReply({
        ...buildSettingsMenu(session.guild, session.draft, "saved"),
        attachments: [],
        files: [
          new AttachmentBuilder(getProjectPath("assets", "Succesfull.png"), {
            name: "Succesfull.png",
          }),
        ],
      });
    } catch (error) {
      console.error("Settings were saved, but the confirmation failed:", error);
      await showError(
        session,
        interaction,
        "Settings were saved, but the confirmation could not be displayed. Review your choices and click Save to try again.",
        true,
      );
      return;
    }
    startTimer(session, successTimeout);
  }

  async function editDraft(
    session: MenuSession,
    interaction: MessageComponentInteraction<"cached">,
  ): Promise<void> {
    if (
      interaction.isButton() &&
      interaction.customId === settingsComponentIds.save
    ) {
      await saveMenu(session, interaction);
      return;
    }
    if (interaction.isChannelSelectMenu()) {
      const channelId = interaction.values[0];
      if (!channelId) {
        await showError(session, interaction, "Select a news channel.");
        return;
      }
      session.draft.channelId = channelId;
    } else if (interaction.isRoleSelectMenu()) {
      if (!session.draft.roleMentionsEnabled) return;
      if (interaction.values.includes(session.guild.id)) {
        await showError(
          session,
          interaction,
          "The @everyone role is not supported. Select specific roles instead.",
        );
        return;
      }
      session.draft.roleIds = [...new Set(interaction.values)];
    } else {
      session.draft.roleMentionsEnabled = !session.draft.roleMentionsEnabled;
      session.draft.roleIds = [];
    }
    await interaction.editReply(
      buildSettingsMenu(session.guild, session.draft),
    );
  }

  async function handleComponent(
    interaction: MessageComponentInteraction<"cached">,
  ): Promise<void> {
    const session = sessions.get(interaction.message.id);
    if (!session || session.guild.id !== interaction.guildId) {
      await interaction.reply({
        content:
          "This settings menu has expired. Run /start to open a new one.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (session.ownerId !== interaction.user.id) {
      await interaction.reply({
        content: "Run /start to open your own settings menu.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (session.status !== "editing" || session.saveQueued) {
      await interaction.deferUpdate();
      return;
    }

    const isSave =
      interaction.isButton() &&
      interaction.customId === settingsComponentIds.save;
    if (isSave) {
      session.saveQueued = true;
      clearTimer(session);
    } else {
      startTimer(session);
    }
    // Acknowledge promptly, then apply rapid interactions in arrival order.
    const acknowledged = interaction.deferUpdate().then(
      () => true,
      (error: unknown) => {
        console.error("Failed to acknowledge a settings interaction:", error);
        return false;
      },
    );
    const update = session.pending.then(async () => {
      try {
        if (
          !(await acknowledged) ||
          !isActive(session) ||
          session.status !== "editing"
        )
          return;
        session.interaction = interaction;
        await editDraft(session, interaction);
      } catch (error) {
        console.error("Failed to update the settings menu:", error);
        if (isActive(session) && session.status !== "saved") {
          await showError(
            session,
            interaction,
            "Unable to update the menu. Please try again.",
          );
        }
      } finally {
        if (isSave) {
          session.saveQueued = false;
          if (session.status === "editing") startTimer(session);
        }
      }
    });
    // A failed Discord response must not block later interactions in this menu.
    session.pending = update.catch(() => undefined);
    await update;
  }

  async function handleInteraction(interaction: Interaction): Promise<void> {
    const isStart =
      interaction.isChatInputCommand() && interaction.commandName === "start";
    const isSettings =
      interaction.isMessageComponent() &&
      Object.values(settingsComponentIds).some(
        (id) => id === interaction.customId,
      );
    if (!isStart && !isSettings) return;
    if (!interaction.isChatInputCommand() && !interaction.isMessageComponent())
      return;

    try {
      if (!interaction.inCachedGuild()) {
        await interaction.reply({
          content: "This menu is only available in a server.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      if (!interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)) {
        await interaction.reply({
          content: "You need Manage Server permission to change news settings.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      if (interaction.isChatInputCommand()) {
        await openMenu(interaction);
      } else {
        await handleComponent(interaction);
      }
    } catch (error) {
      console.error("Failed to handle the settings menu:", error);
      const content =
        "Unable to update the settings menu. Please run /start again.";
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({ content, flags: MessageFlags.Ephemeral });
      } else {
        await interaction.reply({ content, flags: MessageFlags.Ephemeral });
      }
    }
  }

  function dispose(): void {
    disposed = true;
    for (const session of sessions.values()) clearTimer(session);
    sessions.clear();
  }

  return { handleInteraction, dispose };
}

export type SettingsMenuController = ReturnType<
  typeof createSettingsMenuController
>;
