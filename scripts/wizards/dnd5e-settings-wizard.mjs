import { MODULE_ID, MODULE_NAME, log } from "../constants.mjs";
import { highlightByKey } from "../ui/highlight.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** Linear step sequence. */
const STEPS = ["intro", "foundation", "combat", "campaignStyle", "visibility", "closing"];

/**
 * Read a dnd5e-namespaced setting, tolerating a missing key across dnd5e versions.
 * @param {string} key
 * @returns {*}
 */
function getDnd5e(key) {
  try {
    return game.settings.get("dnd5e", key);
  } catch {
    return undefined;
  }
}

/**
 * The localized label for a setting's current value, when that setting is a choice field.
 * @param {string} namespace "core" or "dnd5e"
 * @param {string} key
 * @param {*} value
 * @returns {?string}
 */
function choiceLabel(namespace, key, value) {
  const s = game.settings.settings.get(`${namespace}.${key}`);
  const raw = s?.choices?.[value];
  return raw ? game.i18n.localize(raw) : null;
}

/**
 * core.gridDiagonals has no static `choices` map (its options are built dynamically by core), so it
 * needs its own label lookup instead of going through choiceLabel().
 * @type {Record<number, string>}
 */
const GRID_DIAGONAL_LABELS = {
  [CONST.GRID_DIAGONALS.EQUIDISTANT]: "Equidistant (every diagonal costs 5ft)",
  [CONST.GRID_DIAGONALS.EXACT]: "Exact (true Euclidean distance)",
  [CONST.GRID_DIAGONALS.APPROXIMATE]: "Approximate",
  [CONST.GRID_DIAGONALS.RECTILINEAR]: "Rectilinear",
  [CONST.GRID_DIAGONALS.ALTERNATING_1]: "Alternating (5/10/5 — first diagonal 5ft)",
  [CONST.GRID_DIAGONALS.ALTERNATING_2]: "Alternating (5/10/5 — first diagonal 10ft)",
  [CONST.GRID_DIAGONALS.ILLEGAL]: "Illegal (no diagonal movement)"
};

/**
 * Open one of dnd5e's own settings menu dialogs directly — the same dialog a GM would reach by
 * clicking through Configure Settings themselves. Pseudo only navigates them there; every value is
 * still the GM's own click.
 * @param {string} menuKey e.g. "combatConfiguration"
 * @returns {void}
 */
function openDnd5eMenu(menuKey) {
  const menu = game.settings.menus.get(`dnd5e.${menuKey}`);
  if (!menu?.type) {
    ui.notifications.warn("Couldn't find that settings menu — it may have moved in a newer dnd5e version.");
    return;
  }
  new menu.type().render(true);
}

/**
 * A read-only, educational walkthrough of dnd5e's own rules settings: what each one does, and
 * concrete reasons a table might want it on or off, so the GM can make an informed choice and pick
 * up some system knowledge along the way. Deliberately changes nothing — every "open" button lands
 * the GM on Foundry's own settings dialog, where they make the actual change themselves.
 */
export class Dnd5eSettingsWizard extends HandlebarsApplicationMixin(ApplicationV2) {
  /** @type {Dnd5eSettingsWizard|null} */
  static #instance = null;

  /** @type {number} Index into STEPS. */
  #stepIndex = 0;

  /** @override */
  static DEFAULT_OPTIONS = {
    id: "cv-pseudo-dnd5e-settings-wizard",
    tag: "div",
    classes: ["cv-pseudo", "cvp-portability-wizard", "cvp-dnd5e-settings-wizard"],
    window: {
      title: "CVP.Dnd5eSettings.Title",
      icon: "fa-solid fa-dice-d20",
      resizable: true
    },
    position: { width: 640, height: "auto" },
    actions: {
      next: Dnd5eSettingsWizard.#onNext,
      back: Dnd5eSettingsWizard.#onBack,
      openMenu: Dnd5eSettingsWizard.#onOpenMenu,
      showMe: Dnd5eSettingsWizard.#onShowMe
    }
  };

  /** @override */
  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/dnd5e-settings-wizard.hbs` }
  };

  /**
   * Open the wizard, or focus it if already open.
   * @returns {Dnd5eSettingsWizard} The live instance.
   */
  static open() {
    if (!this.#instance) this.#instance = new Dnd5eSettingsWizard();
    this.#instance.render(true);
    return this.#instance;
  }

  /** @returns {string} The current step id. */
  get #step() {
    return STEPS[this.#stepIndex];
  }

  /** @override */
  async _prepareContext(_options) {
    const step = this.#step;

    return {
      moduleName: MODULE_NAME,
      step,
      isIntro: step === "intro",
      isFoundation: step === "foundation",
      isCombat: step === "combat",
      isCampaignStyle: step === "campaignStyle",
      isVisibility: step === "visibility",
      isClosing: step === "closing",
      stepNumber: this.#stepIndex + 1,
      totalSteps: STEPS.length,
      canBack: this.#stepIndex > 0,

      // Foundation
      rulesVersionCurrent: choiceLabel("dnd5e", "rulesVersion", getDnd5e("rulesVersion")),
      gridDiagonalsCurrent: GRID_DIAGONAL_LABELS[game.settings.get("core", "gridDiagonals")] ?? "Unknown",

      // Combat
      dexTiebreakerCurrent: getDnd5e("initiativeDexTiebreaker") ? "On" : "Off",
      initiativeScoreCurrent: choiceLabel("dnd5e", "initiativeScore", getDnd5e("initiativeScore")),
      critMultiplyCurrent: getDnd5e("criticalDamageModifiers") ? "On" : "Off",
      critMaximizeCurrent: getDnd5e("criticalDamageMaxDice") ? "On" : "Off",
      rechargeCurrent: choiceLabel("dnd5e", "autoRecharge", getDnd5e("autoRecharge")),
      npcHpCurrent: choiceLabel("dnd5e", "autoRollNPCHP", getDnd5e("autoRollNPCHP")),

      // Campaign style
      restVariantCurrent: choiceLabel("dnd5e", "restVariant", getDnd5e("restVariant")),
      proficiencyCurrent: choiceLabel("dnd5e", "proficiencyModifier", getDnd5e("proficiencyModifier")),
      levelingModeCurrent: choiceLabel("dnd5e", "levelingMode", getDnd5e("levelingMode")),
      encumbranceCurrent: choiceLabel("dnd5e", "encumbrance", getDnd5e("encumbrance")),
      currencyWeightCurrent: getDnd5e("currencyWeight") ? "On" : "Off",
      honorScoreCurrent: getDnd5e("honorScore") ? "On" : "Off",
      sanityScoreCurrent: getDnd5e("sanityScore") ? "On" : "Off",

      // Visibility
      challengeVisibilityCurrent: choiceLabel("dnd5e", "challengeVisibility", getDnd5e("challengeVisibility")),
      attackVisibilityCurrent: choiceLabel("dnd5e", "attackRollVisibility", getDnd5e("attackRollVisibility")),
      bloodiedCurrent: choiceLabel("dnd5e", "bloodied", getDnd5e("bloodied")),
      concealDescriptionsCurrent: getDnd5e("concealItemDescriptions") ? "On" : "Off"
    };
  }

  /* -------------------------------------------- */
  /*  Actions                                     */
  /* -------------------------------------------- */

  /** @this {Dnd5eSettingsWizard} */
  static #onNext() {
    this.#stepIndex = Math.min(this.#stepIndex + 1, STEPS.length - 1);
    this.render();
  }

  /** @this {Dnd5eSettingsWizard} */
  static #onBack() {
    this.#stepIndex = Math.max(this.#stepIndex - 1, 0);
    this.render();
  }

  /**
   * @this {Dnd5eSettingsWizard}
   * @param {Event} _event
   * @param {HTMLElement} target
   */
  static #onOpenMenu(_event, target) {
    const menuKey = target?.dataset?.menu;
    if (menuKey) openDnd5eMenu(menuKey);
  }

  /**
   * @this {Dnd5eSettingsWizard}
   * @param {Event} _event
   * @param {HTMLElement} target
   */
  static #onShowMe(_event, target) {
    const key = target?.dataset?.key;
    if (key) highlightByKey(key);
  }
}

log("dnd5e settings wizard loaded");
