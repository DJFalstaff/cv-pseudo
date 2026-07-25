# Remote Highlight UI

A GM teaching tool that spotlights a UI element on players' screens — a dimmed screen with a bright
cutout around the target. Similar to a canvas ping, but for interface buttons and panels. Pseudo also
uses it under the hood to point at elements when answering "how do I…" questions.

## Highlight something for your players
First enable it (Configure Settings → Remote Highlight UI → "enable highlighting for others"), then:
- Click the **highlighter tool** (the highlighter-pen icon in the left token controls), then click a UI
  element; or
- **Ctrl + middle-click** (or Ctrl + a mouse side button) directly on any UI element; or
- Use the optional keybinding under Configure Controls.

The element is spotlighted on everyone's screen. If it's on a different sidebar tab or scrolled out of
view for a player, their client switches tab / scrolls to show it.

## Highlight for just one player
Right-click a player's name in the bottom-left **Players** list → **Highlight UI only for this player**.
Everything you highlight then shows only for them until you turn it off (right-click → stop).

## Failed highlights
If an element can't be found on a player's screen, the GM sees the highlight turn red — a hint that the
player has a different tab/window open, or doesn't have that element at all.

## Settings worth knowing
- **Permission level** (world): who may highlight — GM only, trusted players, or everyone.
- **Trigger modifiers**: Ctrl, Ctrl+Shift, or Shift; optionally allow Ctrl+right-click.
- **Enable receiving highlights** (per client): a player can opt out of seeing highlights.
