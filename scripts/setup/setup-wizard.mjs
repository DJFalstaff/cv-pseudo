import { MODULE_ID, MODULE_NAME, SETTINGS, DEFAULT_MODEL, applyColorScheme, log } from "../constants.mjs";
import { callGemini } from "../llm/providers/gemini.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** Where a GM creates their free key. */
const STUDIO_URL = "https://aistudio.google.com/app/apikey";

/**
 * First-run onboarding for the GM: a friendly walkthrough for creating a free Google AI Studio key
 * and validating it before it's saved.
 *
 * The "Test & Save" button fires a tiny real request with the pasted key. Only if it succeeds is the
 * key stored — so a GM never leaves the wizard with a broken key that fails mid-session. This also
 * doubles as a check on the default model id: a wrong model surfaces here as a clear error.
 */
export class SetupWizard extends HandlebarsApplicationMixin(ApplicationV2) {
  /** @type {SetupWizard|null} */
  static #instance = null;

  /** @type {"idle"|"testing"|"success"|"error"} */
  #status = "idle";

  /** @type {string} A user-facing status/error line. */
  #message = "";

  /** @type {string} The key the GM last typed, kept across re-renders so a failed test needn't re-paste. */
  #draftKey = "";

  /** @type {string} The model the GM last typed, kept across re-renders. */
  #draftModel = "";

  /** @override */
  static DEFAULT_OPTIONS = {
    id: "cv-pseudo-setup",
    tag: "div",
    classes: ["cv-pseudo", "cvp-setup"],
    window: {
      title: "CVP.Setup.Title",
      icon: "fa-solid fa-dragon",
      resizable: true
    },
    position: { width: 540, height: "auto" },
    actions: {
      openStudio: SetupWizard.#onOpenStudio,
      testAndSave: SetupWizard.#onTestAndSave,
      dismiss: SetupWizard.#onDismiss
    }
  };

  /** @override */
  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/setup-wizard.hbs` }
  };

  /**
   * Open the wizard, or focus it if already open.
   * @returns {SetupWizard} The live instance.
   */
  static open() {
    if (!this.#instance) this.#instance = new SetupWizard();
    this.#instance.render(true);
    return this.#instance;
  }

  /**
   * Show the wizard to a GM on load, unless they already have a key or have dismissed it.
   * @returns {void}
   */
  static maybeGreet() {
    if (!game.user.isGM) return;
    if (game.settings.get(MODULE_ID, SETTINGS.SETUP_DISMISSED)) return;
    if (game.settings.get(MODULE_ID, SETTINGS.API_KEY)) return;
    this.open();
  }

  /** @override */
  async _prepareContext(_options) {
    return {
      moduleName: MODULE_NAME,
      studioUrl: STUDIO_URL,
      apiKeyDraft: this.#draftKey,
      model: this.#draftModel || game.settings.get(MODULE_ID, SETTINGS.MODEL) || DEFAULT_MODEL,
      status: this.#status,
      message: this.#message,
      testing: this.#status === "testing",
      success: this.#status === "success",
      errored: this.#status === "error"
    };
  }

  /** @override */
  async _onRender(context, options) {
    await super._onRender(context, options);
    applyColorScheme(this.element);
    if (this.#status !== "success") this.element.querySelector(".cvp-key-input")?.focus();
  }

  /** @override */
  async close(options) {
    if (SetupWizard.#instance === this) SetupWizard.#instance = null;
    return super.close(options);
  }

  /* -------------------------------------------- */
  /*  Actions                                     */
  /* -------------------------------------------- */

  /** @this {SetupWizard} */
  static #onOpenStudio() {
    window.open(STUDIO_URL, "_blank", "noopener");
  }

  /**
   * Validate the pasted key with a tiny live call, then save it only on success.
   * @this {SetupWizard}
   * @returns {Promise<void>}
   */
  static async #onTestAndSave() {
    const key = this.element.querySelector(".cvp-key-input")?.value?.trim();
    if (!key) {
      this.#fail(game.i18n.localize("CVP.Setup.NeedKey"));
      return;
    }
    const model = this.element.querySelector(".cvp-model-input")?.value?.trim() || DEFAULT_MODEL;
    this.#draftKey = key;
    this.#draftModel = model;

    this.#status = "testing";
    this.#message = "";
    await this.render();

    try {
      const cfg = { provider: "gemini", apiKey: key, model, baseUrl: "" };
      await callGemini(cfg, "Reply with the single word: Success");

      await game.settings.set(MODULE_ID, SETTINGS.PROVIDER, "gemini");
      await game.settings.set(MODULE_ID, SETTINGS.MODEL, model);
      await game.settings.set(MODULE_ID, SETTINGS.API_KEY, key);
      await game.settings.set(MODULE_ID, SETTINGS.SETUP_DISMISSED, true);

      this.#status = "success";
      this.#message = "";
      await this.render();
      log("setup complete — key validated and saved");
    } catch (err) {
      this.#fail(game.i18n.format("CVP.Setup.ErrorPrefix", { error: err.message }));
    }
  }

  /** @this {SetupWizard} */
  static async #onDismiss() {
    await game.settings.set(MODULE_ID, SETTINGS.SETUP_DISMISSED, true);
    this.close();
  }

  /* -------------------------------------------- */

  /**
   * Move to the error state with a message and re-render.
   * @param {string} message The line to show.
   * @returns {void}
   */
  #fail(message) {
    this.#status = "error";
    this.#message = message;
    this.render();
  }
}
