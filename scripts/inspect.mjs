// Read-only: logs in, prints roles and channels for every server the bot is in, exits.
// Run with: node --env-file=.env scripts/inspect.mjs
import { Client, GatewayIntentBits, ChannelType } from "discord.js";

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once("clientReady", async (c) => {
  console.log(`Logged in as ${c.user.tag} (${c.user.id})\n`);

  for (const [, guild] of c.guilds.cache) {
    await guild.roles.fetch();
    await guild.channels.fetch();
    const me = await guild.members.fetchMe();

    console.log(`=== Server: ${guild.name} (${guild.id}) ===`);
    console.log(`Bot's highest role: ${me.roles.highest.name} (position ${me.roles.highest.position})`);
    console.log(`Bot has Manage Roles: ${me.permissions.has("ManageRoles")}\n`);

    console.log("Roles (top to bottom):");
    const roles = [...guild.roles.cache.values()].sort((a, b) => b.position - a.position);
    for (const r of roles) {
      const color = r.color ? `#${r.color.toString(16).padStart(6, "0")}` : "none";
      const flags = [r.managed ? "managed" : null, r.hoist ? "hoisted" : null].filter(Boolean).join(", ");
      console.log(
        `  ${String(r.position).padStart(3)}  ${r.name.padEnd(28)} ${r.id}  color=${color}${flags ? `  [${flags}]` : ""}`,
      );
    }

    console.log("\nText channels:");
    const channels = [...guild.channels.cache.values()]
      .filter((ch) => ch.type === ChannelType.GuildText || ch.type === ChannelType.GuildAnnouncement)
      .sort((a, b) => (a.parent?.position ?? -1) - (b.parent?.position ?? -1) || a.position - b.position);
    for (const ch of channels) {
      const cat = ch.parent ? `${ch.parent.name} / ` : "";
      console.log(`  ${cat}#${ch.name}  ${ch.id}`);
    }
    console.log();
  }

  await client.destroy();
});

client.login(process.env.DISCORD_TOKEN);
