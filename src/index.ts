import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  Events,
  GatewayIntentBits,
  MessageFlags,
  type ButtonInteraction,
  type Guild,
  type GuildMember,
  type Role,
} from "discord.js";
import { readFileSync } from "node:fs";
import { loadConfig, type ButtonConfig, type PickerConfig } from "./config.js";
import { memeIntents, registerMemes } from "./meme.js";

const token = process.env.DISCORD_TOKEN;
if (!token) {
  console.error("DISCORD_TOKEN is not set. Put it in .env or the container environment.");
  process.exit(1);
}

const config = loadConfig(process.env.CONFIG_PATH ?? "./config.json");
const pickersById = new Map(config.pickers.map((p) => [p.id, p]));

/** picker id -> role name -> role id, resolved at startup. */
const roleIds = new Map<string, Map<string, string>>();

/** icon path -> uploaded application emoji, resolved at startup. */
const iconEmojis = new Map<string, { id: string; name: string }>();

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, ...memeIntents],
});

registerMemes(client);

// ---------- Buttons ----------

const CUSTOM_ID_PREFIX = "pick:";

function customId(picker: PickerConfig, button: ButtonConfig): string {
  return `${CUSTOM_ID_PREFIX}${picker.id}:${button.role}`;
}

function parseCustomId(id: string): { pickerId: string; role: string } | null {
  if (!id.startsWith(CUSTOM_ID_PREFIX)) return null;
  const rest = id.slice(CUSTOM_ID_PREFIX.length);
  const sep = rest.indexOf(":");
  if (sep === -1) return null;
  return { pickerId: rest.slice(0, sep), role: rest.slice(sep + 1) };
}

function buildRows(picker: PickerConfig): ActionRowBuilder<ButtonBuilder>[] {
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  for (let i = 0; i < picker.buttons.length; i += 5) {
    const row = new ActionRowBuilder<ButtonBuilder>();
    for (const button of picker.buttons.slice(i, i + 5)) {
      const b = new ButtonBuilder()
        .setCustomId(customId(picker, button))
        .setLabel(button.label ?? button.role)
        .setStyle(ButtonStyle.Secondary);
      const icon = button.icon ? iconEmojis.get(button.icon) : undefined;
      if (button.emoji) b.setEmoji(button.emoji);
      else if (icon) b.setEmoji({ id: icon.id, name: icon.name });
      row.addComponents(b);
    }
    rows.push(row);
  }
  return rows;
}

// ---------- Startup: emojis, roles and messages ----------

function hexToInt(hex: string): number {
  return parseInt(hex.slice(1), 16);
}

/** Discord emoji names: 2-32 chars, letters, digits and underscores. */
function emojiName(roleName: string): string {
  const base = roleName.toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
  return (base.length < 2 ? `${base}_role` : base).slice(0, 32);
}

/** Upload every configured icon as an application emoji, unless one with that name exists. */
async function ensureIconEmojis(): Promise<void> {
  const buttons = config.pickers.flatMap((p) => p.buttons).filter((b) => b.icon && !b.emoji);
  if (buttons.length === 0) return;

  const existing = await client.application!.emojis.fetch();
  for (const button of buttons) {
    const icon = button.icon!;
    if (iconEmojis.has(icon)) continue;
    const name = emojiName(button.role);
    let emoji = existing.find((e) => e.name === name);
    if (!emoji) {
      emoji = await client.application!.emojis.create({ name, attachment: readFileSync(icon) });
      console.log(`Uploaded application emoji :${name}: (${emoji.id}) from ${icon}`);
    }
    iconEmojis.set(icon, { id: emoji.id, name });
  }
}

async function ensureRole(guild: Guild, button: ButtonConfig): Promise<Role> {
  let role = guild.roles.cache.find((r) => r.name === button.role);
  if (!role) {
    role = await guild.roles.create({
      name: button.role,
      colors: button.color ? { primaryColor: hexToInt(button.color) } : undefined,
      reason: "Created by role picker bot from config.json",
    });
    console.log(`Created role "${role.name}" (${role.id})`);
    return role;
  }
  if (button.color && role.colors.primaryColor !== hexToInt(button.color)) {
    await role.setColors({ primaryColor: hexToInt(button.color) }, "Enforced from config.json");
    console.log(`Updated color of role "${role.name}" to ${button.color}`);
  }
  return role;
}

async function syncPicker(picker: PickerConfig): Promise<void> {
  const channel = await client.channels.fetch(picker.channelId);
  if (!channel || !channel.isTextBased() || channel.isDMBased()) {
    console.error(`Picker "${picker.id}": channel ${picker.channelId} is not a server text channel. Skipping.`);
    return;
  }
  const guild = channel.guild;
  await guild.roles.fetch();
  const me = await guild.members.fetchMe();

  const ids = new Map<string, string>();
  for (const button of picker.buttons) {
    const role = await ensureRole(guild, button);
    ids.set(button.role, role.id);
    if (me.roles.highest.comparePositionTo(role) <= 0) {
      console.warn(
        `Picker "${picker.id}": role "${role.name}" is at or above the bot's highest role. ` +
          `Move the bot's role above it in Server Settings > Roles or assignments will fail.`,
      );
    }
  }
  roleIds.set(picker.id, ids);

  const payload = { content: picker.content, components: buildRows(picker) };
  if (picker.messageId) {
    const message = await channel.messages.fetch(picker.messageId);
    if (message.author.id !== client.user?.id) {
      console.error(`Picker "${picker.id}": message ${picker.messageId} was not sent by this bot, so it cannot be edited. Clear messageId to post a new one.`);
      return;
    }
    await message.edit(payload);
    console.log(`Picker "${picker.id}": synced message ${picker.messageId} in #${channel.name}`);
  } else {
    const message = await channel.send(payload);
    console.log(
      `Picker "${picker.id}": posted new message ${message.id} in #${channel.name}. ` +
        `Set "messageId": "${message.id}" in config.json so future restarts edit it instead of posting again.`,
    );
  }
}

// ---------- Button presses ----------

async function applySingle(member: GuildMember, picker: PickerConfig, roleName: string): Promise<string> {
  const ids = roleIds.get(picker.id)!;
  const target = ids.get(roleName)!;
  const names = new Map([...ids].map(([name, id]) => [id, name]));

  const current = new Set(member.roles.cache.keys());
  const others = [...ids.values()].filter((id) => id !== target && current.has(id));
  const hasTarget = current.has(target);

  if (hasTarget && others.length === 0) {
    return `Your ${picker.label} is already **${roleName}**.`;
  }

  for (const id of others) current.delete(id);
  current.add(target);
  await member.roles.set([...current], `${picker.label} picker`);

  if (others.length === 0) return `Your ${picker.label} is now **${roleName}**.`;
  const from = others.map((id) => `**${names.get(id)}**`).join(", ");
  return `Your ${picker.label} changed from ${from} to **${roleName}**.`;
}

async function applyMulti(member: GuildMember, picker: PickerConfig, roleName: string): Promise<string> {
  const target = roleIds.get(picker.id)!.get(roleName)!;
  if (member.roles.cache.has(target)) {
    await member.roles.remove(target, `${picker.label} picker`);
    return `Removed **${roleName}**.`;
  }
  await member.roles.add(target, `${picker.label} picker`);
  return `Added **${roleName}**.`;
}

async function handleButton(interaction: ButtonInteraction): Promise<void> {
  const parsed = parseCustomId(interaction.customId);
  if (!parsed) return;
  const picker = pickersById.get(parsed.pickerId);
  const known = picker && roleIds.get(picker.id)?.has(parsed.role);
  if (!picker || !known || !interaction.inCachedGuild()) {
    await interaction.reply({ content: "This button is no longer configured.", flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    // Force a fresh fetch so we don't act on stale cached roles.
    const member = await interaction.guild.members.fetch({ user: interaction.user.id, force: true });
    const text =
      picker.mode === "single"
        ? await applySingle(member, picker, parsed.role)
        : await applyMulti(member, picker, parsed.role);
    await interaction.editReply(text);
    console.log(`${interaction.user.tag}: ${picker.id}/${parsed.role} -> ${text}`);
  } catch (err) {
    console.error(`Failed to apply ${picker.id}/${parsed.role} for ${interaction.user.tag}:`, err);
    await interaction.editReply("Something went wrong while changing your roles. Please tell an officer.");
  }
}

client.on(Events.InteractionCreate, (interaction) => {
  if (interaction.isButton()) void handleButton(interaction);
});

client.once(Events.ClientReady, async (c) => {
  console.log(`Logged in as ${c.user.tag}`);
  try {
    await ensureIconEmojis();
  } catch (err) {
    console.error("Failed to upload icon emojis, buttons will show without icons:", err);
  }
  for (const picker of config.pickers) {
    try {
      await syncPicker(picker);
    } catch (err) {
      console.error(`Picker "${picker.id}" failed to sync:`, err);
    }
  }
  console.log("Ready.");
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    console.log(`Received ${signal}, shutting down.`);
    void client.destroy().then(() => process.exit(0));
  });
}

void client.login(token);
