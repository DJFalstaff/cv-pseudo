import { MODULE_ID, log } from "../constants.mjs";

/**
 * The reference-knowledge loader. Assembles a single markdown block Pseudo can read to answer "how do
 * I…" questions about Foundry, the game system, and installed modules — from two sources:
 *
 *  1. A curated pack bundled in this module (`knowledge/`), for things we don't own (core Foundry, the
 *     dnd5e system, third-party modules). Its `index.json` manifest says which doc applies where.
 *  2. A self-documenting `llms.txt` at the root of any active module (including our own cv-* modules),
 *     so a module can ship its own instructions and Pseudo picks them up automatically.
 *
 * Only docs relevant to the *active* world are included — the active system's doc, and docs for
 * modules that are actually installed and enabled — so Pseudo never advises on things this world lacks.
 * The assembled text is cached for the session; call clearKnowledgeCache() to force a rebuild.
 */

/** @type {?string} Memoised assembled knowledge for the session. */
let cache = null;

/** Drop the cached knowledge so the next gather rebuilds it. */
export function clearKnowledgeCache() {
  cache = null;
}

/**
 * Fetch a text asset, returning null if it isn't there (a missing doc or llms.txt is normal).
 * @param {string} path Foundry-relative path.
 * @returns {Promise<?string>}
 */
async function fetchText(path) {
  try {
    const response = await fetch(path);
    return response.ok ? await response.text() : null;
  } catch {
    return null;
  }
}

/**
 * Fetch and parse a JSON asset, returning null on any failure.
 * @param {string} path Foundry-relative path.
 * @returns {Promise<?object>}
 */
async function fetchJSON(path) {
  const text = await fetchText(path);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Assemble the reference knowledge relevant to this world.
 * @returns {Promise<string>} Markdown, or "" when nothing applies.
 */
export async function gatherKnowledge() {
  if (cache !== null) return cache;

  const sections = [];

  // 1. Curated pack, filtered by the active system and installed modules.
  const manifest = await fetchJSON(`modules/${MODULE_ID}/knowledge/index.json`);
  for (const doc of manifest?.docs ?? []) {
    if (doc.scope === "system" && doc.system !== game.system.id) continue;
    if (doc.scope === "module" && !game.modules.get(doc.module)?.active) continue;
    const text = await fetchText(`modules/${MODULE_ID}/knowledge/${doc.path}`);
    if (text?.trim()) sections.push(`## ${doc.title}\n\n${text.trim()}`);
  }

  // 2. Self-documenting llms.txt at the root of each active module.
  for (const module of game.modules) {
    if (!module.active) continue;
    const text = await fetchText(`modules/${module.id}/llms.txt`);
    if (text?.trim()) sections.push(`## Module: ${module.title} (${module.id})\n\n${text.trim()}`);
  }

  cache = sections.join("\n\n---\n\n");
  log(`knowledge assembled — ${sections.length} doc(s), ${cache.length} chars`);
  return cache;
}
