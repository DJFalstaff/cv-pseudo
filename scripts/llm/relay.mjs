import { MODULE_ID } from "../constants.mjs";
import { isConfigured } from "../settings.mjs";
import { callProvider } from "./transport.mjs";

/** Socket channel Pseudo relays requests and responses over. */
const CHANNEL = `module.${MODULE_ID}`;

/** How long a relayed request waits for a GM to answer before giving up. */
const REQUEST_TIMEOUT_MS = 30_000;

/** @type {Map<string, {resolve: Function, reject: Function, timer: number}>} In-flight requests. */
const pending = new Map();

/**
 * Raised when a player asks Pseudo but no GM is connected to serve the request.
 */
export class NoGMError extends Error {
  constructor() {
    super("No GM is available to answer.");
    this.name = "NoGMError";
  }
}

/**
 * Wire up the relay socket. Call once at ready.
 * @returns {void}
 */
export function registerRelay() {
  game.socket.on(CHANNEL, (payload) => {
    if (!payload || typeof payload !== "object") return;
    if (payload.type === "request") onRequest(payload);
    else if (payload.type === "response") onResponse(payload);
  });
}

/**
 * GM side. Only the primary active GM answers, so a table with several GMs doesn't spend one API call
 * per GM. If that GM hasn't configured a key, the requester is told so rather than left hanging.
 * @param {{requestId: string, userId: string, prompt: string, options: object}} payload
 * @returns {Promise<void>}
 */
async function onRequest({ requestId, userId, prompt, options }) {
  if (game.users.activeGM?.id !== game.user.id) return;

  let result = null;
  let error = null;
  try {
    if (!isConfigured()) throw new Error(game.i18n.localize("CVP.Relay.GMNotConfigured"));
    result = await callProvider(prompt, options ?? {});
  } catch (err) {
    error = err.message;
  }
  game.socket.emit(CHANNEL, { type: "response", requestId, userId, result, error });
}

/**
 * Requester side. Match the reply back to its pending promise and settle it.
 * @param {{requestId: string, userId: string, result: any, error: ?string}} payload
 * @returns {void}
 */
function onResponse({ requestId, userId, result, error }) {
  if (userId !== game.user.id) return; // not addressed to me
  const entry = pending.get(requestId);
  if (!entry) return;
  clearTimeout(entry.timer);
  pending.delete(requestId);
  if (error) entry.reject(new Error(error));
  else entry.resolve(result);
}

/**
 * Relay a question to the GM's client and await the answer. Rejects immediately with NoGMError when
 * no GM is connected, or after a timeout when a GM is present but never answers.
 * @param {string} prompt The question or instruction.
 * @param {object} [options] Passed through to the GM's provider call (context, schema).
 * @returns {Promise<string|object>} The GM-side provider's reply.
 */
export function relayToGM(prompt, options = {}) {
  return new Promise((resolve, reject) => {
    if (!game.users.activeGM) {
      reject(new NoGMError());
      return;
    }
    const requestId = foundry.utils.randomID();
    const timer = setTimeout(() => {
      pending.delete(requestId);
      reject(new Error(game.i18n.localize("CVP.Relay.Timeout")));
    }, REQUEST_TIMEOUT_MS);
    pending.set(requestId, { resolve, reject, timer });
    game.socket.emit(CHANNEL, { type: "request", requestId, userId: game.user.id, prompt, options });
  });
}
