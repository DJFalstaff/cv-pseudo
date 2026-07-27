import { MODULE_ID, SETTINGS, log } from "./constants.mjs";
import { registerSettings, isConfigured } from "./settings.mjs";
import { registerRelay } from "./llm/relay.mjs";
import { AssistantDialog } from "./assistant/assistant-dialog.mjs";
import { SetupWizard } from "./setup/setup-wizard.mjs";
import { maybePromptOmnisearchTuning, applyOmnisearchSettings } from "./setup/omnisearch-tuning.mjs";
import { Troubleshooter } from "./setup/troubleshooter.mjs";
import { captureSelector, highlightByKey } from "./ui/highlight.mjs";

/**
 * Register the "Summon Pseudo" keybinding. Available to everyone (default Alt+D): the GM answers from
 * their own key, players relay to the GM. It is a rebindable setting — players change it under
 * Configure Controls → Keybindings; the `editable` entry below is only the default.
 * @returns {void}
 */
function registerKeybindings() {
  game.keybindings.register(MODULE_ID, "summon", {
    name: "CVP.Keybindings.Summon.Name",
    hint: "CVP.Keybindings.Summon.Hint",
    editable: [{ key: "KeyD", modifiers: ["Alt"] }],
    onDown: () => {
      AssistantDialog.toggle();
      return true;
    },
    precedence: CONST.KEYBINDING_PRECEDENCE.NORMAL
  });

  // Mirrors the mic button — deliberately doesn't summon Pseudo if it isn't already open.
  game.keybindings.register(MODULE_ID, "mic", {
    name: "CVP.Keybindings.Mic.Name",
    hint: "CVP.Keybindings.Mic.Hint",
    editable: [{ key: "KeyM", modifiers: ["Alt"] }],
    onDown: () => {
      AssistantDialog.toggleMic();
      return true;
    },
    precedence: CONST.KEYBINDING_PRECEDENCE.NORMAL
  });
}

Hooks.once("init", () => {
  registerSettings();
  registerKeybindings();
  log("initialized");
});

Hooks.once("ready", () => {
  registerRelay();
  game.modules.get(MODULE_ID).api = {
    summon: () => AssistantDialog.summon(),
    toggle: () => AssistantDialog.toggle(),
    setup: () => SetupWizard.open(),
    troubleshooter: () => Troubleshooter.open(),
    tuneOmnisearch: () => applyOmnisearchSettings(),
    isConfigured,
    // Dev helpers for building the UI map: click to capture a selector, or test a key.
    captureSelector,
    highlight: (key) => highlightByKey(key)
  };
  const role = game.user.isGM ? (isConfigured() ? "GM, configured" : "GM, not configured") : "player (relays to GM)";
  log(`ready — ${role}`);

  // First-run: greet an unconfigured GM with the key walkthrough. Once they're set up, nudge them to
  // tune Omnisearch for the best search results.
  SetupWizard.maybeGreet();
  if (isConfigured()) maybePromptOmnisearchTuning();
});

/**
 * Add a "Summon Pseudo" button to the Game Settings sidebar tab, so the assistant is reachable
 * without remembering the hotkey.
 * @param {Application} _app Settings sidebar app.
 * @param {HTMLElement} html Rendered element.
 * @returns {void}
 */
/**
 * Mask the API key field in the module settings so it isn't shown in plain text. Foundry has no
 * password setting type, so we retype the input to "password" after the settings form renders.
 * @param {Application} _app Settings config app.
 * @param {HTMLElement} html Rendered element.
 * @returns {void}
 */
Hooks.on("renderSettingsConfig", (_app, html) => {
  const root = html instanceof HTMLElement ? html : html?.[0];
  const input = root?.querySelector(`input[name="${MODULE_ID}.${SETTINGS.API_KEY}"]`);
  if (input) {
    input.type = "password";
    input.setAttribute("autocomplete", "new-password");
  }
});

Hooks.on("renderSettings", (_app, html) => {
  if (!game.user?.isGM) return;
  const root = html instanceof HTMLElement ? html : html?.[0];
  if (!root || root.querySelector("[data-cvp-summon]")) return;

  const summonBtn = document.createElement("button");
  summonBtn.type = "button";
  summonBtn.dataset.cvpSummon = "";
  summonBtn.innerHTML = `<i class="fa-solid fa-dragon"></i> ${game.i18n.localize("CVP.Settings.Summon.Label")}`;
  summonBtn.addEventListener("click", () => AssistantDialog.summon());

  const setupBtn = document.createElement("button");
  setupBtn.type = "button";
  setupBtn.dataset.cvpSetup = "";
  setupBtn.innerHTML = `<i class="fa-solid fa-wand-magic-sparkles"></i> ${game.i18n.localize("CVP.Settings.OpenSetup.Label")}`;
  setupBtn.addEventListener("click", () => SetupWizard.open());

  const troubleBtn = document.createElement("button");
  troubleBtn.type = "button";
  troubleBtn.dataset.cvpTroubleshooter = "";
  troubleBtn.innerHTML = `<i class="fa-solid fa-stethoscope"></i> ${game.i18n.localize("CVP.Trouble.Button")}`;
  troubleBtn.addEventListener("click", () => Troubleshooter.open());

  const section = root.querySelector("section.settings, #settings-game, .settings-sidebar") ?? root;
  section.appendChild(summonBtn);
  section.appendChild(setupBtn);
  section.appendChild(troubleBtn);
});
