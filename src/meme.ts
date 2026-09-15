// Meme functionality. Keep the silly stuff here so index.ts stays about roles.
import { Events, GatewayIntentBits, type Client } from "discord.js";

/** Intents the meme features need. Message Content is privileged; enable it in the Developer Portal. */
export const memeIntents = [GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent];

/**
 * True if the text contains "johm" once you strip everything that isn't a letter.
 * Matches "Johm", "jo hm", "j-o-h-m", "JOHM!!!", "johmbot", ...
 */
export function containsJohm(text: string): boolean {
  return text.toLowerCase().replace(/[^a-z]/g, "").includes("johm");
}

export function registerMemes(client: Client): void {
  client.on(Events.MessageCreate, async (message) => {
    if (message.author.bot) return; // never answer bots, including ourselves
    if (!message.inGuild()) return;
    if (!containsJohm(message.content)) return;
    try {
      await message.channel.send("Johm");
    } catch (err) {
      console.error(`Johm failed in #${message.channel.name}:`, err instanceof Error ? err.message : err);
    }
  });
}
