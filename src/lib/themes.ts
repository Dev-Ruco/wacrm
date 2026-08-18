/**
 * Single source of truth for the color-theme catalog.
 *
 * The CSS variables themselves live in `src/app/globals.css` and product
 * identity overrides can live in dedicated layers such as `wacrm-blue.css`.
 * This module carries the metadata the UI, no-flash boot script and theme
 * provider need.
 */

export const THEME_IDS = [
  "wacrm",
  "violet",
  "emerald",
  "cobalt",
  "amber",
  "rose",
  "whatsapp",
] as const;

export type ThemeId = (typeof THEME_IDS)[number];

export const DEFAULT_THEME: ThemeId = "wacrm";

export const STORAGE_KEY = "wacrm.theme";

/**
 * MODE — the light/dark dimension, orthogonal to the accent theme.
 * Persisted under its own localStorage key so it composes freely with the
 * accent choice.
 */
export const MODES = ["light", "dark"] as const;

export type Mode = (typeof MODES)[number];

export const DEFAULT_MODE: Mode = "light";

export const MODE_STORAGE_KEY = "wacrm.mode";

export function isMode(value: unknown): value is Mode {
  return (
    typeof value === "string" && (MODES as ReadonlyArray<string>).includes(value)
  );
}

export interface ThemeMeta {
  id: ThemeId;
  name: string;
  tagline: string;
  /** Static swatch color shown by the appearance picker. */
  swatch: string;
}

export const THEMES: ReadonlyArray<ThemeMeta> = [
  {
    id: "wacrm",
    name: "WACRM Blue",
    tagline: "Identidade oficial — sóbria, empresarial e orientada ao atendimento.",
    swatch: "#366775",
  },
  {
    id: "violet",
    name: "Violet",
    tagline: "The original default — confident, slightly playful.",
    swatch: "oklch(0.526 0.247 293)",
  },
  {
    id: "emerald",
    name: "Emerald",
    tagline: "Growth-coded, nods at messaging without copying WhatsApp green.",
    swatch: "oklch(0.62 0.16 162)",
  },
  {
    id: "cobalt",
    name: "Cobalt",
    tagline: "Clean B2B-SaaS blue — calm and product-y.",
    swatch: "oklch(0.585 0.2 254)",
  },
  {
    id: "amber",
    name: "Amber",
    tagline: "Warm and friendly — feels good for SMB teams.",
    swatch: "oklch(0.745 0.16 65)",
  },
  {
    id: "rose",
    name: "Rose",
    tagline: "Bold and modern — D2C, creator-economy, lifestyle.",
    swatch: "oklch(0.645 0.22 16)",
  },
  {
    id: "whatsapp",
    name: "WhatsApp",
    tagline: "The real brand green, with an authentic chat header, bubbles and wallpaper.",
    swatch: "oklch(0.761 0.201 149.7)",
  },
];

export function isThemeId(value: unknown): value is ThemeId {
  return (
    typeof value === "string" &&
    (THEME_IDS as ReadonlyArray<string>).includes(value)
  );
}