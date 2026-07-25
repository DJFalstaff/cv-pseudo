# Foundry VTT Basics

Practical how-to steps for core Foundry VTT (v13–v14). The left vertical bar is the **scene controls**;
the right column of tabs (Chat, Combat, Scenes, Actors, Items, Journal, Tables, Cards, Playlists,
Compendium, Settings) is the **sidebar**. "Game Settings" is the gear/cog **Settings** tab in the sidebar.

## Add a player and let them log in

Foundry players do not make their own accounts — the GM creates a user for each player, and players
log in by picking their name at the world's login screen.

1. Open the **Settings** tab (sidebar) → **Manage Players** (also called User Management).
2. Click **Create User**, type the player's name, choose a **Role** (Player is default), and optionally
   set a password.
3. Save. Repeat for each player.
4. Give players the world's address so they reach that login screen:
   - Same house/Wi-Fi: they open a browser to `http://<your-computer-ip>:30000`.
   - Over the internet: use the **invitation link** — Settings tab → **Invitation Links** → copy the
     "Internet" link and send it. (This requires port forwarding or a host like The Forge/Molten
     Hosting; the invitation panel tells you if the internet link isn't reachable.)
5. At the login screen each player selects their name, enters their password if you set one, and joins.

## Create a journal entry

1. Open the **Journal** sidebar tab.
2. Click **Create Journal Entry**, give it a name, and confirm.
3. The entry opens with pages. Use the **+** to add a page (Text, Image, PDF, or Video). Text pages use
   a rich editor; type or paste content and click the save/close checkmark.
4. Right-click in the sidebar to create **folders** and drag entries to organize them.
5. To show a page to players: open it and click **Show Players** in the header, or right-click the entry
   → Show to Players.

## Get 3D dice

Core Foundry rolls dice as text in chat. Animated 3D dice come from the free **Dice So Nice!** module.

1. Return to **Setup** (log out of the world, or Settings tab → **Return to Setup**).
2. Go to **Add-on Modules** → **Install Module**, search **Dice So Nice**, and click Install.
3. Launch your world → Settings tab → **Manage Modules** → tick **Dice So Nice!** → Save Module Settings
   (the world reloads).
4. Configure look-and-feel under Settings tab → **Configure Settings** → **Dice So Nice!** (dice color,
   material, sounds). Now any roll shows animated 3D dice.

## Create a scene

1. Open the **Scenes** sidebar tab → **Create Scene**.
2. Name it, then set the background image (Configure Scene → Basics → Background Image) and grid.
3. Set **Grid Type/Size** so the map's squares match Foundry's grid (Grid tab; use the grid-config ruler
   to align).
4. Click the scene's **navigation** to activate it, or right-click → **Activate** to pull players in.

## Roll dice from chat

Type a roll formula in the chat box, e.g. `/roll 1d20+5` (or `/r 1d20+5`). `/gmroll` is visible only to
GMs; `/blindroll` hides it from everyone including the roller. Most sheets also roll by clicking the
relevant attribute or item.

## Enable or configure a module

Settings tab → **Manage Modules** to turn modules on/off (world reloads on save). Per-module options
live under Settings tab → **Configure Settings**, with a section per module.
