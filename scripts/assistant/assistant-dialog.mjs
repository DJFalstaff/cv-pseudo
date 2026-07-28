import {
  MODULE_ID,
  MODULE_NAME,
  SETTINGS,
  CARTOON_VILLAINS_YOUTUBE,
  CARTOON_VILLAINS_DISCORD,
  CRITICAL_DEPENDENCIES,
  applyColorScheme,
  log
} from "../constants.mjs";
import { isConfigured } from "../settings.mjs";
import { askPseudo, NotConfiguredError } from "../llm/client.mjs";
import { NoGMError } from "../llm/relay.mjs";
import { highlightByKey } from "../ui/highlight.mjs";
import { openByUuid } from "../ui/open-document.mjs";
import { rollDice, rollTableById, runMacroById } from "../ui/actions.mjs";
import { getWizard, availableWizards } from "../wizards/registry.mjs";
import { openCoreSettingsPrompt } from "../setup/core-settings-tuning.mjs";
import { matchCommand, completionFor } from "./commands.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Example prompts shown as rotating placeholder text in the empty input, to suggest what Pseudo can
 * do — split into two pools by the kind of help they demonstrate. One random entry from the ACTIVE
 * pool shows on open, and they rotate every few seconds while the box is empty.
 */

/** Setup/system help: how-to questions about Foundry, the game system, or installed modules. */
const SETUP_PROMPTS = [
  "How do I add a player login?",
  "How do I get 3D dice?",
  "How do I create an NPC?",
  "How do I create a journal?",
  "How do I find a game rule?",
  "How do I make my campaign setting portable?",
  "How do I save my dice preset so it isn't lost?"
];

/** Narrative help: creative-generation prompts, dark-urban-fantasy leaning. Currently unused — see
 * ACTIVE_PROMPTS below — kept here so re-enabling later is a one-line change. */
const NARRATIVE_PROMPTS = [
  "Name five dive bars in a cursed harbor town",
  "Give me a plot hook for tonight's session",
  "Describe a twitchy informant who knows too much",
  "Invent a rival faction and its leader",
  "Roll three rumors overheard on the docks",
  "Suggest an eerie random encounter for a foggy night",
  "Name an occult bookshop and whoever's behind the counter",
  "Give this monster a memorable weakness",
  "Turn an abandoned tenement into three clues",
  "What would a desperate cultist offer as a bribe?"
];

/** Focused on setup/system help for now — swap in NARRATIVE_PROMPTS or [...SETUP_PROMPTS,
 * ...NARRATIVE_PROMPTS] here when that changes. */
const ACTIVE_PROMPTS = SETUP_PROMPTS;

/** @returns {string} A random example prompt. */
function randomExample() {
  return ACTIVE_PROMPTS[Math.floor(Math.random() * ACTIVE_PROMPTS.length)];
}

/** Cap on transcript lines kept in view, so a long session doesn't grow the DOM unbounded. */
const MAX_TRANSCRIPT = 50;

/**
 * Build the /pseudo command's answer: what Pseudo is, plus every visible setting and keybinding. Setting
 * names/hints are read live from Foundry's own settings registry rather than duplicated by hand, so
 * this can never drift out of sync with what's actually registered. Restricted (GM-only) settings are
 * only listed for a GM — a player can't see or change them, same as Foundry's own settings sheet.
 * @returns {string} Markdown.
 */
function pseudoAboutText() {
  const entries = [...game.settings.settings.entries()]
    .filter(([key, s]) => key.startsWith(`${MODULE_ID}.`) && s.config)
    .map(([, s]) => ({
      name: game.i18n.localize(s.name),
      hint: game.i18n.localize(s.hint),
      restricted: Boolean(s.restricted)
    }));
  const general = entries.filter((e) => !e.restricted);
  const connection = entries.filter((e) => e.restricted);

  const lines = [
    `**${MODULE_NAME}** is a system-neutral AI familiar for the GM — it reads your world (journals, ` +
      "actors, rules, installed modules) to answer questions, look things up, roll dice, spotlight UI, " +
      "and more. Type `/help` any time to see everything it can walk you through.",
    "",
    "**Preferences:**"
  ];
  for (const e of general) lines.push(`- **${e.name}** — ${e.hint}`);

  lines.push(
    "",
    "**Keybindings** (rebindable under Configure Controls):",
    "- **Alt+D** — Summon or dismiss Pseudo.",
    "- **Alt+M** — Toggle the microphone (only while Pseudo is already open)."
  );

  if (game.user.isGM && connection.length) {
    lines.push("", "**Connection** (yours only — never sent to players):");
    for (const e of connection) lines.push(`- **${e.name}** — ${e.hint}`);
    lines.push(
      "",
      "Manage all of this from the **Settings** sidebar tab: **Pseudo Setup** walks you through the " +
        "connection step by step, and **Pseudo Troubleshooter** helps diagnose anything not working."
    );
  }

  return lines.join("\n");
}

/**
 * The small subset of a registry entry the chat template actually needs to render a launch button —
 * never the `open` function itself, which only ever runs from the action handler.
 * @param {?object} wizard A registry.mjs entry, or null.
 * @returns {?{id: string, title: string, icon: string, description: string}}
 */
function wizardBadge(wizard) {
  return wizard ? { id: wizard.id, title: wizard.title, icon: wizard.icon, description: wizard.description } : null;
}

/**
 * Standalone GM-facing settings actions /help exposes alongside the wizard catalog — a single
 * confirm dialog rather than a multi-step wizard, so it isn't a registry.mjs entry, but the launch
 * card looks and behaves the same way.
 * @type {Array<{id: string, action: string, title: string, icon: string, description: string}>}
 */
const SETTINGS_ACTIONS = [
  {
    id: "coreSettings",
    action: "openCoreSettings",
    title: "Recommended Foundry Settings",
    icon: "fa-sliders",
    description: "Review and apply a few low-risk display/interaction defaults (token rotation, roll table animation, chat bubbles, left-click release)."
  }
];

/**
 * Hard-dependency modules that are missing or installed-but-inactive, each with the feature that
 * breaks without it. GM-only: only a GM can install or enable a module, so a player has no way to
 * act on this and would just see a warning they can't do anything about.
 * @returns {Array<{id: string, title: string, feature: string, installed: boolean}>}
 */
function missingCriticalDependencies() {
  if (!game.user.isGM) return [];
  // The world's *saved* module configuration updates the instant a module toggle is saved — before
  // anyone reloads. A disable (or enable) a module manager offers to defer ("Reload Later") leaves
  // this client's live game.modules state stale in the meantime, silently hiding exactly the moment a
  // GM most needs to hear about it. Comparing saved vs. live catches that gap instead of trusting
  // live-only state, which would report "still fine" right up until the reload actually happens.
  const stored = game.settings.get("core", "moduleConfiguration") ?? {};
  const results = [];
  for (const d of CRITICAL_DEPENDENCIES) {
    const mod = game.modules.get(d.id);
    if (!mod) {
      results.push({ ...d, status: "missing" });
      continue;
    }
    const liveActive = Boolean(mod.active);
    const storedActive = d.id in stored ? Boolean(stored[d.id]) : liveActive;
    if (liveActive && storedActive) continue; // genuinely fine, nothing to report
    if (liveActive && !storedActive) results.push({ ...d, status: "pendingDisable" });
    else if (!liveActive && storedActive) results.push({ ...d, status: "pendingEnable" });
    else results.push({ ...d, status: "inactive" });
  }
  return results;
}

/**
 * Extract a YouTube video id from a URL, or null. Only used to build a youtube.com/embed src, so a
 * non-YouTube URL yields nothing and never embeds.
 * @param {string} url
 * @returns {?string}
 */
function youtubeId(url) {
  const match = String(url || "").match(
    /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/
  );
  return match ? match[1] : null;
}

/**
 * Confirm a YouTube video actually exists via oEmbed, returning its real title and channel. A
 * non-existent (hallucinated) id 404s and yields null, so we never embed a fake video.
 * @param {string} id An 11-char video id.
 * @returns {Promise<?{title: string, author: string}>}
 */
/** Lazily-created shared audio context for UI blips. */
let sharedAudioCtx = null;

/**
 * Play a short, quiet UI blip — a rising tone to confirm the mic started, a falling tone when it
 * stops. Uses the Web Audio API (no sound file); silently no-ops if audio is unavailable.
 * @param {boolean} [up] Rising tone when true, falling when false.
 * @returns {void}
 */
function playBlip(up = true) {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    if (!sharedAudioCtx) sharedAudioCtx = new AudioCtx();
    const ctx = sharedAudioCtx;
    if (ctx.state === "suspended") ctx.resume();

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const now = ctx.currentTime;
    osc.type = "sine";
    osc.frequency.setValueAtTime(up ? 620 : 520, now);
    osc.frequency.exponentialRampToValueAtTime(up ? 940 : 380, now + 0.07);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.12, now + 0.012); // quiet
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.13);
  } catch {
    /* audio unavailable — no blip */
  }
}

async function validateYoutube(id) {
  try {
    const response = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${id}&format=json`);
    if (!response.ok) return null;
    const data = await response.json();
    return { title: data.title || "", author: data.author_name || "" };
  } catch {
    return null;
  }
}

/**
 * Render Pseudo's markdown answer to safe HTML. The raw text is HTML-escaped first, so any tags the
 * model emits become literal text and can't inject markup; only markdown's own **bold**, lists, etc.
 * are then turned into elements by Showdown (bundled with Foundry). Falls back to escaped text with
 * line breaks if the converter is unavailable.
 * @param {string} text Markdown from the model.
 * @returns {string} HTML.
 */
function renderMarkdown(text) {
  const escaped = String(text ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  if (typeof showdown === "undefined") return escaped.replace(/\n/g, "<br>");
  try {
    const converter = new showdown.Converter({
      simpleLineBreaks: true,
      tables: true,
      strikethrough: true,
      headerLevelStart: 3
    });
    return converter.makeHtml(escaped);
  } catch {
    return escaped.replace(/\n/g, "<br>");
  }
}

/**
 * Pseudo's floating chat window — the pseudodragon you summon on a hotkey to probe the whole world.
 *
 * A single reusable instance: summoning again focuses the open window rather than spawning a second.
 * The transcript lives on the instance so the conversation persists while the window is open.
 */
export class AssistantDialog extends HandlebarsApplicationMixin(ApplicationV2) {
  /** @type {AssistantDialog|null} The live instance, if any. */
  static #instance = null;

  /** @type {Array<{role: "gm"|"pseudo"|"system", text: string}>} The running transcript. */
  #transcript = [];

  /** @type {?number} Interval id that rotates the placeholder example while the input is empty. */
  #placeholderTimer = null;

  /** @type {boolean} True while a request is in flight, to show the thinking indicator. */
  #pending = false;

  /** @type {?string} Overrides the thinking label (e.g. "Searching the web…") during a request. */
  #pendingLabel = null;

  /** @type {*} Extra context to attach to the next ask (e.g. a diagnostic report), then cleared. */
  #nextContext = null;

  /** @type {?number} Timer that drops the "above the highlighter" class after a spotlight ends. */
  #spotlightTimer = null;

  /** @type {?SpeechRecognition} Active speech-recognition session, if dictating. */
  #recognition = null;

  /** @type {boolean} True once the thinking-indicator video has failed to load, so we stop retrying it. */
  #videoFailed = false;

  /**
   * Document-level pointerdown handler backing "keep on top": when the user clicks another window,
   * re-raise this one above it. Stored as a bound field so it can be removed on close.
   * @type {(event: PointerEvent) => void}
   */
  #onOutsidePointerDown = (event) => {
    if (!game.settings.get(MODULE_ID, SETTINGS.KEEP_ON_TOP)) return;
    if (!this.rendered) return;
    if (this.element?.contains(event.target)) return; // a click inside already raises us
    // Re-raise on the next frame, after the clicked application has raised itself.
    requestAnimationFrame(() => {
      if (this.rendered) this.#raise();
    });
  };

  /** @override */
  static DEFAULT_OPTIONS = {
    id: "cv-pseudo-assistant",
    tag: "div",
    classes: ["cv-pseudo", "cvp-assistant"],
    window: {
      title: "CVP.Assistant.Title",
      icon: "fa-solid fa-dragon",
      resizable: true
    },
    position: { width: 460, height: 560 },
    actions: {
      send: AssistantDialog.#onSend,
      openSettings: AssistantDialog.#onOpenSettings,
      showMe: AssistantDialog.#onShowMe,
      openDoc: AssistantDialog.#onOpenDoc,
      runMacro: AssistantDialog.#onRunMacro,
      mic: AssistantDialog.#onMic,
      launchWizard: AssistantDialog.#onLaunchWizard,
      askExample: AssistantDialog.#onAskExample,
      reloadWorld: AssistantDialog.#onReloadWorld,
      openCoreSettings: AssistantDialog.#onOpenCoreSettings
    }
  };

  /** @override */
  static PARTS = {
    body: {
      template: `modules/${MODULE_ID}/templates/assistant.hbs`,
      scrollable: [".cvp-log"]
    }
  };

  /**
   * Summon Pseudo: open the window, or focus it if already open. A fresh window opens where it was
   * last left, from the saved position.
   * @returns {AssistantDialog} The live instance.
   */
  static summon() {
    if (!this.#instance) {
      const saved = game.settings.get(MODULE_ID, SETTINGS.WINDOW_POSITION) ?? {};
      const options = Object.keys(saved).length ? { position: saved } : {};
      this.#instance = new AssistantDialog(options);
    }
    this.#instance.render(true);
    return this.#instance;
  }

  /**
   * Summon the window and immediately ask a question, optionally with extra hidden context (e.g. a
   * diagnostic report). Used by other features that hand Pseudo something to look at.
   * @param {string} promptText The visible question.
   * @param {*} [context] Hidden context attached to the request.
   * @returns {Promise<AssistantDialog>}
   */
  static async askWith(promptText, context = null) {
    const instance = this.summon();
    for (let i = 0; i < 20 && !instance.element?.querySelector(".cvp-input"); i++) {
      await new Promise((r) => setTimeout(r, 25)); // wait for the window to render
    }
    const input = instance.element?.querySelector(".cvp-input");
    if (input) {
      input.value = promptText;
      instance.#nextContext = context;
      instance.#ask();
    }
    return instance;
  }

  /**
   * Toggle the window: close it if it's open, otherwise summon it. Backs the summon keybinding, so the
   * same key both opens and dismisses Pseudo.
   * @returns {AssistantDialog|null} The live instance when opening, null when closing.
   */
  static toggle() {
    if (this.#instance?.rendered) {
      this.#instance.close();
      return null;
    }
    return this.summon();
  }

  /**
   * Toggle voice dictation via the mic keybinding — but only if Pseudo is already open. This mirrors
   * the mic button; it deliberately does not summon the window, unlike the summon keybinding itself.
   * @returns {void}
   */
  static toggleMic() {
    if (this.#instance?.rendered) this.#instance.#toggleDictation();
  }

  /** @override */
  async _prepareContext(_options) {
    // Only a GM can set a key, so only a GM ever sees the "not configured" nudge. Players rely on the
    // GM's key via the relay and would have no way to act on the notice.
    return {
      moduleName: MODULE_NAME,
      configured: game.user.isGM ? isConfigured() : true,
      missingDependencies: missingCriticalDependencies(),
      transcript: this.#transcript,
      pending: this.#pending,
      thinkingLabel: this.#pendingLabel || game.i18n.localize("CVP.Assistant.Thinking"),
      speechSupported: Boolean(window.SpeechRecognition || window.webkitSpeechRecognition),
      exampleAutofillEnabled: game.settings.get(MODULE_ID, SETTINGS.EXAMPLE_AUTOFILL),
      moduleId: MODULE_ID,
      showThinkingVideo:
        !this.#videoFailed && !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      discordUrl: CARTOON_VILLAINS_DISCORD,
      channelUrl: CARTOON_VILLAINS_YOUTUBE
    };
  }

  /** @override */
  async _onFirstRender(context, options) {
    await super._onFirstRender(context, options);
    // Keep-on-top: watch for clicks on other windows so we can re-raise. Attached once; removed on
    // close. The handler itself honours the toggle, so no need to re-bind when the setting changes.
    document.addEventListener("pointerdown", this.#onOutsidePointerDown, true);
    if (game.settings.get(MODULE_ID, SETTINGS.KEEP_ON_TOP)) this.#raise();

    // Rotate the placeholder example every few seconds, but only while the box is empty so it never
    // changes out from under someone mid-thought. Slow enough to actually read one and react (e.g. via
    // the right-arrow autofill) before it moves on.
    this.#placeholderTimer = window.setInterval(() => {
      const input = this.element?.querySelector(".cvp-input");
      if (input && !input.value) input.placeholder = randomExample();
    }, 10000);
  }

  /** @override */
  async _onRender(context, options) {
    await super._onRender(context, options);
    applyColorScheme(this.element);

    // Submit on Enter (Shift+Enter for a newline), and focus the input on open.
    const input = this.element.querySelector(".cvp-input");
    if (input) {
      if (!input.value) input.placeholder = randomExample(); // fresh suggestion each time it clears
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          this.#ask();
        } else if (
          event.key === "ArrowRight" &&
          !input.value &&
          game.settings.get(MODULE_ID, SETTINGS.EXAMPLE_AUTOFILL)
        ) {
          // Empty box only, so this never hijacks normal cursor movement while typing.
          event.preventDefault();
          input.value = input.placeholder;
          input.setSelectionRange(input.value.length, input.value.length);
        } else if (event.key === "ArrowRight" && this.#acceptGhostCompletion(input)) {
          // Only fires when a completion is actually showing and the caret is at the very end, so it
          // never hijacks normal cursor movement while editing earlier in the text.
          event.preventDefault();
        } else if (event.altKey && event.code === "KeyM") {
          // Foundry's global keybinding system suppresses custom keybindings while a text field has
          // focus (so they don't hijack typing) — but the input is auto-focused right when Pseudo
          // opens, exactly when someone would reach for this. Handle it locally too.
          event.preventDefault();
          this.#toggleDictation();
        }
      });
      input.addEventListener("input", () => this.#updateGhostCompletion(input));
      this.#updateGhostCompletion(input);
      input.focus();
    }

    // If the thinking-indicator video can't load (blocked, missing, unsupported codec), fall back to
    // the CSS dragon animation instead of leaving a broken video box. Persisted on the instance so the
    // fallback sticks across the many re-renders a single "thinking" period triggers.
    const video = this.element.querySelector(".cvp-thinking-video");
    if (video) {
      video.addEventListener(
        "error",
        () => {
          if (!this.#videoFailed) {
            this.#videoFailed = true;
            this.render();
          }
        },
        { once: true }
      );
    }

    this.#scrollToEnd();
  }

  /** @override */
  async close(options) {
    // Remember where the window was, so the next summon opens in the same spot.
    const { top, left, width, height } = this.position ?? {};
    if (Number.isFinite(top) && Number.isFinite(left)) {
      await game.settings.set(MODULE_ID, SETTINGS.WINDOW_POSITION, { top, left, width, height });
    }
    document.removeEventListener("pointerdown", this.#onOutsidePointerDown, true);
    if (this.#placeholderTimer) window.clearInterval(this.#placeholderTimer);
    if (this.#spotlightTimer) clearTimeout(this.#spotlightTimer);
    if (this.#recognition) {
      this.#recognition.onend = null; // avoid focusing a torn-down element
      this.#recognition.stop();
      this.#recognition = null;
    }
    if (AssistantDialog.#instance === this) AssistantDialog.#instance = null;
    return super.close(options);
  }

  /**
   * Raise this window above the others. Prefers the framework's bringToFront; falls back to bumping
   * z-index past the current windows if that API is unavailable.
   * @returns {void}
   */
  #raise() {
    if (typeof this.bringToFront === "function") {
      this.bringToFront();
      return;
    }
    if (!this.element) return;
    const zIndexes = [...document.querySelectorAll(".application")].map((el) => Number(el.style.zIndex) || 0);
    this.element.style.zIndex = String(Math.max(100, ...zIndexes) + 1);
  }

  /* -------------------------------------------- */
  /*  Actions                                     */
  /* -------------------------------------------- */

  /** @this {AssistantDialog} */
  static #onSend() {
    this.#ask();
  }

  /** @this {AssistantDialog} */
  static #onOpenSettings() {
    game.settings.sheet.render(true);
  }

  /**
   * Re-spotlight the element for a transcript line's highlight key.
   * @this {AssistantDialog}
   * @param {PointerEvent} _event
   * @param {HTMLElement} target The clicked "Show me" button.
   */
  static #onShowMe(_event, target) {
    const key = target?.dataset?.key;
    if (key) this.#spotlight(key);
  }

  /**
   * Open (or re-open) the document a transcript line references.
   * @this {AssistantDialog}
   * @param {PointerEvent} _event
   * @param {HTMLElement} target The clicked "Open" button.
   */
  static #onOpenDoc(_event, target) {
    const uuid = target?.dataset?.uuid;
    if (uuid) openByUuid(uuid);
  }

  /**
   * Run a macro after the GM's confirming click. Executor re-checks GM status, so this is safe.
   * @this {AssistantDialog}
   * @param {PointerEvent} _event
   * @param {HTMLElement} target The clicked "Run macro" button.
   */
  static async #onRunMacro(_event, target) {
    const id = target?.dataset?.id;
    if (!id) return;
    const result = await runMacroById(id);
    if (result) this.#push("system", result.summary);
  }

  /**
   * Toggle voice dictation into the input using the browser's speech recognition.
   * @this {AssistantDialog}
   */
  static #onMic() {
    this.#toggleDictation();
  }

  /**
   * Launch a curated wizard by id — shared by the contextual recommendation button and the /wizards
   * catalog, both of which just need to say which one was clicked.
   * @this {AssistantDialog}
   * @param {PointerEvent} _event
   * @param {HTMLElement} target The clicked launch button.
   */
  static #onLaunchWizard(_event, target) {
    const id = target?.dataset?.wizardId;
    getWizard(id)?.open();
  }

  /**
   * @this {AssistantDialog}
   */
  static #onOpenCoreSettings() {
    openCoreSettingsPrompt();
  }

  /**
   * Ask a /help quick-question button immediately, rather than just staging it in the input — it's a
   * real question meant to be answered, not a draft to edit first, matching how the wizard-launch
   * buttons already act on click instead of requiring a separate confirm step.
   * @this {AssistantDialog}
   * @param {PointerEvent} _event
   * @param {HTMLElement} target The clicked quick-question button.
   */
  static #onAskExample(_event, target) {
    const prompt = target?.dataset?.prompt;
    const input = this.element.querySelector(".cvp-input");
    if (!prompt || !input) return;
    input.value = prompt;
    this.#ask();
  }

  /**
   * Reload the client to apply a module-configuration change that's already saved but hasn't taken
   * effect yet — the fix for the pendingDisable/pendingEnable dependency-warning states.
   * @this {AssistantDialog}
   */
  static #onReloadWorld() {
    window.location.reload();
  }

  /* -------------------------------------------- */
  /*  Internals                                   */
  /* -------------------------------------------- */

  /**
   * Take the input, echo it, and route it through the LLM client. A typed NotConfiguredError becomes
   * a gentle nudge to set up a key; any other failure (including the current "not wired up" stub)
   * surfaces as a plain system line rather than a thrown, uncaught error.
   * @returns {Promise<void>}
   */
  async #ask() {
    if (this.#pending) return; // one request at a time
    const input = this.element.querySelector(".cvp-input");
    const prompt = input?.value?.trim();
    if (!prompt) return;

    // /clear wipes the window rather than adding to it, so it's intercepted before the GM's own line
    // gets echoed — there'd be nothing left to show it alongside anyway.
    if (matchCommand(prompt)?.name === "/clear") {
      input.value = "";
      this.#updateGhostCompletion(input);
      this.#transcript = [];
      this.render();
      return;
    }

    this.#push("gm", prompt);
    input.value = "";
    this.#updateGhostCompletion(input);

    // Known commands are answered locally — fixed, curated content, not something to generate, so
    // they skip the LLM round trip entirely.
    const command = matchCommand(prompt);
    if (command?.name === "/help") {
      this.#push("pseudo", "Here's everything I can help with:", {
        wizardList: availableWizards().map(wizardBadge),
        settingsActions: game.user.isGM ? [...SETTINGS_ACTIONS] : null,
        quickQuestions: [...ACTIVE_PROMPTS]
      });
      return;
    }
    if (command?.name === "/pseudo") {
      this.#push("pseudo", pseudoAboutText(), { showSettingsButton: true, highlightKey: "settings-tab" });
      return;
    }

    this.#pending = true;
    this.#pendingLabel = null;
    this.render(); // show the thinking indicator while we wait

    // Surface intermediate progress (e.g. the slow grounded web search) so it doesn't feel stuck.
    const onStatus = (kind) => {
      if (kind === "web" && this.#pending) {
        this.#pendingLabel = game.i18n.localize("CVP.Assistant.Searching");
        this.render();
      }
    };

    const context = this.#nextContext;
    this.#nextContext = null;

    try {
      const reply = await askPseudo(prompt, { context, onStatus });
      this.#pending = false;
      this.#pendingLabel = null;
      const structured = reply && typeof reply === "object";
      const text = structured ? reply.answer ?? "" : String(reply);
      const rawKey = structured ? reply.highlightKey : null;
      const highlightKey = rawKey && rawKey !== "none" ? rawKey : null;
      const missingModule = structured ? reply.missingModule || null : null;
      const rawOpen = structured ? reply.openUuid : null;
      const openUuid = rawOpen && rawOpen !== "none" ? rawOpen : null;
      const openOptions =
        structured && Array.isArray(reply.openOptions)
          ? reply.openOptions.filter((o) => o && o.uuid && o.label)
          : null;
      const stumped = structured ? Boolean(reply.stumped) : false;
      // A macro to offer (GM only, must exist) — rendered as a confirm button, never auto-run.
      const macroId = structured ? reply.runMacroId : null;
      const macro = macroId && game.user.isGM ? game.macros.get(macroId) : null;
      const macroRun = macro ? { id: macro.id, name: macro.name } : null;
      const launchWizard = structured && reply.launchWizardId ? wizardBadge(getWizard(reply.launchWizardId)) : null;
      // Real, Google-verified sources supplied by the transport (never model-typed URLs).
      const sources =
        structured && Array.isArray(reply.sources)
          ? reply.sources.filter((s) => s && s.title && /^https?:\/\//i.test(s.url || "")).slice(0, 6)
          : null;
      // Only embed a video that oEmbed confirms exists; carry its true title and channel.
      let video = null;
      const videoId = structured ? youtubeId(reply.videoUrl) : null;
      if (videoId) {
        const meta = await validateYoutube(videoId);
        if (meta) video = { id: videoId, title: meta.title, author: meta.author };
      }
      this.#push("pseudo", text || "(no answer)", {
        highlightKey,
        missingModule,
        openUuid,
        openOptions,
        video,
        sources,
        stumped,
        macroRun,
        launchWizard
      });
      // Spotlight the referenced element right away; the "Show me" button re-triggers it later.
      if (highlightKey) this.#spotlight(highlightKey);
      // Open a single clear match; ambiguous matches are offered as buttons instead.
      if (openUuid) openByUuid(openUuid);
      // Dice and table draws fire immediately (harmless); macros wait for the GM's confirm button.
      if (structured && reply.rollFormula) {
        const result = await rollDice(reply.rollFormula);
        if (result) this.#push("system", result.summary);
      }
      if (structured && reply.rollTableId) {
        const result = await rollTableById(reply.rollTableId);
        if (result) this.#push("system", result.summary);
      }
    } catch (error) {
      this.#pending = false;
      this.#pendingLabel = null;
      if (error instanceof NotConfiguredError) {
        this.#push("system", game.i18n.localize("CVP.Assistant.NotConfigured"));
      } else if (error instanceof NoGMError) {
        this.#push("system", game.i18n.localize("CVP.Assistant.NoGM"));
      } else {
        this.#push("system", error.message);
      }
    }
  }

  /**
   * Trigger a spotlight and lift this window above the highlighter's dim overlay for the highlight's
   * duration, so the answer stays readable while the element is spotlighted.
   * @param {string} key A UI-map key.
   * @returns {void}
   */
  #spotlight(key) {
    highlightByKey(key);
    const el = this.element;
    if (!el) return;
    el.classList.add("cvp-above-highlight");
    clearTimeout(this.#spotlightTimer);
    this.#spotlightTimer = setTimeout(() => el.classList.remove("cvp-above-highlight"), 3500);
  }

  /**
   * Append a line to the transcript and re-render so it appears.
   * @param {"gm"|"pseudo"|"system"} role Who is speaking.
   * @param {string} text The line.
   * @param {object} [meta] Extra per-line data for Pseudo answers.
   * @param {?string} [meta.highlightKey] A UI-map key this line can spotlight.
   * @param {?string} [meta.missingModule] Name of an uninstalled module this answer is about.
   * @param {?string} [meta.openUuid] A document uuid this line can open.
   * @returns {void}
   */
  #push(role, text, meta = {}) {
    // Render Pseudo's own lines as markdown; the GM echo and system notices stay plain (auto-escaped).
    const html = role === "pseudo" ? renderMarkdown(text) : null;
    this.#transcript.push({
      role,
      text,
      html,
      highlightKey: meta.highlightKey ?? null,
      missingModule: meta.missingModule ?? null,
      openUuid: meta.openUuid ?? null,
      openOptions: meta.openOptions ?? null,
      video: meta.video ?? null,
      sources: meta.sources ?? null,
      stumped: meta.stumped ?? false,
      macroRun: meta.macroRun ?? null,
      launchWizard: meta.launchWizard ?? null,
      wizardList: meta.wizardList ?? null,
      settingsActions: meta.settingsActions ?? null,
      quickQuestions: meta.quickQuestions ?? null,
      showSettingsButton: meta.showSettingsButton ?? false
    });
    if (this.#transcript.length > MAX_TRANSCRIPT) this.#transcript = this.#transcript.slice(-MAX_TRANSCRIPT);
    this.render();
  }

  /**
   * Start or stop voice dictation. Starting always clears the box first — reaching for the mic means
   * asking something new, not continuing a stale draft or an accepted example — then recognized text
   * fills it live. Stopping (or the recognizer ending) restores the idle state and focuses the box.
   * @returns {void}
   */
  #toggleDictation() {
    if (this.#recognition) {
      this.#recognition.stop();
      return;
    }
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) {
      ui.notifications.warn(game.i18n.localize("CVP.Assistant.NoSpeech"));
      return;
    }
    const input = this.element.querySelector(".cvp-input");
    if (!input) return;
    input.value = "";

    const recognition = new Recognition();
    recognition.lang = game.i18n?.lang || "en-US";
    recognition.interimResults = true;
    recognition.continuous = false;

    recognition.onresult = (event) => {
      let text = "";
      for (const result of event.results) text += result[0].transcript;
      input.value = text;
    };
    const finish = () => {
      this.#recognition = null;
      this.#setMicActive(false);
      playBlip(false); // falling tone: stopped listening
      input.focus();
    };
    recognition.onend = finish;
    recognition.onerror = finish;

    this.#recognition = recognition;
    this.#setMicActive(true);
    playBlip(true); // rising tone: started listening
    recognition.start();
  }

  /**
   * Reflect the dictation state on the mic button without a full re-render (which would drop the
   * live recognition binding on the input).
   * @param {boolean} active
   * @returns {void}
   */
  #setMicActive(active) {
    const button = this.element?.querySelector(".cvp-mic");
    button?.classList.toggle("cvp-mic--recording", active);
  }

  /**
   * Refresh the inline ghost-completion overlay to match the input's current text — an invisible
   * spacer matching what's typed, followed by the remaining characters of the one command it uniquely
   * completes to (if any), in muted color. Shares the "Right-arrow to use example" setting: turning
   * that off means → should just move the cursor, for either kind of suggestion.
   * @param {HTMLTextAreaElement} input
   * @returns {void}
   */
  #updateGhostCompletion(input) {
    const typedEl = this.element?.querySelector(".cvp-input-ghost-typed");
    const suggestEl = this.element?.querySelector(".cvp-input-ghost-suggest");
    if (!typedEl || !suggestEl) return;
    const completion = game.settings.get(MODULE_ID, SETTINGS.EXAMPLE_AUTOFILL) ? completionFor(input.value) : null;
    typedEl.textContent = completion ? input.value : "";
    suggestEl.textContent = completion ?? "";
  }

  /**
   * Accept the currently-shown ghost command completion, if the caret is at the very end of the
   * input and a completion is actually showing.
   * @param {HTMLTextAreaElement} input
   * @returns {boolean} Whether a completion was accepted (so the caller knows to preventDefault).
   */
  #acceptGhostCompletion(input) {
    const atEnd = input.selectionStart === input.value.length && input.selectionEnd === input.value.length;
    if (!atEnd || !game.settings.get(MODULE_ID, SETTINGS.EXAMPLE_AUTOFILL)) return false;
    const completion = completionFor(input.value);
    if (!completion) return false;
    input.value += completion;
    input.setSelectionRange(input.value.length, input.value.length);
    this.#updateGhostCompletion(input);
    return true;
  }

  /** Scroll the transcript to the newest line. */
  #scrollToEnd() {
    const logEl = this.element?.querySelector(".cvp-log");
    if (logEl) logEl.scrollTop = logEl.scrollHeight;
  }
}

log("assistant dialog loaded");
