# Spotlight Omnisearch

A fast search across the whole world and compendiums (Ctrl+Space). Pseudo reads its index to find and
open things the GM asks about, so how Omnisearch is configured directly shapes what Pseudo can find.

## Duplicate search results (dupes)

If a search returns the same thing several times, it's because that content is indexed from more than
one compendium — for example the same item in both an SRD pack and an official module, or (on dnd5e)
the system's overlapping 2014 and 2024 packs. **Fix it by excluding the redundant compendiums from the
search index:**

1. Open the **Settings** tab in the sidebar, then **Configure Settings**.
2. Find **Spotlight Omnisearch** and click **Configure Compendiums** (the "Compendium Configuration" menu).
3. **Uncheck** the compendiums you don't want searched — the redundant/duplicate ones (e.g. a legacy
   edition, or an SRD pack you have an official version of).
4. Save, then rebuild the index: reopen the search (Ctrl+Space), or reload the world.

On dnd5e specifically, Pseudo can do this for you: it hides the *superseded* edition's SRD packs (the
2014 packs when you're on 2024 rules, and vice-versa) when you accept its Omnisearch tuning, so 2014/2024
duplicates disappear automatically.

## What gets indexed

Three settings under **Configure Settings → Spotlight Omnisearch** control coverage; Pseudo works best
with all three on:
- **Search compendiums** — index compendium content (monsters, items, rules).
- **Full compendium journal index** — index journal page names and section headings (lets Pseudo find
  rules by topic, like "the grappling rules").
- **Search sidebar** — index your world's own actors, journals, and tables.

## Using it directly

Press **Ctrl+Space** to open the search. Filter by type with `!item`, `!actor`, etc. Selecting a result
opens or inserts it.
