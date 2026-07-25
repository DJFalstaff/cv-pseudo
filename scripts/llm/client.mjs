import { isConfigured } from "../settings.mjs";
import { callProvider } from "./transport.mjs";
import { relayToGM } from "./relay.mjs";

/**
 * Raised when a GM summons Pseudo before configuring a key.
 */
export class NotConfiguredError extends Error {
  constructor() {
    super("Pseudo has no provider configured.");
    this.name = "NotConfiguredError";
  }
}

/* -------------------------------------------- */
/*  Rolling answer cache                        */
/* -------------------------------------------- */

/** Most recently cached answers to keep. */
const CACHE_MAX = 20;

/** How long a cached answer stays fresh, so world data changes don't linger. */
const CACHE_TTL_MS = 10 * 60 * 1000;

/** @type {Map<string, {reply: *, time: number}>} Insertion-ordered LRU of prompt → reply. */
const answerCache = new Map();

/** @returns {string} Normalised cache key for a prompt. */
function cacheKey(prompt) {
  return String(prompt).trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * A question is cacheable only when it carries no extra caller context (a diagnostic report, etc.),
 * since that context changes the answer.
 * @param {*} context
 * @returns {boolean}
 */
function isCacheable(context) {
  return !context || (typeof context === "object" && Object.keys(context).length === 0);
}

/**
 * Fetch a fresh cached reply, refreshing its LRU position; null on miss or expiry.
 * @param {string} prompt
 * @returns {*}
 */
function getCached(prompt) {
  const key = cacheKey(prompt);
  const entry = answerCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.time > CACHE_TTL_MS) {
    answerCache.delete(key);
    return null;
  }
  answerCache.delete(key); // re-insert to mark most-recently-used
  answerCache.set(key, entry);
  return entry.reply;
}

/**
 * Store a reply, evicting the oldest entries past the cap.
 * @param {string} prompt
 * @param {*} reply
 * @returns {void}
 */
function setCached(prompt, reply) {
  answerCache.set(cacheKey(prompt), { reply, time: Date.now() });
  while (answerCache.size > CACHE_MAX) answerCache.delete(answerCache.keys().next().value);
}

/**
 * Ask Pseudo a question. The single seam every UI surface routes through.
 *
 * The GM's client — the only one holding a key — calls the provider directly. Everyone else relays
 * the request over the socket to the GM's client, which answers on their behalf. This is how one
 * GM key serves the whole table without the key ever leaving the GM's browser.
 *
 * @param {string} prompt The GM's (or player's) question or instruction.
 * @param {object} [options]
 * @param {object|string} [options.context] World context to ground the answer.
 * @param {object} [options.schema] A response schema to force structured JSON output.
 * @returns {Promise<string|object>} The reply — text, or parsed JSON when a schema is given.
 */
export async function askPseudo(prompt, { context = {}, onStatus } = {}) {
  const cacheable = isCacheable(context);
  if (cacheable) {
    const hit = getCached(prompt);
    if (hit) return hit; // identical recent question — skip the API call
  }

  let reply;
  if (game.user.isGM) {
    if (!isConfigured()) throw new NotConfiguredError();
    reply = await callProvider(prompt, { context, onStatus, askerUserId: game.user.id });
  } else {
    // Players (and any client without the key) relay to the GM. The GM's client answers, but data
    // access and macro rights follow the *asker's* user. Progress status isn't forwarded.
    reply = await relayToGM(prompt, { context, askerUserId: game.user.id });
  }

  if (cacheable) setCached(prompt, reply);
  return reply;
}
