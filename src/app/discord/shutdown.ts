import type { Client } from "discord.js";

export function registerShutdownHandlers(
  client: Client,
  disposeMenus: () => void,
): void {
  const shutdown = (): void => {
    disposeMenus();
    void client.destroy().catch((error: unknown) => {
      console.error("Failed to close the Discord connection:", error);
      process.exitCode = 1;
    });
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}
