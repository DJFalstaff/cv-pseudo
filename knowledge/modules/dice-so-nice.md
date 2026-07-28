# Dice So Nice!

Renders 3D animated dice for every roll. Its settings live under **Settings → Configure Settings →
Dice So Nice!**, in tabs: Appearance, Preferences, Special Effects, Display, and Profiles & Data.

## Giving your whole table your dice look (GM Push)

Once you've designed dice you like — **Appearance** tab, click a die to customize its colors/material/
system, **Test Roll** to preview — you almost never need to ask players to copy your settings by hand.
Instead:

1. Open **Profiles & Data** (the last tab).
2. Click **Push my config to players**.
3. Choose what to send: **Dice appearance**, **Special effects**, and/or **Preferences & performance**.
4. Confirm. This immediately overwrites the chosen categories for **every non-GM player, including
   disconnected ones** — no file, no download, nothing they need to do. Each player gets a notice that
   their config was updated.

This only works one direction (GM → players) and can't be undone, so it's best used once a look is
finalized, not while still experimenting.

## Keeping a look safe (don't lose it)

**Save as… / Load** (also on Profiles & Data) lets a GM keep several named presets to switch between —
but these are stored in the GM's own user settings **for this World only**. They vanish if that World
is deleted or rebuilt, and they don't carry over to a different World or a fresh install.

For anything worth keeping long-term — a signature dice look for a campaign, a backup before
experimenting, or a set to reuse across different Worlds — use **Export all** instead (or **Export
Special effects** / **Export my Dice Library** for just those pieces). This downloads a real file to
the GM's own computer, and **Import** reads it back the same way — a normal browser "choose a file"
dialog, not Foundry's own file browser. The exported file never has to touch Foundry at all.

**Where to actually put it:** don't upload it into a module folder, a World folder, or anywhere else
under Foundry's own `Data/` folder to keep it "inside Foundry." Foundry serves everything under
`Data/` as plain static files with no permission check — that's exactly how player-visible art and
tokens load in the first place — so anything stored there is fetchable by anyone who has (or guesses)
the path, GM or player. Keep the exported file on the GM's own computer instead, in whatever folder
already holds other real backups — Documents, a synced Drive/Dropbox folder, wherever. It's simpler,
genuinely private since it never reaches the server, and safe from a module update or World deletion.
Bring it back anytime with **Import**'s own file picker, in this World or any other.
