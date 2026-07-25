/**
 * Table-top actions Pseudo can take on the asker's own client: roll dice, draw a roll table, and run a
 * macro. Dice and tables are harmless and run immediately; macros are GM-only and confirmed by a
 * deliberate click. Pseudo never executes model-authored code — it only ever runs a macro or table
 * the world already contains, selected by id.
 */

/**
 * Roll a dice formula and post it to chat.
 * @param {string} formula e.g. "1d20+5"
 * @returns {Promise<?{ok: boolean, summary: string}>} null when there's nothing to roll.
 */
export async function rollDice(formula) {
  const expr = String(formula || "").trim();
  if (!expr) return null;
  if (!Roll.validate(expr)) return { ok: false, summary: `Couldn't roll "${expr}" — not a valid formula.` };
  try {
    const roll = await new Roll(expr).evaluate();
    await roll.toMessage({ flavor: "Rolled via Pseudo" });
    return { ok: true, summary: `🎲 ${expr} → ${roll.total}` };
  } catch (err) {
    return { ok: false, summary: `Roll failed: ${err.message}` };
  }
}

/**
 * Draw from a roll table by id (posts to chat).
 * @param {string} id A RollTable id.
 * @returns {Promise<?{ok: boolean, summary: string}>} null when the table doesn't exist.
 */
export async function rollTableById(id) {
  const table = game.tables.get(id);
  if (!table) return null;
  try {
    const draw = await table.draw();
    const text = (draw.results || []).map((r) => r.text || r.name || r.description || "").filter(Boolean).join(", ");
    return { ok: true, summary: `🎯 ${table.name}: ${text || "(drawn)"}` };
  } catch (err) {
    return { ok: false, summary: `Table draw failed: ${err.message}` };
  }
}

/**
 * Run a macro by id — GM only. Hard-enforced here regardless of what the model returned, so a player's
 * client can never run a macro through Pseudo.
 * @param {string} id A Macro id.
 * @returns {Promise<?{ok: boolean, summary: string}>} null when the macro doesn't exist.
 */
export async function runMacroById(id) {
  if (!game.user.isGM) return { ok: false, summary: "Only the GM can run macros through Pseudo." };
  const macro = game.macros.get(id);
  if (!macro) return null;
  try {
    await macro.execute();
    return { ok: true, summary: `▶ Ran macro: ${macro.name}` };
  } catch (err) {
    return { ok: false, summary: `Macro "${macro.name}" errored: ${err.message}` };
  }
}
