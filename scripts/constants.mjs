/** Canonical module identity, setting keys, and shared helpers. */
export const MODULE_ID = "cv-pseudo";

/** Human-facing short name, used in the logger and window chrome. */
export const MODULE_NAME = "Pseudo";

/**
 * The model Pseudo defaults to out of the box. Uses Google's rolling alias `gemini-flash-latest`,
 * which always resolves to the current stable Flash tier — so the default never goes stale the way a
 * pinned version does (e.g. `gemini-2.5-flash`, which Google retired for new users). The setting is
 * still free text: a GM can pin a specific model in the wizard, and "Test & Save" validates it.
 */
export const DEFAULT_MODEL = "gemini-flash-latest";

/** Preferred community resources, surfaced when web help is needed or Pseudo is stumped. */
export const CARTOON_VILLAINS_YOUTUBE = "https://www.youtube.com/@cartoonvillains";
export const CARTOON_VILLAINS_DISCORD = "https://discord.gg/cartoon-villains";

/**
 * World/client setting keys, unprefixed. The API key is world-scoped and GM-restricted so it saves
 * to the server database and never reaches a player's client. See the security note in the README:
 * `restricted` hides the field and gates access, it does not encrypt the key.
 */
export const SETTINGS = {
  /** Provider identifier: which API Pseudo talks to. */
  PROVIDER: "provider",
  /** The private API key for the selected provider. World-scoped, GM-only. */
  API_KEY: "apiKey",
  /** Model identifier string. Free text so it never pins a stale model id. */
  MODEL: "model",
  /** Optional base-URL override, for OpenRouter or a self-hosted / proxy endpoint. */
  BASE_URL: "baseUrl",
  /** Set once the GM finishes or dismisses the first-run setup wizard. */
  SETUP_DISMISSED: "setupDismissed",
  /** Keep the assistant window above other windows. Per-user UI preference. */
  KEEP_ON_TOP: "keepOnTop",
  /** Last {top,left,width,height} of the assistant window, restored on next summon. */
  WINDOW_POSITION: "windowPosition",
  /** Set once the GM answers the "tune Omnisearch for best results" prompt. */
  OMNISEARCH_DISMISSED: "omnisearchDismissed",
  /** Press → in the empty input to fill it with the shown example prompt. Per-user UI preference. */
  EXAMPLE_AUTOFILL: "exampleAutofill"
};

/**
 * Known providers. Values are the option labels (i18n keys). The model field stays free text on
 * purpose — hardcoding a specific model id (e.g. an older Flash/Haiku) would date the module the
 * day a newer, cheaper one ships. The setup wizard suggests a current default per provider instead.
 */
export const PROVIDERS = {
  gemini: "CVP.Settings.Provider.Choices.Gemini",
  openai: "CVP.Settings.Provider.Choices.OpenAI",
  anthropic: "CVP.Settings.Provider.Choices.Anthropic",
  openrouter: "CVP.Settings.Provider.Choices.OpenRouter",
  custom: "CVP.Settings.Provider.Choices.Custom"
};

/** Namespaced logger. */
export function log(...args) {
  console.log(`${MODULE_NAME} |`, ...args);
}

/**
 * The effective UI colour scheme for application windows: Foundry's per-application setting, falling
 * back to the interface setting, then to the OS preference when either is left on automatic.
 * @returns {"light"|"dark"} The scheme.
 */
export function colorScheme() {
  const scheme = game.settings.get("core", "uiConfig")?.colorScheme;
  const value = scheme?.applications || scheme?.interface || "";
  if (value === "light" || value === "dark") return value;
  return window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

/**
 * Stamp the module's theme class on a framed application's root so its palette variables follow the
 * current colour scheme.
 * @param {HTMLElement} element Application root element.
 * @returns {void}
 */
export function applyColorScheme(element) {
  if (!element) return;
  const light = colorScheme() === "light";
  element.classList.toggle("cvp-theme-light", light);
  element.classList.toggle("cvp-theme-dark", !light);
}
