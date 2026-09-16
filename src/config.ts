import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

export type PickerMode = "single" | "multi";

export interface ButtonConfig {
  /** Exact name of the Discord role. Created if it doesn't exist. */
  role: string;
  /** Hex color like "#ff7c0a". Enforced on the role at startup when set. */
  color?: string;
  /** Optional emoji shown on the button: unicode ("⚔️") or custom ("<:name:id>"). Wins over icon. */
  emoji?: string;
  /**
   * Optional image path relative to config.json. The bot uploads it as an application emoji
   * named after the role (first run only) and shows it on the button.
   */
  icon?: string;
  /** Optional button text. Defaults to the role name. */
  label?: string;
}

export interface PickerConfig {
  /** Short id used inside button ids. Letters, digits, - and _ only. */
  id: string;
  /** Word used in replies, e.g. "class" -> "Your class is now Mage". */
  label: string;
  channelId: string;
  content: string;
  /** "single": one role from this picker at a time. "multi": buttons toggle roles. */
  mode: PickerMode;
  buttons: ButtonConfig[];
}

export interface BotConfig {
  pickers: PickerConfig[];
}

const ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;
const SNOWFLAKE_PATTERN = /^\d{17,20}$/;

function fail(message: string): never {
  throw new Error(`config.json: ${message}`);
}

export function loadConfig(path: string): BotConfig {
  const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (typeof raw !== "object" || raw === null || !Array.isArray((raw as BotConfig).pickers)) {
    fail('expected a top-level object with a "pickers" array');
  }
  const pickers = (raw as BotConfig).pickers;
  const seenIds = new Set<string>();

  pickers.forEach((picker, i) => {
    const where = `pickers[${i}]`;
    if (typeof picker.id !== "string" || !ID_PATTERN.test(picker.id)) {
      fail(`${where}.id must match ${ID_PATTERN}`);
    }
    if (seenIds.has(picker.id)) fail(`duplicate picker id "${picker.id}"`);
    seenIds.add(picker.id);

    if (typeof picker.label !== "string" || picker.label.length === 0) fail(`${where}.label is required`);
    if (typeof picker.channelId !== "string" || !SNOWFLAKE_PATTERN.test(picker.channelId)) {
      fail(`${where}.channelId must be a Discord channel id`);
    }
    if (typeof picker.content !== "string" || picker.content.length === 0) fail(`${where}.content is required`);
    if (picker.mode !== "single" && picker.mode !== "multi") fail(`${where}.mode must be "single" or "multi"`);
    if (!Array.isArray(picker.buttons) || picker.buttons.length === 0 || picker.buttons.length > 25) {
      fail(`${where}.buttons must have 1 to 25 entries`);
    }

    const seenRoles = new Set<string>();
    picker.buttons.forEach((button, j) => {
      const bwhere = `${where}.buttons[${j}]`;
      if (typeof button.role !== "string" || button.role.trim().length === 0) fail(`${bwhere}.role is required`);
      if (seenRoles.has(button.role)) fail(`${bwhere}: role "${button.role}" listed twice`);
      seenRoles.add(button.role);
      if (button.color !== undefined && !COLOR_PATTERN.test(button.color)) {
        fail(`${bwhere}.color must look like "#rrggbb"`);
      }
      if (button.icon !== undefined) {
        if (typeof button.icon !== "string" || button.icon.length === 0) fail(`${bwhere}.icon must be a path`);
        const abs = resolve(dirname(path), button.icon);
        if (!existsSync(abs)) fail(`${bwhere}.icon: file not found at ${abs}`);
        button.icon = abs;
      }
      if (`pick:${picker.id}:${button.role}`.length > 100) fail(`${bwhere}: picker id + role name too long`);
    });
  });

  return { pickers };
}
