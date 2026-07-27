import { MODULE_ID, MODULE_NAME, CARTOON_VILLAINS_DISCORD, CRITICAL_DEPENDENCIES, applyColorScheme } from "../constants.mjs";
import { providerConfig, isConfigured } from "../settings.mjs";
import { AssistantDialog } from "../assistant/assistant-dialog.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** Dependencies whose health Pseudo reports on — the feature-bearing ones plus lib-wrapper, which
 * has no feature of its own but is still worth surfacing here since it's a hard dependency too. */
const DEPENDENCIES = [...CRITICAL_DEPENDENCIES.map((d) => d.id), "lib-wrapper"];

/**
 * A diagnostic report dialog: environment, Pseudo's configuration and dependency health, and the
 * active module list — as Markdown, ready to copy or export when getting help. Deliberately never
 * includes the API key (only whether one is configured).
 */
export class Troubleshooter extends HandlebarsApplicationMixin(ApplicationV2) {
  /** @type {?Troubleshooter} */
  static #instance = null;

  /** @override */
  static DEFAULT_OPTIONS = {
    id: "cv-pseudo-troubleshooter",
    tag: "div",
    classes: ["cv-pseudo", "cvp-troubleshooter"],
    window: {
      title: "CVP.Trouble.Title",
      icon: "fa-solid fa-stethoscope",
      resizable: true
    },
    position: { width: 680, height: "auto" },
    actions: {
      diagnose: Troubleshooter.#onDiagnose,
      copyReport: Troubleshooter.#onCopyReport,
      exportReport: Troubleshooter.#onExportReport,
      openDiscord: Troubleshooter.#onOpenDiscord
    }
  };

  /** @override */
  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/troubleshooter.hbs` }
  };

  /**
   * Open the troubleshooter, or focus it if already open.
   * @returns {Troubleshooter}
   */
  static open() {
    if (!this.#instance) this.#instance = new Troubleshooter();
    this.#instance.render(true);
    return this.#instance;
  }

  /** @override */
  async close(options) {
    if (Troubleshooter.#instance === this) Troubleshooter.#instance = null;
    return super.close(options);
  }

  /** @override */
  async _prepareContext(_options) {
    return { report: Troubleshooter.generateReport() };
  }

  /** @override */
  async _onRender(context, options) {
    await super._onRender(context, options);
    applyColorScheme(this.element);
  }

  /**
   * Build the Markdown diagnostic report.
   * @returns {string}
   */
  static generateReport() {
    const lines = [];
    const mod = game.modules.get(MODULE_ID);
    const cfg = providerConfig();

    lines.push(`# ${MODULE_NAME} Troubleshooter Report`);
    lines.push(`_Generated: ${new Date().toLocaleString()}_`);
    lines.push("");

    lines.push("## Environment");
    lines.push(`- **Foundry VTT**: v${game.version}`);
    lines.push(`- **System**: ${game.system.id} v${game.system.version}`);
    lines.push(`- **World**: ${game.world.id}`);
    lines.push(`- **Language**: ${game.settings.get("core", "language")}`);
    lines.push(`- **Browser**: ${navigator.userAgent}`);
    lines.push("");

    lines.push("## Pseudo");
    lines.push(`- **Version**: v${mod?.version ?? "unknown"}`);
    lines.push(`- **Provider**: ${cfg.provider}`);
    lines.push(`- **Model**: ${cfg.model || "(none set)"}`);
    lines.push(`- **API key configured**: ${isConfigured() ? "yes" : "no"}`); // never the key itself
    lines.push(`- **Custom base URL**: ${cfg.baseUrl ? "yes" : "no"}`);
    lines.push("");

    lines.push("## Dependencies");
    for (const id of DEPENDENCIES) {
      const dep = game.modules.get(id);
      const state = dep ? (dep.active ? `active v${dep.version}` : `installed but INACTIVE v${dep.version}`) : "NOT INSTALLED";
      lines.push(`- **${id}**: ${state}`);
    }
    if (game.modules.get("spotlight-omnisearch")?.active) {
      const index = CONFIG?.SpotlightOmnisearch?.INDEX;
      const size = Array.isArray(index) ? index.length : "not built";
      let journalIndex = "unknown";
      try {
        journalIndex = game.settings.get("spotlight-omnisearch", "fullCompendiumJournalIndex");
      } catch {
        /* setting absent on this version */
      }
      lines.push(`- **Omnisearch index size**: ${size}`);
      lines.push(`- **Omnisearch journal-heading index**: ${journalIndex}`);
    }
    lines.push("");

    const active = game.modules.filter((m) => m.active).sort((a, b) => a.id.localeCompare(b.id));
    lines.push(`## Active Modules (${active.length})`);
    for (const m of active) lines.push(`- **${m.id}**: v${m.version}`);
    lines.push("");

    return lines.join("\n");
  }

  /* -------------------------------------------- */
  /*  Actions                                     */
  /* -------------------------------------------- */

  /**
   * Hand the report to Pseudo and ask it to spot problems. The troubleshooter stays open so its
   * report sits beside Pseudo's diagnosis.
   * @this {Troubleshooter}
   */
  static #onDiagnose() {
    const report = Troubleshooter.generateReport();
    AssistantDialog.askWith(game.i18n.localize("CVP.Trouble.DiagnosePrompt"), report);
  }

  /** @this {Troubleshooter} */
  static async #onCopyReport() {
    await game.clipboard.copyPlainText(Troubleshooter.generateReport());
    ui.notifications.info(game.i18n.localize("CVP.Trouble.Copied"));
  }

  /** @this {Troubleshooter} */
  static #onExportReport() {
    const filename = `pseudo-troubleshooter-${new Date().toISOString().replace(/[:.]/g, "-")}.md`;
    foundry.utils.saveDataToFile(Troubleshooter.generateReport(), "text/markdown", filename);
    ui.notifications.info(game.i18n.localize("CVP.Trouble.Exported"));
  }

  /** @this {Troubleshooter} */
  static #onOpenDiscord() {
    window.open(CARTOON_VILLAINS_DISCORD, "_blank", "noopener");
  }
}
