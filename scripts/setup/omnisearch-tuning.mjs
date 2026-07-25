import { MODULE_ID, SETTINGS, log } from "../constants.mjs";

const OMNI_ID = "spotlight-omnisearch";

/**
 * Spotlight Omnisearch settings Pseudo relies on for good search results, and the values it wants.
 * Its index is what searchWorld reads, so these directly shape what Pseudo can find.
 *  - searchCompendium: index compendium content (monsters, items, rules).
 *  - fullCompendiumJournalIndex: index journal page names and section headings (finds rules by topic).
 *  - searchSidebar: index world documents (your own actors, journals, tables).
 */
const RECOMMENDED = {
  searchCompendium: true,
  fullCompendiumJournalIndex: true,
  searchSidebar: true
};

/**
 * Read an Omnisearch setting, tolerating a missing key across versions.
 * @param {string} key
 * @returns {*}
 */
function getOmni(key) {
  try {
    return game.settings.get(OMNI_ID, key);
  } catch {
    return undefined;
  }
}

/**
 * Whether a superseded dnd5e edition's SRD packs are still being indexed (so a cleanup is warranted).
 * @returns {boolean}
 */
function supersededPacksIndexed() {
  if (game.system.id !== "dnd5e") return false;
  let rules = "modern";
  try {
    rules = game.settings.get("dnd5e", "rulesVersion");
  } catch {
    /* assume modern */
  }
  const keepBook = rules === "legacy" ? "SRD 5.1" : "SRD 5.2";
  let config = {};
  try {
    config = game.settings.get(OMNI_ID, "compendiumConfig") || {};
  } catch {
    return false;
  }
  return game.packs.some((pack) => {
    if (pack.metadata.packageType !== "system") return false;
    const book = pack.metadata.flags?.dnd5e?.sourceBook;
    return /^SRD 5\.[12]$/.test(book || "") && book !== keepBook && config[pack.metadata.id] !== false;
  });
}

/**
 * Whether every recommended Omnisearch setting is already ideal and no superseded edition is indexed.
 * @returns {boolean}
 */
export function omnisearchSettingsOptimal() {
  const settingsOk = Object.entries(RECOMMENDED).every(([key, value]) => {
    const current = getOmni(key);
    return current === undefined || current === value; // unknown keys don't block
  });
  return settingsOk && !supersededPacksIndexed();
}

/**
 * On dnd5e, hide the *superseded* edition's SRD packs from Omnisearch so searches don't return legacy
 * duplicates. dnd5e ships both 2014 ("SRD 5.1") and 2024 ("SRD 5.2") reference packs; on modern rules
 * the 5.1 packs are redundant (and vice-versa). Only ever turns packs OFF, never on, so a GM's own
 * choices are preserved. No-op for other systems.
 * @returns {Promise<boolean>} Whether the config changed.
 */
export async function hideSupersededEdition() {
  if (game.system.id !== "dnd5e") return false;

  let rules = "modern";
  try {
    rules = game.settings.get("dnd5e", "rulesVersion");
  } catch {
    /* older dnd5e without the setting — assume modern */
  }
  const keepBook = rules === "legacy" ? "SRD 5.1" : "SRD 5.2";

  let config;
  try {
    config = foundry.utils.deepClone(game.settings.get(OMNI_ID, "compendiumConfig") || {});
  } catch {
    return false;
  }

  let changed = false;
  for (const pack of game.packs) {
    if (pack.metadata.packageType !== "system") continue;
    const book = pack.metadata.flags?.dnd5e?.sourceBook;
    if (!/^SRD 5\.[12]$/.test(book || "")) continue; // only the SRD reference packs
    if (book !== keepBook && config[pack.metadata.id] !== false) {
      config[pack.metadata.id] = false; // hide the superseded edition
      changed = true;
    }
  }
  if (changed) await game.settings.set(OMNI_ID, "compendiumConfig", config);
  return changed;
}

/**
 * Apply the recommended Omnisearch settings, prefer the current dnd5e edition, and rebuild the index.
 * @returns {Promise<void>}
 */
export async function applyOmnisearchSettings() {
  for (const [key, value] of Object.entries(RECOMMENDED)) {
    if (getOmni(key) === undefined) continue;
    try {
      await game.settings.set(OMNI_ID, key, value);
    } catch (err) {
      log(`could not set Omnisearch ${key}:`, err);
    }
  }
  try {
    await hideSupersededEdition();
  } catch (err) {
    log("could not hide superseded edition:", err);
  }
  try {
    await CONFIG.SpotlightOmnisearch?.rebuildIndex?.();
  } catch (err) {
    log("Omnisearch reindex failed:", err);
  }
}

/**
 * Once, for a configured GM whose Omnisearch settings aren't ideal, offer to tune them so Pseudo can
 * search the whole world (compendia + journal headings). Dismissing it (either choice) won't nag again.
 * @returns {Promise<void>}
 */
export async function maybePromptOmnisearchTuning() {
  if (!game.user.isGM) return;
  if (!game.modules.get(OMNI_ID)?.active) return;
  if (game.settings.get(MODULE_ID, SETTINGS.OMNISEARCH_DISMISSED)) return;
  if (omnisearchSettingsOptimal()) return;

  const { DialogV2 } = foundry.applications.api;
  const confirmed = await DialogV2.confirm({
    window: { title: game.i18n.localize("CVP.Omni.Title"), icon: "fa-solid fa-dragon" },
    content: `<p>${game.i18n.localize("CVP.Omni.Body")}</p>`,
    yes: { label: game.i18n.localize("CVP.Omni.Enable"), icon: "fa-solid fa-wand-magic-sparkles" },
    no: { label: game.i18n.localize("CVP.Omni.NotNow") }
  }).catch(() => false);

  await game.settings.set(MODULE_ID, SETTINGS.OMNISEARCH_DISMISSED, true);
  if (confirmed) {
    await applyOmnisearchSettings();
    ui.notifications.info(game.i18n.localize("CVP.Omni.Done"));
  }
}
