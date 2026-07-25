# D&D 5e (dnd5e system)

How-to steps for the official **dnd5e** system on Foundry. Actors are characters and NPCs; Items are
things you drop onto a sheet (classes, spells, weapons, features, etc.). Much 5e content lives in
**compendium packs** (Compendium sidebar tab) — drag from a pack onto a sheet to add it.

## Create an NPC

1. Open the **Actors** sidebar tab → **Create Actor**.
2. Set **Type** to **NPC**, name it, and confirm.
3. On the NPC sheet:
   - Set ability scores, **AC**, **HP**, and **CR** (challenge rating) in the header/attributes.
   - Add features, actions, and attacks by dragging them from a compendium (e.g. an SRD monster's
     traits) or by clicking **+ Add** in the Features/Attacks section to create them.
   - Set movement, senses, languages, and damage resistances/immunities in the details.
4. Drag the finished NPC onto a scene to place a token.

Fast path: if a stat block already exists in a compendium (e.g. the SRD monsters pack), drag that actor
straight into the Actors tab and tweak, rather than building from scratch.

## Create a player character

1. Actors tab → **Create Actor** → Type **Character**.
2. Open the sheet and drag on a **Race/Species**, **Background**, and **Class** from a compendium; the
   sheet applies proficiencies and features.
3. Set ability scores (point-buy, standard array, or roll), then drag on spells, weapons, and equipment.

> If **Character Forge** (`cv-character-forge`) is installed, it provides a guided creation wizard for
> D&D 2024 characters — check its own instructions for the streamlined flow.

## Add a spell, item, or feature to a sheet

Open the actor sheet, open a compendium pack (Compendium tab → e.g. "Spells (SRD)"), and **drag** the
entry onto the sheet. Or on the sheet's Spells/Inventory/Features tab, click **+** to create one by hand.
Spells land in the appropriate spell level; remember to set them **prepared** where the class requires it.

## Find a game rule

- **Rules compendia:** open the **Compendium** sidebar tab and look for the dnd5e **Rules** / **SRD**
  journal packs (conditions, actions, resting, etc.). Open the pack and browse or search its entries.
- **Inline references:** rules terms in sheets and journals (like a condition name) are often clickable
  and show a tooltip or open the rule.
- **Search everything:** use the sidebar search, or a search module if installed, to jump to a rule
  journal by keyword.

Note: only **SRD** rules ship free with the system. Full rulebooks require the official premium content
modules; if a rule isn't found, it may be in a book that isn't installed.

## Common tasks

- **Rest:** on a character sheet, use the **Short Rest / Long Rest** buttons to recover HP, hit dice, and
  spell slots per the rules.
- **Concentration & conditions:** apply conditions from the token HUD (right-side status icons) or the
  sheet's effects; concentration prompts appear when relevant if enabled in system settings.
- **Roll from the sheet:** click an ability, skill, save, or item to roll it; hold a modifier key (as set
  in dnd5e settings) for advantage/disadvantage or to skip the roll dialog.
