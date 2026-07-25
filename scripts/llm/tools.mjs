/**
 * Pseudo's data tools. Two complementary capabilities the model can call:
 *
 *  - queryWorld  — count/list documents via Foundry's native collections and compendium indexes.
 *                  Authoritative for "how many X do I have" / "list my Y".
 *  - searchWorld — fuzzy text search over Spotlight Omnisearch's prebuilt index (CONFIG.
 *                  SpotlightOmnisearch.INDEX), which spans world docs, compendium entries, and
 *                  journal headings. Best for "find the thing called/about X".
 *
 * Both run on the GM's client (where the data lives); players reach them via the relay.
 */

/** World document collections addressable by queryWorld. */
const WORLD_COLLECTIONS = {
  actors: () => game.actors,
  items: () => game.items,
  journal: () => game.journal,
  scenes: () => game.scenes,
  tables: () => game.tables,
  cards: () => game.cards,
  playlists: () => game.playlists,
  macros: () => game.macros
};

/** Compendium groupings by document kind. */
const COMPENDIUM_KINDS = {
  "compendium-actors": "Actor",
  "compendium-items": "Item",
  "compendium-journal": "JournalEntry",
  "compendium-tables": "RollTable",
  "compendium-cards": "Cards",
  "compendium-scenes": "Scene"
};

/**
 * Whether a document is visible to the asker. GMs see everything; a player must have at least OBSERVER
 * permission — so hidden NPCs, GM-only journals, and unowned secrets are filtered out.
 * @param {Document} doc
 * @param {?User} askerUser
 * @returns {boolean}
 */
function visibleToAsker(doc, askerUser) {
  if (!askerUser || askerUser.isGM) return true;
  try {
    return doc.testUserPermission(askerUser, "OBSERVER");
  } catch {
    return false; // if in doubt, hide it
  }
}

/**
 * Resolve a source to a flat list of {name, type} entries, or null if the source is unknown. World
 * documents are filtered to what the asker may see; compendium content is public reference material.
 * @param {string} source
 * @param {?User} askerUser
 * @returns {Promise<?Array<{name: string, type: ?string}>>}
 */
async function collectEntries(source, askerUser) {
  if (WORLD_COLLECTIONS[source]) {
    return WORLD_COLLECTIONS[source]()
      .contents.filter((d) => visibleToAsker(d, askerUser))
      .map((d) => ({ name: d.name, type: d.type }));
  }
  if (COMPENDIUM_KINDS[source]) {
    const docType = COMPENDIUM_KINDS[source];
    const packs = game.packs.filter((p) => p.metadata.type === docType);
    const entries = [];
    for (const pack of packs) {
      const index = await pack.getIndex();
      for (const entry of index) entries.push({ name: entry.name, type: entry.type });
    }
    return entries;
  }
  const pack = game.packs.get(source);
  if (pack) {
    const index = await pack.getIndex();
    return [...index].map((entry) => ({ name: entry.name, type: entry.type }));
  }
  return null;
}

/**
 * Count or list documents. Filters by document subtype and/or a name substring.
 * @param {object} args
 * @returns {Promise<object>} { count } | { count, names } | { error }
 */
export async function executeQueryWorld({ source, documentType, nameIncludes, operation = "count", limit = 25 } = {}, askerUser = null) {
  const entries = await collectEntries(source, askerUser);
  if (entries === null) {
    const valid = [...Object.keys(WORLD_COLLECTIONS), ...Object.keys(COMPENDIUM_KINDS)].join(", ");
    return { error: `Unknown source "${source}". Valid sources: ${valid}, or a compendium pack id.` };
  }

  let filtered = entries;
  if (documentType) filtered = filtered.filter((e) => e.type === documentType);
  if (nameIncludes) {
    const q = String(nameIncludes).toLowerCase();
    filtered = filtered.filter((e) => (e.name || "").toLowerCase().includes(q));
  }

  if (operation === "list") {
    return { count: filtered.length, names: filtered.slice(0, limit).map((e) => e.name) };
  }

  const result = { count: filtered.length };
  // If a type filter matched nothing, hint the real types so the model can retry.
  if (documentType && filtered.length === 0) {
    result.availableTypes = [...new Set(entries.map((e) => e.type).filter(Boolean))].slice(0, 20);
  }
  return result;
}

/**
 * Text search over Spotlight Omnisearch's index. Every whitespace-separated term must appear across
 * an entry's name/keywords/type/description.
 * @param {object} args
 * @returns {object} { total, items } | { error }
 */
export async function executeSearchWorld({ query, typeFilter, limit = 15 } = {}, askerUser = null) {
  const spotlight = CONFIG?.SpotlightOmnisearch;
  let index = spotlight?.INDEX;
  // The index builds lazily; trigger a build if it isn't populated yet.
  if (Array.isArray(index) && index.length === 0 && typeof spotlight.rebuildIndex === "function") {
    try {
      await spotlight.rebuildIndex();
    } catch {
      /* fall through to the emptiness check */
    }
    index = spotlight?.INDEX;
  }
  if (!Array.isArray(index) || index.length === 0) {
    return { error: "Search index unavailable — Spotlight Omnisearch isn't ready." };
  }

  const q = String(query || "").toLowerCase().trim();
  if (!q) return { error: "Provide a search query." };

  const terms = q.split(/\s+/);
  let results = index.filter((item) => {
    const hay = `${item.name || ""} ${(item.keywords || []).join(" ")} ${item.type || ""} ${item.description || ""}`.toLowerCase();
    return terms.every((t) => hay.includes(t));
  });
  if (typeFilter) {
    const tf = String(typeFilter).toLowerCase();
    results = results.filter((item) => (item.type || "").toLowerCase().includes(tf));
  }

  // Spoiler protection: a non-GM only gets world documents they may observe. Compendium entries are
  // public reference content and pass through.
  if (askerUser && !askerUser.isGM) {
    results = results.filter((item) => {
      const uuid = item.data?.uuid || "";
      if (!uuid || uuid.startsWith("Compendium.")) return true;
      const doc = fromUuidSync(uuid);
      return !doc || visibleToAsker(doc, askerUser);
    });
  }

  return {
    total: results.length,
    items: results.slice(0, limit).map((item) => ({
      name: item.name,
      type: item.type,
      uuid: item.data?.uuid ?? null,
      description: item.description
    }))
  };
}

/**
 * A compact map of what's queryable — world collection sizes and the compendium packs — so the model
 * chooses valid sources.
 * @returns {string}
 */
export function worldMap() {
  const world = Object.entries(WORLD_COLLECTIONS)
    .map(([key, get]) => `- ${key}: ${get()?.size ?? 0}`)
    .join("\n");
  const packs = game.packs.map((p) => `- ${p.collection} [${p.metadata.type}] ${p.metadata.label}`).join("\n");
  return (
    "WORLD DATA MAP — sizes of world collections, and the compendium packs (id [type] label). " +
    "Compendium content is what is 'installed'. Use queryWorld with a source from these for counts/" +
    "lists, and searchWorld to find specific things by text.\n" +
    `World collections:\n${world}\nCompendium packs:\n${packs}`
  );
}

/* -------------------------------------------- */
/*  Function declarations (Gemini tool schema)  */
/* -------------------------------------------- */

export const QUERY_WORLD_DECL = {
  name: "queryWorld",
  description:
    "Count or list documents in the Foundry world or its compendium packs. Use for 'how many X do I " +
    "have' or 'list my Y' questions (monsters, spells, items, journals, scenes, roll tables, cards).",
  parameters: {
    type: "object",
    properties: {
      source: {
        type: "string",
        description:
          "What to query. World collections: actors, items, journal, scenes, tables, cards, playlists, " +
          "macros. Compendiums by kind: compendium-actors, compendium-items, compendium-journal, " +
          "compendium-tables, compendium-cards, compendium-scenes. Or a specific pack id like 'dnd5e.monsters'."
      },
      documentType: {
        type: "string",
        description:
          "Optional subtype filter, e.g. 'npc' for monsters, 'character' for player characters, " +
          "'spell'/'weapon'/'feat' for items. Omit for all."
      },
      nameIncludes: { type: "string", description: "Optional case-insensitive substring the name must contain." },
      operation: { type: "string", enum: ["count", "list"], description: "'count' returns a number; 'list' returns names." },
      limit: { type: "integer", description: "Max names when listing (default 25)." }
    },
    required: ["source", "operation"]
  }
};

export const SEARCH_WORLD_DECL = {
  name: "searchWorld",
  description:
    "Search the world and compendiums for things matching a text query — by name, keyword, and (for " +
    "journals) section headings. Use to find specific named things or look something up. Returns matches " +
    "with their type.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "Text to search for." },
      typeFilter: { type: "string", description: "Optional: only results whose type contains this text (e.g. 'Actor', 'Journal', 'Spell')." },
      limit: { type: "integer", description: "Max results (default 15)." }
    },
    required: ["query"]
  }
};

export const WEB_HELP_DECL = {
  name: "webHelp",
  description:
    "Search the web for help the local docs don't cover — Foundry modules that add a feature, tutorial " +
    "videos, or documentation/tutorial sites. Returns a grounded summary with real URLs and YouTube " +
    "video ids. Prefer CartoonVillains YouTube videos. Use this for questions about capabilities, " +
    "modules, or how-tos not in the REFERENCE DOCS.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "The web search query. Bias toward Foundry VTT, and CartoonVillains for video tutorials."
      }
    },
    required: ["query"]
  }
};

import { RECOMMENDATIONS } from "./recommendations.mjs";

/**
 * Build the respond tool declaration. highlightKey is constrained to the current UI-map keys, so the
 * model can't invent a selector.
 * @param {string[]} highlightKeys
 * @returns {object}
 */
export function respondDecl(highlightKeys) {
  return {
    name: "respond",
    description: "Give your final answer to the user. Call this once you have everything you need.",
    parameters: {
      type: "object",
      properties: {
        answer: { type: "string", description: "The final answer, in clean markdown." },
        highlightKey: {
          type: "string",
          enum: [...highlightKeys, "none"],
          description: "A UI element to spotlight for the user, or 'none'."
        },
        missingModule: {
          type: "string",
          description: "Name of a module the question is about that isn't installed, else an empty string."
        },
        openUuid: {
          type: "string",
          description:
            "The uuid of a single, clearly-matching document to open/bring up for the user (from " +
            "searchWorld results). Empty string if there is no single clear match or nothing to open."
        },
        openOptions: {
          type: "array",
          description:
            "When a search has several plausible matches, list the top few here so the user can pick " +
            "which to open. Leave empty for a single clear match (use openUuid instead).",
          items: {
            type: "object",
            properties: {
              label: { type: "string", description: "A short label for the option (the document's name)." },
              uuid: { type: "string", description: "That document's uuid." }
            },
            required: ["label", "uuid"]
          }
        },
        videoUrl: {
          type: "string",
          description:
            "A YouTube video URL to embed for the user (a video id from webHelp results), preferring " +
            "CartoonVillains. Empty string if none. Do not invent one — only use ids webHelp returned."
        },
        stumped: {
          type: "boolean",
          description: "True if you genuinely cannot help; the user will be pointed to the CartoonVillains Discord."
        },
        rollFormula: {
          type: "string",
          description: 'A dice formula to roll when the user asks (e.g. "1d20+5", "2d6"). Empty otherwise.'
        },
        rollTableId: {
          type: "string",
          description: "The id of a roll table to draw from (from the ROLL TABLES list), when asked. Empty otherwise."
        },
        runMacroId: {
          type: "string",
          description:
            "The id of a macro to run (from the MACROS list), when the GM asks. Pseudo confirms before " +
            "running. Empty otherwise, and never for non-GM users."
        },
        recommendedModules: {
          type: "array",
          description:
            "Keys of modules to recommend for this question, from the STANDING RECOMMENDATIONS list. " +
            "Empty if none apply.",
          items: { type: "string", enum: Object.keys(RECOMMENDATIONS.modules) }
        },
        showGeneralHelp: {
          type: "boolean",
          description: "True to link the official Foundry VTT tutorials for general getting-started help."
        }
      },
      required: ["answer", "highlightKey", "missingModule", "openUuid"]
    }
  };
}
