# Pseudo

**Pseudo** is a pseudodragon familiar for the GM — a system-neutral AI assistant for Foundry VTT.
Summon it on a hotkey and it reads your world (journals, actors, monsters, roll tables, cards, and
compendia) to name things, answer lore and rules questions, and help run the game.

> The name is a small joke that happens to be honest: a pseudodragon is a classic familiar, and
> "pseudo-" means *artificial* — a pseudo-intelligence that perches on your shoulder.

- **ID:** `cv-pseudo`
- **Foundry compatibility:** v14
- **System:** none — Pseudo is deliberately system-agnostic.

## Architecture: one GM key, shared by the table

Each GM brings **their own** API key (their free-tier provider key). Only the GM's browser holds and
uses it. When a player asks Pseudo, the request rides Foundry's socket to the GM's client, which makes
the real API call and relays the answer back:

```
Player asks ──socket──► GM's client ──► AI API (GM's key, never leaves this browser)
Player  ◄──socket── answer
```

If no GM is connected, players get a clear "no GM available" message. The GM answers directly from
their own client with no relay hop.

## Status

Early build (`0.0.1`). What works today:

- Loads on any system; registers client-side settings (provider, API key, model, base URL).
- **Summon Pseudo** keybinding (default **Alt+A**, rebindable under Configure Controls) and a GM
  settings-sidebar button.
- A floating assistant window with a transcript and composer, for GMs and players.
- **Gemini transport** is wired end to end, including the player→GM socket relay and the
  no-GM / GM-not-configured / timeout messages.

- **Reference knowledge** — Pseudo reads a bundled `knowledge/` pack (filtered to the active system and
  installed modules) plus any `llms.txt` at an active module's root, so it answers "how do I…" questions
  with real steps.
- **Point at the UI** — answers return a structured `{ answer, highlightKey }`; when `highlightKey` maps
  to a verified selector in `knowledge/ui-map.json`, Pseudo spotlights that element via **Remote
  Highlight UI** (a required dependency) and offers a "Show me where" button. The model returns a *key*,
  never a raw selector, so it can't point at something that doesn't exist. Build/verify the map with
  `game.modules.get("cv-pseudo").api.captureSelector()`.

Not done yet:

- Other providers (OpenAI, Anthropic, OpenRouter, custom) are selectable but not yet routed — Gemini
  is the first supported transport.
- No **model** ships as a default (see security/model note below); the GM enters a current model id.
- World-context gathering (feeding journals/actors/etc. to the model), the right-click rename, the
  first-run setup wizard, and structured-output schemas per feature are still to come.

## Security & model notes

- **The key never reaches players.** It's stored as a **client-scoped** setting, so it lives only in
  the GM's browser and is never synced to other clients. (A *world*-scoped setting would be readable
  by any player from the console even when `restricted` — which is why this module does not use one.)
- **The key is sent as an HTTP header**, not in the URL query string, so it stays out of logs and
  referrers.
- **The model is free text on purpose.** Hardcoding a specific model id (e.g. an older Flash) would
  date the module the day a newer, cheaper one ships. The GM points it at whatever is current.
- This is a bring-your-own-key design. Do **not** bake a shared key into the module — that would
  require a separate GM-hosted proxy, which this architecture deliberately avoids.

## Layout

```
cv-pseudo/
├── module.json
├── lang/en.json
├── styles/cv-pseudo.css
├── templates/assistant.hbs
└── scripts/
    ├── cv-pseudo.mjs          # entry: init/ready hooks, keybinding, settings button
    ├── constants.mjs          # identity, setting keys, theme helpers
    ├── settings.mjs           # world settings + provider config accessors
    ├── assistant/
    │   └── assistant-dialog.mjs  # the floating chat window (ApplicationV2)
    └── llm/
        └── client.mjs         # askPseudo() — the single provider seam (stub)
```

## API

```js
game.modules.get("cv-pseudo").api.summon();      // open the assistant window
game.modules.get("cv-pseudo").api.isConfigured(); // boolean
```
