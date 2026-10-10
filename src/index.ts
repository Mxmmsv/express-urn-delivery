import "dotenv/config";

import { Client, Events, GatewayIntentBits } from "discord.js";

const token = process.env.DISCORD_TOKEN?.trim();

if (!token) {
  throw new Error("Set DISCORD_TOKEN in .env before starting the bot.");
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

client.once(Events.ClientReady, (readyClient) => {
  console.log(`Connected to Discord as ${readyClient.user.tag}`);
});

client.on(Events.Error, (error) => {
  console.error("Discord client error:", error);
});

function shutdown(): void {
  void client.destroy().catch((error: unknown) => {
    console.error("Failed to close the Discord connection:", error);
    process.exitCode = 1;
  });
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

try {
  await client.login(token);
} catch (error) {
  console.error("Failed to connect to Discord:", error);
  process.exitCode = 1;
  await client.destroy();
}
