import { MODULE_ID, MODULE_NAME, applyColorScheme, log } from "../constants.mjs";
import { highlightByKey } from "../ui/highlight.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** Linear step sequence. */
const STEPS = ["pitch", "select", "adventure", "module", "handoff"];

/** World document collections to scan for Tagger tags, and the label shown per type. */
const SCAN_COLLECTIONS = {
  actors: { get: () => game.actors, label: "Actor" },
  items: { get: () => game.items, label: "Item" },
  journal: { get: () => game.journal, label: "Journal Entry" },
  scenes: { get: () => game.scenes, label: "Scene" },
  tables: { get: () => game.tables, label: "Roll Table" },
  cards: { get: () => game.cards, label: "Cards" },
  playlists: { get: () => game.playlists, label: "Playlist" },
  macros: { get: () => game.macros, label: "Macro" }
};

/**
 * Scan every world document collection for Tagger tags, grouping documents by tag. Returns an empty
 * map if Tagger isn't installed/active — smart selection is an enhancement, not a hard dependency.
 * @returns {Array<{tag: string, count: number, byType: Array<{label: string, count: number}>}>}
 *   Sorted by document count, descending.
 */
function scanTagGroups() {
  const groups = new Map();
  if (!game.modules.get("tagger")?.active) return [];

  for (const { get, label } of Object.values(SCAN_COLLECTIONS)) {
    for (const doc of get().contents) {
      const tags = doc.getFlag("tagger", "tags") ?? [];
      for (const tag of tags) {
        if (!groups.has(tag)) groups.set(tag, { tag, count: 0, byType: new Map() });
        const group = groups.get(tag);
        group.count++;
        group.byType.set(label, (group.byType.get(label) ?? 0) + 1);
      }
    }
  }

  return [...groups.values()]
    .map((g) => ({ tag: g.tag, count: g.count, byType: [...g.byType.entries()].map(([label, count]) => ({ label, count })) }))
    .sort((a, b) => b.count - a.count);
}

/**
 * Gather the actual World documents matching the selected tags, grouped by the Adventure schema
 * field they belong under (the SCAN_COLLECTIONS keys already match those field names exactly).
 * @param {Set<string>} selectedTags
 * @returns {Record<string, ClientDocument[]>}
 */
function collectTaggedDocuments(selectedTags) {
  const result = {};
  if (!selectedTags.size) return result;
  for (const [field, { get }] of Object.entries(SCAN_COLLECTIONS)) {
    const matched = get().contents.filter((doc) => {
      const tags = doc.getFlag("tagger", "tags") ?? [];
      return tags.some((t) => selectedTags.has(t));
    });
    if (matched.length) result[field] = matched;
  }
  return result;
}

/** Fixed, predictable pack name so re-running the wizard reuses the same pack rather than making a new one each time. */
const PORTABLE_PACK_NAME = "cv-pseudo-portable-campaign";

/**
 * Find this World's portable-campaign Adventure pack, creating it on first use.
 * @returns {Promise<CompendiumCollection>}
 */
async function getOrCreatePortablePack() {
  const existing = game.packs.get(`world.${PORTABLE_PACK_NAME}`);
  if (existing) return existing;
  return CompendiumCollection.createCompendium({
    type: "Adventure",
    name: PORTABLE_PACK_NAME,
    label: "Portable Campaign (built with Pseudo)"
  });
}

/**
 * Turn a display name into a safe module/package id: lowercase, hyphenated, alphanumeric only.
 * @param {string} text
 * @returns {string}
 */
function slugify(text) {
  return (
    text
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "my-campaign"
  );
}

/**
 * Walks a GM through turning their campaign into a real, portable Foundry module: why it's worth
 * doing now, picking what belongs to it (via Tagger tags already in use), building it into a native
 * Adventure using Foundry's own Adventure Pack/Builder, and generating the module.json needed to
 * package it as a standalone, installable module — handing off to the Setup screen only for the one
 * step that genuinely requires it (a running World can't create a new package for itself).
 */
export class CampaignPortableWizard extends HandlebarsApplicationMixin(ApplicationV2) {
  /** @type {CampaignPortableWizard|null} */
  static #instance = null;

  /** @type {number} Index into STEPS. */
  #stepIndex = 0;

  /** @type {Set<string>} Tags the GM has picked as belonging to this campaign. */
  #selectedTags = new Set();

  /** @type {?Array} Cached scan result, computed once per wizard open (tags don't change mid-flow). */
  #tagGroups = null;

  /** @type {string} Draft name for the Adventure/eventual module, defaults to the World's title. */
  #campaignName = game.world.title;

  /** @type {?Adventure} The Adventure document once created. */
  #adventure = null;

  /** @type {boolean} True while the create-Adventure request is in flight. */
  #creatingAdventure = false;

  /** @type {string} Draft module id, defaults to a slug of the campaign name once Step 4 is reached. */
  #moduleId = "";

  /** @type {boolean} True while the module-folder scaffold is being created/refreshed on disk. */
  #settingUpModule = false;

  /** @type {?boolean} Cached "does modules/<id>/module.json exist" check, refreshed each Handoff render. */
  #moduleFolderReady = null;

  /** @type {boolean} Self-reported by the GM: "I've copied the Adventure pack's data folder in." */
  #packCopyConfirmed = false;

  /** @override */
  static DEFAULT_OPTIONS = {
    id: "cv-pseudo-portability-wizard",
    tag: "div",
    classes: ["cv-pseudo", "cvp-portability-wizard"],
    window: {
      title: "CVP.Portability.Title",
      icon: "fa-solid fa-box-archive",
      resizable: true
    },
    position: { width: 640, height: "auto" },
    actions: {
      next: CampaignPortableWizard.#onNext,
      back: CampaignPortableWizard.#onBack,
      createAdventure: CampaignPortableWizard.#onCreateAdventure,
      reopenBuilder: CampaignPortableWizard.#onReopenBuilder,
      copyManifest: CampaignPortableWizard.#onCopyManifest,
      downloadManifest: CampaignPortableWizard.#onDownloadManifest,
      setupModuleFolder: CampaignPortableWizard.#onSetupModuleFolder,
      recheckStatus: CampaignPortableWizard.#onRecheckStatus,
      finish: CampaignPortableWizard.#onFinish,
      showMe: CampaignPortableWizard.#onShowMe
    }
  };

  /** @override */
  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/campaign-portable-wizard.hbs` }
  };

  /**
   * Open the wizard, or focus it if already open.
   * @returns {CampaignPortableWizard} The live instance.
   */
  static open() {
    if (!this.#instance) this.#instance = new CampaignPortableWizard();
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
    if (step === "select" && !this.#tagGroups) this.#tagGroups = scanTagGroups();
    if (step === "module" && !this.#moduleId) this.#moduleId = slugify(this.#campaignName);
    if (step === "handoff") this.#moduleFolderReady = await this.#checkModuleFolder();

    const { packName } = this.#packInfo();

    return {
      moduleName: MODULE_NAME,
      step,
      isPitch: step === "pitch",
      isSelect: step === "select",
      isAdventure: step === "adventure",
      isModule: step === "module",
      isHandoff: step === "handoff",
      stepNumber: this.#stepIndex + 1,
      totalSteps: STEPS.length,
      canBack: this.#stepIndex > 0,
      taggerActive: game.modules.get("tagger")?.active ?? false,
      tagGroups: (this.#tagGroups ?? []).map((g) => ({
        ...g,
        selected: this.#selectedTags.has(g.tag),
        summary: g.byType.map((t) => `${t.count} ${t.label}${t.count === 1 ? "" : "s"}`).join(", ")
      })),
      hasTagGroups: (this.#tagGroups ?? []).length > 0,
      selectedCount: this.#selectedTags.size,
      campaignName: this.#campaignName,
      tagPreview: this.#selectedTags.size ? [...this.#selectedTags].join(", ") : null,
      matchPreview: this.#matchPreviewText(),
      creatingAdventure: this.#creatingAdventure,
      hasAdventure: Boolean(this.#adventure),
      adventureName: this.#adventure?.name ?? "",
      adventureSummary: this.#adventure ? this.#contentSummaryText(this.#adventure) : "",
      moduleId: this.#moduleId,
      manifestText: this.#adventure ? JSON.stringify(this.#buildManifest(), null, 2) : "",
      packDiskPath: this.#adventure ? game.packs.get(this.#adventure.pack)?.metadata.path ?? "" : "",
      packName,
      targetModulePath: `modules/${this.#moduleId}`,
      targetPackPath: `modules/${this.#moduleId}/packs/${packName}`,
      moduleFolderReady: this.#moduleFolderReady,
      settingUpModule: this.#settingUpModule,
      moduleActive: game.modules.get(this.#moduleId)?.active ?? false,
      packCopyConfirmed: this.#packCopyConfirmed
    };
  }

  /**
   * The Adventure pack's collection name and game system id, used both for the manifest and the
   * Handoff step's on-disk paths.
   * @returns {{packName: string, packSystem: ?string}}
   */
  #packInfo() {
    const packCollection = game.packs.get(this.#adventure?.pack);
    return {
      packName: packCollection?.metadata.name ?? PORTABLE_PACK_NAME,
      packSystem: packCollection?.metadata.system
    };
  }

  /**
   * Build the module.json content for the standalone module wrapping this campaign's Adventure pack.
   * @returns {object}
   */
  #buildManifest() {
    const { packName, packSystem } = this.#packInfo();
    return {
      id: this.#moduleId,
      title: this.#campaignName,
      description: `A portable Foundry module for the "${this.#campaignName}" campaign.`,
      version: "1.0.0",
      compatibility: { minimum: game.release.generation, verified: game.release.generation },
      authors: [{ name: game.user.name }],
      packs: [
        {
          name: packName,
          label: this.#campaignName,
          path: `packs/${packName}`,
          type: "Adventure",
          ...(packSystem ? { system: packSystem } : {})
        }
      ]
    };
  }

  /**
   * Check whether modules/<id>/module.json already exists on disk — the Handoff step's live status.
   * @returns {Promise<boolean>}
   */
  async #checkModuleFolder() {
    if (!this.#moduleId) return false;
    try {
      const { files } = await FilePicker.browse("data", `modules/${this.#moduleId}`);
      return files.includes(`modules/${this.#moduleId}/module.json`);
    } catch {
      return false;
    }
  }

  /**
   * A quick "what will be included" preview for Step 3, before the Adventure actually exists.
   * @returns {string}
   */
  #matchPreviewText() {
    if (!this.#selectedTags.size) return "Nothing pre-selected — you'll add content by hand in the Adventure Builder.";
    const matched = collectTaggedDocuments(this.#selectedTags);
    const total = Object.values(matched).reduce((sum, docs) => sum + docs.length, 0);
    if (!total) return "Nothing pre-selected — you'll add content by hand in the Adventure Builder.";
    const parts = Object.entries(matched).map(([field, docs]) => `${docs.length} ${SCAN_COLLECTIONS[field].label}${docs.length === 1 ? "" : "s"}`);
    return `Will start with: ${parts.join(", ")}.`;
  }

  /**
   * Summarize an Adventure document's actual contents, e.g. "2 Actors, 1 Scene".
   * @param {Adventure} adventure
   * @returns {string}
   */
  #contentSummaryText(adventure) {
    const parts = [];
    for (const [field, { label }] of Object.entries(SCAN_COLLECTIONS)) {
      const count = adventure[field]?.size ?? 0;
      if (count) parts.push(`${count} ${label}${count === 1 ? "" : "s"}`);
    }
    return parts.length ? parts.join(", ") : "empty so far";
  }

  /** @override */
  async _onRender(context, options) {
    await super._onRender(context, options);
    applyColorScheme(this.element);

    // Live-update the "N tag(s) selected" hint on click, rather than only after the next full
    // render (navigating away and back) — a full re-render per checkbox would be needless flicker.
    const hint = this.element.querySelector(".cvp-wizard-hint");
    if (hint) {
      this.element.querySelectorAll('input[name="campaignTag"]').forEach((el) => {
        el.addEventListener("change", () => {
          const count = this.element.querySelectorAll('input[name="campaignTag"]:checked').length;
          hint.textContent = `${count} tag(s) selected. Leave everything unchecked to skip straight to manual selection.`;
        });
      });
    }

    // Live-update the generated module.json preview as the module id is edited, rather than only
    // reflecting it after navigating away and back.
    const idInput = this.element.querySelector(".cvp-wizard-module-id");
    const preview = this.element.querySelector(".cvp-wizard-manifest-preview");
    if (idInput && preview) {
      idInput.addEventListener("input", () => {
        const draftId = slugify(idInput.value.trim() || "my-campaign");
        const original = this.#moduleId;
        this.#moduleId = draftId;
        preview.textContent = JSON.stringify(this.#buildManifest(), null, 2);
        this.#moduleId = original; // don't commit until Next/Copy/Download actually capture it
      });
    }

    // Persist the "I've copied it" checkbox across the re-renders that recheckStatus/setupModuleFolder
    // trigger, since it's purely self-reported and nothing else drives its state.
    const packCopyCheckbox = this.element.querySelector(".cvp-wizard-pack-copy-confirmed");
    if (packCopyCheckbox) {
      packCopyCheckbox.addEventListener("change", () => {
        this.#packCopyConfirmed = packCopyCheckbox.checked;
      });
    }
  }

  /** @override */
  async close(options) {
    if (CampaignPortableWizard.#instance === this) CampaignPortableWizard.#instance = null;
    return super.close(options);
  }

  /* -------------------------------------------- */
  /*  Actions                                     */
  /* -------------------------------------------- */

  /** @this {CampaignPortableWizard} */
  static async #onNext() {
    if (this.#step === "select") {
      const checked = this.element.querySelectorAll('input[name="campaignTag"]:checked');
      this.#selectedTags = new Set([...checked].map((el) => el.value));
    } else if (this.#step === "adventure") {
      const nameInput = this.element.querySelector(".cvp-wizard-campaign-name");
      if (nameInput?.value?.trim()) this.#campaignName = nameInput.value.trim();
      if (!this.#adventure && !(await this.#confirmSkipAdventure())) return;
    } else if (this.#step === "module") {
      this.#captureModuleId();
    }
    this.#stepIndex = Math.min(this.#stepIndex + 1, STEPS.length - 1);
    this.render();
  }

  /**
   * Warn before leaving the Build the Adventure step without actually creating one — Next otherwise
   * advances silently, and it's easy to not notice you skipped the step where content gets packaged.
   * @this {CampaignPortableWizard}
   * @returns {Promise<boolean>} True if the GM chose to skip anyway.
   */
  async #confirmSkipAdventure() {
    const { DialogV2 } = foundry.applications.api;
    return DialogV2.confirm({
      window: { title: "Skip Building the Adventure?", icon: "fa-solid fa-triangle-exclamation" },
      content:
        "<p>You haven't created the Adventure yet — this is the step where your campaign's actual " +
        "content gets packaged. Skip it now and the next steps will have nothing to work with.</p>" +
        "<p>You can always come back to this step later.</p>",
      yes: { label: "Skip anyway" },
      no: { label: "Go back and create it", default: true }
    }).catch(() => false);
  }

  /** @this {CampaignPortableWizard} */
  static #onBack() {
    this.#stepIndex = Math.max(this.#stepIndex - 1, 0);
    this.render();
  }

  /**
   * Create the Adventure — reusing this World's portable-campaign pack — pre-populated with
   * whatever the selected tags matched, then open Foundry's own Adventure Builder so the GM can
   * review, add, or remove content before moving on.
   * @this {CampaignPortableWizard}
   * @returns {Promise<void>}
   */
  static async #onCreateAdventure() {
    const nameInput = this.element.querySelector(".cvp-wizard-campaign-name");
    if (nameInput?.value?.trim()) this.#campaignName = nameInput.value.trim();

    this.#creatingAdventure = true;
    this.render();

    try {
      const pack = await getOrCreatePortablePack();
      const matched = collectTaggedDocuments(this.#selectedTags);
      const createData = { name: this.#campaignName };
      for (const [field, docs] of Object.entries(matched)) createData[field] = docs.map((d) => d.toObject());

      this.#adventure = await Adventure.create(createData, { pack: pack.collection });
      new foundry.applications.sheets.AdventureExporter({ document: this.#adventure }).render(true);
      log(`created portable-campaign Adventure "${this.#campaignName}" in ${pack.collection}`);
    } catch (err) {
      ui.notifications.error(`Couldn't create the Adventure: ${err.message}`);
    } finally {
      this.#creatingAdventure = false;
      this.render();
    }
  }

  /** @this {CampaignPortableWizard} */
  static #onReopenBuilder() {
    if (!this.#adventure) return;
    new foundry.applications.sheets.AdventureExporter({ document: this.#adventure }).render(true);
  }

  /** @this {CampaignPortableWizard} */
  static async #onCopyManifest() {
    this.#captureModuleId();
    await game.clipboard.copyPlainText(JSON.stringify(this.#buildManifest(), null, 2));
    ui.notifications.info("module.json copied to clipboard.");
    this.render();
  }

  /** @this {CampaignPortableWizard} */
  static #onDownloadManifest() {
    this.#captureModuleId();
    const text = JSON.stringify(this.#buildManifest(), null, 2);
    foundry.utils.saveDataToFile(text, "application/json", "module.json");
    this.render();
  }

  /** Read the module-id input (if present) into #moduleId, slugified. */
  #captureModuleId() {
    const idInput = this.element.querySelector(".cvp-wizard-module-id");
    if (idInput?.value?.trim()) this.#moduleId = slugify(idInput.value.trim());
  }

  /**
   * Create (or refresh) the standalone module's on-disk scaffold: the module folder itself, an empty
   * packs/<name> folder ready to receive the Adventure's data, and a module.json matching the current
   * campaign name/module id. This is everything that CAN be done without leaving the running World —
   * copying the Adventure pack's actual LevelDB files still can't be, since FilePicker can't see or
   * move the extension-less files (CURRENT, LOCK, LOG, MANIFEST-*) that make up its data.
   * @this {CampaignPortableWizard}
   * @returns {Promise<void>}
   */
  static async #onSetupModuleFolder() {
    this.#settingUpModule = true;
    this.render();

    try {
      const { packName } = this.#packInfo();
      const dirs = [
        `modules/${this.#moduleId}`,
        `modules/${this.#moduleId}/packs`,
        `modules/${this.#moduleId}/packs/${packName}`
      ];
      for (const dir of dirs) {
        try {
          await FilePicker.createDirectory("data", dir);
        } catch (err) {
          if (!String(err.message ?? err).includes("EEXIST")) throw err;
        }
      }

      const manifestText = JSON.stringify(this.#buildManifest(), null, 2);
      const file = new File([new Blob([manifestText], { type: "application/json" })], "module.json", { type: "application/json" });
      await FilePicker.upload("data", `modules/${this.#moduleId}`, file, {}, { notify: false });

      this.#moduleFolderReady = true;
      ui.notifications.info(`Created modules/${this.#moduleId}/ with module.json.`);
    } catch (err) {
      ui.notifications.error(`Couldn't set up the module folder: ${err.message}`);
    } finally {
      this.#settingUpModule = false;
      this.render();
    }
  }

  /** Just re-render — _prepareContext recomputes the module-folder and module-active checks fresh each time. @this {CampaignPortableWizard} */
  static #onRecheckStatus() {
    this.render();
  }

  /** @this {CampaignPortableWizard} */
  static #onFinish() {
    this.close();
  }

  /**
   * Spotlight a verified UI target via Remote Highlight UI (a hard dependency of cv-pseudo, so this
   * is always available). No-ops harmlessly if the key is unknown.
   * @this {CampaignPortableWizard}
   * @param {PointerEvent} _event
   * @param {HTMLElement} target The clicked "Show me" button.
   */
  static #onShowMe(_event, target) {
    const key = target?.dataset?.key;
    if (key) highlightByKey(key);
  }
}

log("campaign portability wizard loaded");
