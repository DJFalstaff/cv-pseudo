import { MODULE_ID, log } from "../constants.mjs";

/**
 * Bridge to the Remote Highlight UI module. Pseudo never emits a raw selector from the model — it
 * emits a *key* that resolves against the verified `ui-map.json` here, so a hallucinated selector is
 * impossible. This module wraps Remote Highlight's exported functions (its scripts are ES modules the
 * browser has already loaded, so importing them returns the same, already-initialised instance).
 */

const RHUI_ID = "remote-highlight-ui";

/** @type {?Promise<?object>} Cached import of Remote Highlight's main module. */
let rhuiPromise = null;

/** @type {?Promise<?Function>} Cached import of its selector generator (a separate file). */
let selectorGenPromise = null;

/** @type {?object} Cached parsed UI map. */
let uiMap = null;

/**
 * Get Remote Highlight's main module namespace, or null if it isn't active/loadable. This file exports
 * the highlight functions (e.g. onSocketMessageHighlightSomething) but NOT the selector generator.
 * @returns {Promise<?object>}
 */
async function getRhui() {
  if (!game.modules.get(RHUI_ID)?.active) return null;
  if (!rhuiPromise) {
    // Relative to this file (…/cv-pseudo/scripts/ui/) up to …/modules/ then into the sibling module.
    rhuiPromise = import("../../../remote-highlight-ui/scripts/remote-highlight-ui.js").catch((err) => {
      log("could not load Remote Highlight UI:", err);
      return null;
    });
  }
  return rhuiPromise;
}

/**
 * Get Remote Highlight's `generateUniqueSelector`, which lives in its own file (the main module imports
 * but does not re-export it).
 * @returns {Promise<?Function>}
 */
async function getSelectorGenerator() {
  if (!game.modules.get(RHUI_ID)?.active) return null;
  if (!selectorGenPromise) {
    selectorGenPromise = import("../../../remote-highlight-ui/scripts/generate-unique-selector.js")
      .then((mod) => mod.generateUniqueSelector ?? null)
      .catch((err) => {
        log("could not load selector generator:", err);
        return null;
      });
  }
  return selectorGenPromise;
}

/**
 * Load and cache the verified UI selector map.
 * @returns {Promise<object>}
 */
export async function loadUiMap() {
  if (uiMap) return uiMap;
  try {
    const response = await fetch(`modules/${MODULE_ID}/knowledge/ui-map.json`);
    uiMap = response.ok ? await response.json() : {};
  } catch {
    uiMap = {};
  }
  return uiMap;
}

/**
 * The map's addressable targets as {key, label}, for offering to the model. Keys starting with "_"
 * (like _comment) are skipped.
 * @param {object} map A loaded UI map.
 * @returns {Array<{key: string, label: string}>}
 */
export function highlightTargets(map) {
  return Object.entries(map ?? {})
    .filter(([key]) => !key.startsWith("_"))
    .map(([key, value]) => ({ key, label: value?.label ?? key }));
}

/**
 * Resolve a map key to its verified selector.
 * @param {string} key
 * @returns {Promise<?string>}
 */
export async function resolveSelector(key) {
  const map = await loadUiMap();
  return map?.[key]?.selector ?? null;
}

/**
 * Ensure a sidebar target is actually on screen before highlighting. Remote Highlight auto-switches
 * sidebar tabs and scrolls, but it does not expand a collapsed sidebar — so a directory button ends
 * up with a 0×0 box and the spotlight lands on nothing. If the target lives in the sidebar and the
 * sidebar is collapsed, expand it and wait for the layout to settle.
 * @param {string} selector
 * @returns {Promise<void>}
 */
async function ensureSidebarVisible(selector) {
  let element = null;
  try {
    element = document.querySelector(selector);
  } catch {
    return;
  }
  const inSidebar = element ? Boolean(element.closest("#sidebar")) : /sidebar/.test(selector);
  if (!inSidebar) return;
  if (ui.sidebar?.expanded === false && typeof ui.sidebar.expand === "function") {
    ui.sidebar.expand();
    await new Promise((r) => setTimeout(r, 350)); // let the expand animation lay out
  }
}

/**
 * Spotlight a selector on this client's screen via Remote Highlight. No-ops (returning false) if the
 * module is unavailable; a selector that matches nothing fails gracefully inside Remote Highlight.
 * @param {string} selector
 * @returns {Promise<boolean>} Whether the highlight was dispatched.
 */
export async function highlightLocally(selector) {
  if (!selector) return false;
  const rhui = await getRhui();
  if (!rhui?.onSocketMessageHighlightSomething) return false;
  await ensureSidebarVisible(selector);
  rhui.onSocketMessageHighlightSomething({ selector });
  return true;
}

/**
 * Resolve a map key and spotlight it locally.
 * @param {string} key
 * @returns {Promise<boolean>}
 */
export async function highlightByKey(key) {
  const selector = await resolveSelector(key);
  return highlightLocally(selector);
}

/**
 * Developer helper for building the UI map: prompts for a click, then logs and returns the unique
 * selector Remote Highlight generates for the clicked element. Call from the console via
 * `game.modules.get("cv-pseudo").api.captureSelector()`.
 * @returns {Promise<?string>}
 */
export async function captureSelector() {
  const generateUniqueSelector = await getSelectorGenerator();
  if (!generateUniqueSelector) {
    ui.notifications.warn("Remote Highlight UI isn't available to capture selectors.");
    return null;
  }
  ui.notifications.info("Pseudo: click any UI element to capture its selector…");
  return new Promise((resolve) => {
    const handler = (event) => {
      event.preventDefault();
      event.stopPropagation();
      document.body.removeEventListener("click", handler, true);
      const element = document.elementFromPoint(event.clientX, event.clientY);
      const selector = element ? generateUniqueSelector(element) : null;
      log("captured selector:", selector, element);
      ui.notifications.info(selector ? `Selector: ${selector}` : "No element under the cursor.");
      resolve(selector);
    };
    document.body.addEventListener("click", handler, true);
  });
}
