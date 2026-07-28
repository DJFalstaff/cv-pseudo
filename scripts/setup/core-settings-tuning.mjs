import { MODULE_ID, SETTINGS, log } from "../constants.mjs";

/**
 * Foundry core client/world settings Pseudo recommends tuning for a smoother table. Low-risk display
 * and interaction defaults — no gameplay rules, nothing a GM can't instantly change back in Configure
 * Settings. tokenAutoRotate and animateRollTable are world-scope (apply to everyone at the table);
 * chatBubbles, chatBubblesPan, and leftClickRelease are client-scope (apply only to whoever clicks
 * "Enable" — each player would need to opt in themselves).
 */
const RECOMMENDED = {
  tokenAutoRotate: false,
  animateRollTable: false,
  chatBubbles: true,
  chatBubblesPan: true,
  leftClickRelease: true
};

/**
 * Read a core setting, tolerating a missing key across Foundry versions.
 * @param {string} key
 * @returns {*}
 */
function getCore(key) {
  try {
    return game.settings.get("core", key);
  } catch {
    return undefined;
  }
}

/**
 * Whether every recommended core setting already matches.
 * @returns {boolean}
 */
export function coreSettingsOptimal() {
  return Object.entries(RECOMMENDED).every(([key, value]) => {
    const current = getCore(key);
    return current === undefined || current === value; // unknown keys don't block
  });
}

/**
 * Apply the recommended core settings.
 * @returns {Promise<void>}
 */
export async function applyCoreSettings() {
  for (const [key, value] of Object.entries(RECOMMENDED)) {
    if (getCore(key) === undefined) continue;
    try {
      await game.settings.set("core", key, value);
    } catch (err) {
      log(`could not set core.${key}:`, err);
    }
  }
}

/**
 * Show the "apply recommended core settings?" confirm dialog, then apply on yes.
 * @returns {Promise<void>}
 */
async function showCoreSettingsDialog() {
  const { DialogV2 } = foundry.applications.api;
  const confirmed = await DialogV2.confirm({
    window: { title: game.i18n.localize("CVP.CoreSettings.Title"), icon: "fa-solid fa-dragon" },
    content: `<p>${game.i18n.localize("CVP.CoreSettings.Body")}</p>`,
    yes: { label: game.i18n.localize("CVP.CoreSettings.Enable"), icon: "fa-solid fa-wand-magic-sparkles" },
    no: { label: game.i18n.localize("CVP.CoreSettings.NotNow") }
  }).catch(() => false);

  if (confirmed) {
    await applyCoreSettings();
    ui.notifications.info(game.i18n.localize("CVP.CoreSettings.Done"));
  }
}

/**
 * Once, for a configured GM whose recommended core settings aren't already applied, offer to tune them.
 * Dismissing it (either choice) won't nag again — but the GM can still reach the same dialog later on
 * purpose via openCoreSettingsPrompt() (e.g. from /help).
 * @returns {Promise<void>}
 */
export async function maybePromptCoreSettingsTuning() {
  if (!game.user.isGM) return;
  if (game.settings.get(MODULE_ID, SETTINGS.CORE_SETTINGS_DISMISSED)) return;
  if (coreSettingsOptimal()) return;

  await game.settings.set(MODULE_ID, SETTINGS.CORE_SETTINGS_DISMISSED, true);
  await showCoreSettingsDialog();
}

/**
 * Manually reopen the recommended-settings dialog on request (e.g. a /help button), regardless of
 * whether the first-run prompt was already dismissed. If everything's already ideal, says so instead
 * of showing a dialog with nothing to change.
 * @returns {Promise<void>}
 */
export async function openCoreSettingsPrompt() {
  if (coreSettingsOptimal()) {
    ui.notifications.info(game.i18n.localize("CVP.CoreSettings.AlreadyOptimal"));
    return;
  }
  await showCoreSettingsDialog();
}
