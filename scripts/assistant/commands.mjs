/**
 * Every client-side command Pseudo answers locally, with no LLM round trip — a fixed, curated list,
 * not something to generate. Single source of truth for both command matching (#ask()'s interception
 * in assistant-dialog.mjs) and the input's inline completion ghost text: add a command here and both
 * pick it up automatically.
 * @type {Array<{name: string, aliases: string[], description: string}>}
 */
export const COMMANDS = [
  {
    name: "/help",
    aliases: ["/wizards", "/wizard"],
    description: "See every wizard and quick question Pseudo can help with."
  },
  {
    name: "/pseudo",
    aliases: [],
    description: "Learn about Pseudo itself and its settings."
  },
  {
    name: "/clear",
    aliases: [],
    description: "Clear this chat window."
  }
];

/**
 * Match a full command string (canonical name or alias, case-insensitive) to its entry.
 * @param {string} text
 * @returns {?object} The matching COMMANDS entry, or null.
 */
export function matchCommand(text) {
  const q = text.trim().toLowerCase();
  return COMMANDS.find((c) => c.name === q || c.aliases.includes(q)) ?? null;
}

/**
 * If `text` is a "/"-prefixed partial that uniquely prefixes exactly one command's *canonical* name
 * (aliases are deliberately excluded — ghosting toward a legacy alias would just steer people away
 * from the form worth learning), return the remaining characters to ghost after it. Null if there's
 * nothing to complete (not a command prefix, already complete, or ambiguous between commands).
 * @param {string} text
 * @returns {?string}
 */
export function completionFor(text) {
  if (!text.startsWith("/") || text.length < 2) return null;
  const q = text.toLowerCase();
  const matches = COMMANDS.filter((c) => c.name.startsWith(q) && c.name !== q);
  if (matches.length !== 1) return null;
  return matches[0].name.slice(text.length);
}
