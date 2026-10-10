import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { getProjectPath } from "../../../shared/lib/project-path.js";
import type { GuildSettings } from "./types.js";

const snowflake = /^\d{17,20}$/;

function isSettings(value: unknown): value is Omit<
  GuildSettings,
  "roleMentionsEnabled"
> & {
  roleMentionsEnabled?: boolean;
} {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Record<string, unknown>;
  return (
    (entry.channelId === null ||
      (typeof entry.channelId === "string" &&
        snowflake.test(entry.channelId))) &&
    (entry.roleMentionsEnabled === undefined ||
      typeof entry.roleMentionsEnabled === "boolean") &&
    Array.isArray(entry.roleIds) &&
    entry.roleIds.length <= 25 &&
    entry.roleIds.every(
      (id: unknown) => typeof id === "string" && snowflake.test(id),
    )
  );
}

export function createGuildSettingsStore() {
  const path = getProjectPath("data", "guild-settings.json");
  let settings = new Map<string, GuildSettings>();
  let pendingWrite: Promise<void> = Promise.resolve();

  async function load(): Promise<void> {
    let content: string;
    try {
      content = await readFile(path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }

    const data: unknown = JSON.parse(content);
    if (typeof data !== "object" || data === null || Array.isArray(data)) {
      throw new Error("Invalid guild settings file. Expected a JSON object.");
    }

    const loaded = new Map<string, GuildSettings>();
    for (const [guildId, value] of Object.entries(data)) {
      if (!snowflake.test(guildId) || !isSettings(value)) {
        throw new Error(`Invalid saved settings for guild ${guildId}.`);
      }
      loaded.set(guildId, {
        channelId: value.channelId,
        roleIds: value.roleMentionsEnabled === false ? [] : [...value.roleIds],
        roleMentionsEnabled: value.roleMentionsEnabled ?? true,
      });
    }
    settings = loaded;
  }

  function get(guildId: string): GuildSettings {
    const saved = settings.get(guildId);
    return {
      channelId: saved?.channelId ?? null,
      roleIds: [...(saved?.roleIds ?? [])],
      roleMentionsEnabled: saved?.roleMentionsEnabled ?? true,
    };
  }

  function save(
    guildId: string,
    draft: GuildSettings,
    validate: (settings: GuildSettings) => Promise<string | null>,
  ): Promise<string | null> {
    const updated: GuildSettings = {
      channelId: draft.channelId,
      roleIds: draft.roleMentionsEnabled ? [...new Set(draft.roleIds)] : [],
      roleMentionsEnabled: draft.roleMentionsEnabled,
    };
    const write = pendingWrite.then(async () => {
      if (!snowflake.test(guildId) || !isSettings(updated)) {
        return "Invalid news settings. Please select a channel and roles again.";
      }
      const validationError = await validate(updated);
      if (validationError) return validationError;

      const next = new Map(settings).set(guildId, updated);
      await mkdir(dirname(path), { recursive: true });
      const temporaryPath = `${path}.tmp`;
      await writeFile(
        temporaryPath,
        `${JSON.stringify(Object.fromEntries(next), null, 2)}\n`,
        "utf8",
      );
      await rename(temporaryPath, path);
      settings = next;
      return null;
    });
    pendingWrite = write.then(
      () => undefined,
      () => undefined,
    );
    return write;
  }

  function list(): { guildId: string; settings: GuildSettings }[] {
    return [...settings.keys()].map((guildId) => ({
      guildId,
      settings: get(guildId),
    }));
  }

  return { load, get, save, list };
}

export type GuildSettingsStore = ReturnType<typeof createGuildSettingsStore>;
