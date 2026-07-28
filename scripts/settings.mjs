import { MODULE_ID, SETTINGS, PROVIDERS, DEFAULT_MODEL } from "./constants.mjs";

const { BooleanField, ObjectField, StringField } = foundry.data.fields;

/**
 * Register Pseudo's settings.
 *
 * The provider config — key, model, endpoint — is **client-scoped**, not world-scoped. This is a
 * deliberate security choice: world settings are synced to every connected client, so a world-stored
 * key is readable by any player from the console even when `restricted`. Only the GM's own browser
 * ever needs the key (players relay their requests to it), so the key lives on the GM's client and is
 * never transmitted to anyone else. The trade-off — settings don't roam across a GM's devices — is
 * the correct one for a bring-your-own-key model.
 * @returns {void}
 */
export function registerSettings() {
  game.settings.register(MODULE_ID, SETTINGS.PROVIDER, {
    name: "CVP.Settings.Provider.Name",
    hint: "CVP.Settings.Provider.Hint",
    scope: "client",
    config: true,
    restricted: true,
    type: new StringField({
      initial: "gemini",
      blank: false,
      choices: PROVIDERS
    })
  });

  game.settings.register(MODULE_ID, SETTINGS.API_KEY, {
    name: "CVP.Settings.ApiKey.Name",
    hint: "CVP.Settings.ApiKey.Hint",
    scope: "client", // stays in the GM's browser; never synced to players
    config: true,
    restricted: true,
    type: new StringField({ initial: "" })
  });

  game.settings.register(MODULE_ID, SETTINGS.MODEL, {
    name: "CVP.Settings.Model.Name",
    hint: "CVP.Settings.Model.Hint",
    scope: "client",
    config: true,
    restricted: true,
    type: new StringField({ initial: DEFAULT_MODEL })
  });

  game.settings.register(MODULE_ID, SETTINGS.BASE_URL, {
    name: "CVP.Settings.BaseUrl.Name",
    hint: "CVP.Settings.BaseUrl.Hint",
    scope: "client",
    config: true,
    restricted: true,
    type: new StringField({ initial: "" })
  });

  game.settings.register(MODULE_ID, SETTINGS.SETUP_DISMISSED, {
    scope: "client",
    config: false,
    type: new BooleanField({ initial: false })
  });

  // Per-user UI preference, so it is NOT restricted — players use the assistant window too.
  game.settings.register(MODULE_ID, SETTINGS.KEEP_ON_TOP, {
    name: "CVP.Settings.KeepOnTop.Name",
    hint: "CVP.Settings.KeepOnTop.Hint",
    scope: "client",
    config: true,
    type: new BooleanField({ initial: true })
  });

  game.settings.register(MODULE_ID, SETTINGS.WINDOW_POSITION, {
    scope: "client",
    config: false,
    type: new ObjectField({ initial: {} })
  });

  game.settings.register(MODULE_ID, SETTINGS.OMNISEARCH_DISMISSED, {
    scope: "client",
    config: false,
    type: new BooleanField({ initial: false })
  });

  game.settings.register(MODULE_ID, SETTINGS.CORE_SETTINGS_DISMISSED, {
    scope: "client",
    config: false,
    type: new BooleanField({ initial: false })
  });

  // Per-user UI preference, so it is NOT restricted — players use the assistant window too.
  game.settings.register(MODULE_ID, SETTINGS.EXAMPLE_AUTOFILL, {
    name: "CVP.Settings.ExampleAutofill.Name",
    hint: "CVP.Settings.ExampleAutofill.Hint",
    scope: "client",
    config: true,
    type: new BooleanField({ initial: true })
  });
}

/**
 * The current provider configuration, read from this client's settings.
 * @returns {{provider: string, apiKey: string, model: string, baseUrl: string}}
 */
export function providerConfig() {
  return {
    provider: game.settings.get(MODULE_ID, SETTINGS.PROVIDER),
    apiKey: game.settings.get(MODULE_ID, SETTINGS.API_KEY),
    model: game.settings.get(MODULE_ID, SETTINGS.MODEL),
    baseUrl: game.settings.get(MODULE_ID, SETTINGS.BASE_URL)
  };
}

/**
 * Whether this client can make provider calls directly: a key (or a proxy base URL) is present.
 * @returns {boolean}
 */
export function isConfigured() {
  const { apiKey, baseUrl } = providerConfig();
  return Boolean(apiKey || baseUrl);
}
