import { MODULE_ID, SETTINGS, log } from "./constants.mjs";
import { registerSettings, isConfigured } from "./settings.mjs";
import { registerRelay } from "./llm/relay.mjs";
import { AssistantDialog } from "./assistant/assistant-dialog.mjs";
import { SetupWizard } from "./setup/setup-wizard.mjs";
import { maybePromptOmnisearchTuning, applyOmnisearchSettings } from "./setup/omnisearch-tuning.mjs";
import { maybePromptCoreSettingsTuning, applyCoreSettings } from "./setup/core-settings-tuning.mjs";
import { Troubleshooter } from "./setup/troubleshooter.mjs";
import { captureSelector, highlightByKey } from "./ui/highlight.mjs";

const { ApplicationV2 } = foundry.applications.api;

/**
 * A settings-menu button just needs a class Foundry can `new` and `.render()` — overriding render()
 * to open the real singleton instead of rendering a form is the standard idiom for menu buttons that
 * open an existing app rather than a settings form (see e.g. BBMM's own menu buttons).
 * @param {() => void} openFn
 * @returns {typeof ApplicationV2}
 */
function menuOpener(openFn) {
  return class extends ApplicationV2 {
    render(...args) {
      openFn();
      return this;
    }
  };
}

/**
 * Register "Pseudo Setup" and "Pseudo Troubleshooter" as settings menu buttons, so they appear
 * under Pseudo's own section in Configure Settings — the same place every other module's config
 * buttons live — instead of as loose buttons bolted onto the whole Settings sidebar tab.
 * @returns {void}
 */
function registerMenus() {
  game.settings.registerMenu(MODULE_ID, "openSetup", {
    name: "CVP.Settings.OpenSetup.Label",
    label: "CVP.Settings.OpenSetup.Label",
    hint: "CVP.Settings.OpenSetup.Hint",
    icon: "fa-solid fa-wand-magic-sparkles",
    restricted: true,
    type: menuOpener(() => SetupWizard.open())
  });

  game.settings.registerMenu(MODULE_ID, "openTroubleshooter", {
    name: "CVP.Trouble.Button",
    label: "CVP.Trouble.Button",
    hint: "CVP.Trouble.MenuHint",
    icon: "fa-solid fa-stethoscope",
    restricted: true,
    type: menuOpener(() => Troubleshooter.open())
  });
}

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
  registerMenus();
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
    tuneCoreSettings: () => applyCoreSettings(),
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
  if (isConfigured()) {
    maybePromptOmnisearchTuning();
    maybePromptCoreSettingsTuning();
  }
});

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

/**
 * Add a "Summon Pseudo" button group to the left scene-control toolbar, directly under the Notes
 * group — reachable without remembering the hotkey. GM-only, matching who could see the old
 * Settings-sidebar button.
 * @param {Record<string, object>} controls
 * @returns {void}
 */
Hooks.on("getSceneControlButtons", (controls) => {
  if (!game.user.isGM) return;
  controls.pseudo = {
    name: "pseudo",
    title: "CVP.Settings.Summon.Label",
    icon: "fa-solid fa-dragon",
    visible: true,
    button: true,
    order: 9, // directly after "notes" (order 8)
    onChange: (_event, active) => {
      if (active) AssistantDialog.toggle();
    },
    tools: {
      summon: {
        name: "summon",
        title: "CVP.Settings.Summon.Label",
        icon: "fa-solid fa-dragon",
        button: true,
        order: 1,
        onChange: () => AssistantDialog.toggle()
      }
    },
    activeTool: "summon"
  };
});
