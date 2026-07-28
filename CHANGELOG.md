# Changelog

All notable changes to Pseudo are documented here, newest first.

## v14.9.0 — 2026-07-28
- Cut the Campaign Portability Wizard from 5 steps to 3. Removed the Tagger-based "smart selection" step entirely — it assumed Tagger tags are used as broad content-categorization labels, but in practice they're scoped, single-purpose automation identifiers (e.g. for Monk's Active Tile Triggers), so the step surfaced tags that didn't map to anything meaningful.
- Merged "Generate the Module" and "Finish it on the Setup screen" into one final screen — a plain checklist for the parts that genuinely can't happen from inside a running World, instead of a wizard step implying more automation than it can deliver.
- The generated module's Compendium-sidebar folder is now a fixed "My Adventures" (was the campaign name, duplicating the pack's own label) — every campaign the wizard ever exports now pools into that one shared folder instead of each getting its own same-named-as-itself folder holding a single pack.
- New Adventures now default to "First Campaign" instead of the World's title.

## v14.8.0 — 2026-07-28
- Moved "Summon Pseudo" from the Settings sidebar to its own button on the left scene-control toolbar, directly under Notes.
- Moved "Pseudo Setup" and "Pseudo Troubleshooter" into Pseudo's own section in Configure Settings (as proper settings-menu buttons), instead of loose buttons bolted onto the whole Settings sidebar tab.

## v14.7.2 — 2026-07-28
- Fixed the recommended-settings dialog: chat bubbles and pan-to-speaker are now correctly recommended OFF (they were backwards, recommending ON).

## v14.7.1 — 2026-07-28
- Added this changelog and included it in the release zip, so tools like Big Bad Module Manager can show it.

## v14.7.0 — 2026-07-27
- `/help` now exposes the recommended Foundry settings configurator as a launch card, reachable anytime instead of only on first run.

## v14.6.0 — 2026-07-27
- Added a `/clear` command to reset the chat window.

## v14.5.0 — 2026-07-27
- Added a read-only D&D 5e settings walkthrough wizard: explains what each dnd5e rules setting does and why you might change it, with buttons that open Foundry's own settings dialogs. Changes nothing itself.
- Also ships two smaller changes that were committed but never separately tagged: a quick-question prompt for saving Dice So Nice presets safely, and a one-shot recommended-core-settings prompt (token rotation, roll table animation, chat bubbles, left-click release).

## v14.3.0 — 2026-07-27
- The Campaign Portability Wizard now groups its generated module's compendium pack under a named folder in the Compendium sidebar tab (via `packFolders`).

## v14.2.0 — 2026-07-27
- Added inline ghost-completion for known `/` commands.

## v14.1.1 — 2026-07-27
- Fixed a gap where disabling a hard-dependency module (e.g. via BBMM's "Reload Later") didn't trigger the red dependency warning until the world actually reloaded.

## v14.1.0 — 2026-07-27
- Switched to a Foundry-generation-led versioning scheme: versions now read as `<Foundry generation>.<minor>.<patch>` (e.g. `14.1.0`) instead of plain semver, so the version string itself shows which Foundry generation the module is paired with.
- Set `compatibility.verified` to the exact build number and `compatibility.maximum` on every release.

## v0.0.23 — 2026-07-27
- Added a red warning banner in the chat window when a hard-dependency module (Remote Highlight UI, Spotlight Omnisearch) is missing or inactive.

## v0.0.20 — 2026-07-27
- Added a Dice So Nice! tip (GM Push + safe preset storage) as a proactive, keyword-triggered recommendation.

## v0.0.19 — 2026-07-27
- Renamed `/wizards` to `/help` (aliases kept) and added quick-question buttons to its catalog.

## v0.0.18 — 2026-07-27
- Pseudo's persona now explicitly states the active game system, keeping it system-neutral by default.

## v0.0.13 — 2026-07-27
- Added the Campaign Portability Wizard and recommended-module video embedding.

## v0.0.12 — 2026-07-27
- Added an Alt+M mic shortcut; the input box clears when dictation starts.

## v0.0.11 — 2026-07-27
- Default summon shortcut changed to Alt+D; added campaign-portability and getting-started videos as embeddable recommendations.

## v0.0.10 — 2026-07-27
- Recommended-module videos now embed inline instead of only linking out.

## v0.0.9 — 2026-07-27
- Added a campaign-portability example prompt to the setup pool.

## v0.0.8 — 2026-07-27
- Split example prompts into setup and narrative pools; focused on setup for now.

## v0.0.7 — 2026-07-27
- Added a shimmer sweep and twinkling sparkles to the thinking-indicator label.

## v0.0.6 — 2026-07-27
- Slowed example-prompt rotation from 6s to 10s, giving more time to react to the right-arrow hint.

## v0.0.5 — 2026-07-27
- Fixed the release workflow to include the `assets/` directory in `module.zip`.

## v0.0.4 — 2026-07-27
- Replaced the thinking-indicator icon with a framed looping video, with a CSS/reduced-motion fallback.

## v0.0.3 — 2026-07-27
- Added the right-arrow-to-autofill-example feature, with a setting to disable it.

## v0.0.2 — 2026-07-27
- Added a `bugs` field pointing to Discord.

## v0.0.1 — 2026-07-27
- Added the release workflow for manifest-based module installs.
