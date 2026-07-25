import {
  MODULE_ID,
  MODULE_NAME,
  SETTINGS,
  CARTOON_VILLAINS_YOUTUBE,
  CARTOON_VILLAINS_DISCORD,
  applyColorScheme,
  log
} from "../constants.mjs";
import { isConfigured } from "../settings.mjs";
import { askPseudo, NotConfiguredError } from "../llm/client.mjs";
import { NoGMError } from "../llm/relay.mjs";
import { highlightByKey } from "../ui/highlight.mjs";
import { openByUuid } from "../ui/open-document.mjs";
import { rollDice, rollTableById, runMacroById } from "../ui/actions.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Example prompts shown as rotating placeholder text in the empty input, to suggest what Pseudo can
 * do. Kept broadly useful (they read well for any campaign) with a dark-urban-fantasy lean. Edit or
 * add freely — one random entry shows on open, and they rotate every few seconds while the box is empty.
 */
const EXAMPLE_PROMPTS = [
  "Name five dive bars in a cursed harbor town",
  "Give me a plot hook for tonight's session",
  "Describe a twitchy informant who knows too much",
  "Invent a rival faction and its leader",
  "Roll three rumors overheard on the docks",
  "Suggest an eerie random encounter for a foggy night",
  "Name an occult bookshop and whoever's behind the counter",
  "Give this monster a memorable weakness",
  "Turn an abandoned tenement into three clues",
  "What would a desperate cultist offer as a bribe?",
  "How do I add a player login?",
  "How do I get 3D dice?",
  "How do I create an NPC?",
  "How do I create a journal?",
  "How do I find a game rule?"
];

/** @returns {string} A random example prompt. */
function randomExample() {
  return EXAMPLE_PROMPTS[Math.floor(Math.random() * EXAMPLE_PROMPTS.length)];
}

/** Cap on transcript lines kept in view, so a long session doesn't grow the DOM unbounded. */
const MAX_TRANSCRIPT = 50;

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
      mic: AssistantDialog.#onMic
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

  /** @override */
  async _prepareContext(_options) {
    // Only a GM can set a key, so only a GM ever sees the "not configured" nudge. Players rely on the
    // GM's key via the relay and would have no way to act on the notice.
    return {
      moduleName: MODULE_NAME,
      configured: game.user.isGM ? isConfigured() : true,
      transcript: this.#transcript,
      pending: this.#pending,
      thinkingLabel: this.#pendingLabel || game.i18n.localize("CVP.Assistant.Thinking"),
      speechSupported: Boolean(window.SpeechRecognition || window.webkitSpeechRecognition),
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
    // changes out from under someone mid-thought.
    this.#placeholderTimer = window.setInterval(() => {
      const input = this.element?.querySelector(".cvp-input");
      if (input && !input.value) input.placeholder = randomExample();
    }, 6000);
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
        }
      });
      input.focus();
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

    this.#push("gm", prompt);
    input.value = "";
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
        macroRun
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
      macroRun: meta.macroRun ?? null
    });
    if (this.#transcript.length > MAX_TRANSCRIPT) this.#transcript = this.#transcript.slice(-MAX_TRANSCRIPT);
    this.render();
  }

  /**
   * Start or stop voice dictation. While listening, recognized text is appended live to the input;
   * stopping (or the recognizer ending) restores the idle state and focuses the box.
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

    const recognition = new Recognition();
    recognition.lang = game.i18n?.lang || "en-US";
    recognition.interimResults = true;
    recognition.continuous = false;
    const base = input.value ? `${input.value} ` : "";

    recognition.onresult = (event) => {
      let text = "";
      for (const result of event.results) text += result[0].transcript;
      input.value = base + text;
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

  /** Scroll the transcript to the newest line. */
  #scrollToEnd() {
    const logEl = this.element?.querySelector(".cvp-log");
    if (logEl) logEl.scrollTop = logEl.scrollHeight;
  }
}

log("assistant dialog loaded");
