import type { Client } from "discord.js";

export function registerShutdownHandlers(
  client: Client,
  dispose: () => Promise<void>,
): void {
  let stopping = false;
  const shutdown = (): void => {
    if (stopping) return;
    stopping = true;
    void dispose()
      .finally(() => client.destroy())
      .catch((error: unknown) => {
        console.error("Failed to close the Discord connection:", error);
        process.exitCode = 1;
      });
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}
