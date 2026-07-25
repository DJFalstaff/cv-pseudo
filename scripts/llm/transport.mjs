import { providerConfig } from "../settings.mjs";
import { gatherKnowledge } from "../knowledge/loader.mjs";
import { loadUiMap, highlightTargets } from "../ui/highlight.mjs";
import { geminiRequest, geminiGroundedSearch } from "./providers/gemini.mjs";
import { CARTOON_VILLAINS_YOUTUBE } from "../constants.mjs";
import { recommendationContext, resolveRecommendations } from "./recommendations.mjs";
import {
  QUERY_WORLD_DECL,
  SEARCH_WORLD_DECL,
  WEB_HELP_DECL,
  respondDecl,
  executeQueryWorld,
  executeSearchWorld,
  worldMap
} from "./tools.mjs";

/**
 * Pseudo's persona and ground rules, sent as the system instruction.
 */
const PERSONA = [
  "You are Pseudo, a concise, capable familiar assisting a Game Master running Foundry VTT.",
  "You can look things up before answering: call queryWorld to count or list documents (e.g. how many",
  "monsters), and searchWorld to find specific things by name or keyword across the world and",
  "compendiums. Use these instead of guessing about the user's actual content.",
  "When answering how to do something in Foundry, the game system, or an installed module, use the",
  "REFERENCE DOCS — give exact steps and where to click; if the docs don't cover it, say you're not",
  "certain rather than inventing menus or UI paths.",
  "If the user asks about a module that is NOT in the INSTALLED MODULES list, set missingModule to its",
  "name and explain how to install it.",
  "When the user asks to find, open, show, or bring up something in their world, use searchWorld first.",
  "If one result clearly matches, set openUuid to open it. If several could match, leave openUuid empty,",
  "put the top few results in openOptions as {label, uuid}, and list them so the user can choose.",
  "Follow the STANDING RECOMMENDATIONS first: when one of their topics comes up, add the module's key",
  "to recommendedModules and answer directly — do NOT call webHelp for a topic a standing",
  "recommendation already covers. For general getting-started help, set showGeneralHelp true. Pseudo",
  "supplies those links, so mention the module by name but never write its URL yourself.",
  "Only when no standing recommendation and no REFERENCE DOC cover the question — a different module, a",
  "tutorial video, or documentation — call webHelp to search the web. Prefer CartoonVillains videos. In",
  "respond, set videoUrl to a relevant video to embed; Pseudo shows the real source links itself, so",
  "don't put URLs in your answer. If you genuinely cannot help, set stumped to true.",
  "For creative requests (names, lore, NPCs), be evocative and lean into a dark urban-fantasy tone",
  "unless told otherwise.",
  "Format in clean markdown: numbered steps on their own lines, and bold the exact names of buttons,",
  "tabs, and menu items.",
  "Don't over-query: once you have what you need, call respond. Always finish by calling respond with",
  "your final answer."
].join(" ");

/** Safety cap on tool round-trips; the final turn forces a `respond` so we never stall. */
const MAX_TOOL_TURNS = 8;

/**
 * Answer a prompt via Gemini with function calling. The model may call queryWorld / searchWorld to
 * read the user's world, and always finishes by calling `respond`, which carries the structured
 * `{ answer, highlightKey, missingModule }` back to the UI. Gemini is the only wired provider.
 *
 * @param {string} prompt The question or instruction.
 * @param {object} [options]
 * @param {object|string} [options.context] Extra world data to ground the answer.
 * @returns {Promise<{answer: string, highlightKey?: string, missingModule?: string}>}
 */
export async function callProvider(prompt, options = {}) {
  const cfg = providerConfig();
  if (!cfg.model) throw new Error(game.i18n.localize("CVP.Errors.NoModel"));
  if (cfg.provider !== "gemini") {
    throw new Error(game.i18n.format("CVP.Errors.ProviderUnsupported", { provider: cfg.provider }));
  }

  // Grounding context.
  const parts = [];
  const knowledge = await gatherKnowledge();
  if (knowledge) {
    parts.push(
      "REFERENCE DOCS (use for how-to questions about Foundry, the game system, or installed modules):" +
        `\n\n${knowledge}`
    );
  }
  const targets = highlightTargets(await loadUiMap());
  if (targets.length) {
    parts.push(
      "HIGHLIGHT TARGETS — when your answer tells the user to click or find one of these UI elements, " +
        'pass its key as highlightKey to respond so Pseudo can spotlight it; otherwise "none":\n' +
        targets.map((t) => `- ${t.key}: ${t.label}`).join("\n")
    );
  }
  const installed = game.modules.filter((m) => m.active).map((m) => `- ${m.title} (${m.id})`).join("\n");
  parts.push(`INSTALLED MODULES (active in this world):\n${installed}`);
  parts.push(recommendationContext());

  // Identify who is actually asking (a player relays to the GM's client, but data access and macro
  // rights must follow the *asker*, not the GM whose client is answering).
  const askerUser = game.users.get(options.askerUserId) ?? game.user;
  const askerIsGM = askerUser.isGM;
  if (!askerIsGM) {
    parts.push(
      "AUDIENCE: the person asking is a PLAYER, not the GM. Only reveal what a player may see. Never " +
        "disclose hidden creatures' stats, secret lore, GM-only journal notes, or unidentified item " +
        "details; if asked for GM-only information, tell them to check with their GM. (Pseudo has " +
        "already withheld data this player cannot access.)"
    );
  }

  // Actions Pseudo can take. Dice and tables are open to everyone; macros are GM-only, so the macro
  // list is only offered when the asker is the GM.
  const tables = game.tables.contents.slice(0, 40).map((t) => `- ${t.name} [${t.id}]`).join("\n");
  const actionLines = [
    "ACTIONS — set these fields in respond to act:",
    '- rollFormula: a dice formula to roll (e.g. "1d20+5") when the user asks to roll dice.',
    "- rollTableId: the id of a roll table to draw from (from ROLL TABLES below).",
    askerIsGM
      ? "- runMacroId: the id of a macro to run (from MACROS below); Pseudo confirms with the GM first."
      : "- Macros are GM-only. This person is not the GM — do not run a macro; say macros are GM-only.",
    `ROLL TABLES:\n${tables || "(none)"}`
  ];
  if (askerIsGM) {
    const macros = game.macros.contents.slice(0, 40).map((m) => `- ${m.name} [${m.id}] (${m.type})`).join("\n");
    actionLines.push(`MACROS:\n${macros || "(none)"}`);
  }
  parts.push(actionLines.join("\n"));

  parts.push(worldMap());
  if (options.context) {
    const data = typeof options.context === "string" ? options.context : JSON.stringify(options.context);
    if (data && data !== "{}") parts.push(`WORLD DATA:\n\n${data}`);
  }
  const contextText = parts.join("\n\n=====\n\n");

  const tools = [
    { functionDeclarations: [QUERY_WORLD_DECL, SEARCH_WORLD_DECL, WEB_HELP_DECL, respondDecl(targets.map((t) => t.key))] }
  ];
  const contents = [{ role: "user", parts: [{ text: contextText }, { text: prompt }] }];

  // Real web sources gathered from any webHelp calls; these are the only URLs we ever show.
  const collectedSources = [];

  for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
    // On the last allowed turn, force `respond` so the model always delivers a final answer.
    const functionCallingConfig =
      turn === MAX_TOOL_TURNS - 1 ? { mode: "ANY", allowedFunctionNames: ["respond"] } : { mode: "ANY" };
    const data = await geminiRequest(cfg, {
      systemInstruction: { parts: [{ text: PERSONA }] },
      contents,
      tools,
      toolConfig: { functionCallingConfig }
    });

    const content = data?.candidates?.[0]?.content;
    if (!content) throw new Error(game.i18n.localize("CVP.Errors.EmptyReply"));
    contents.push(content);

    const calls = (content.parts || []).filter((p) => p.functionCall).map((p) => p.functionCall);

    // Final answer.
    const respondCall = calls.find((c) => c.name === "respond");
    if (respondCall) {
      const args = respondCall.args || {};
      // Real, deduped sources: curated recommendations first (their URLs are ours, never model-typed),
      // then the CartoonVillains channel + web sources when web help was used.
      const sources = [];
      const seen = new Set();
      const recommended = resolveRecommendations(args.recommendedModules, args.showGeneralHelp);
      const webSources = collectedSources.length
        ? [{ title: "CartoonVillains on YouTube", url: CARTOON_VILLAINS_YOUTUBE }, ...collectedSources]
        : [];
      for (const source of [...recommended, ...webSources]) {
        if (!source.url || seen.has(source.url)) continue;
        seen.add(source.url);
        sources.push(source);
        if (sources.length >= 8) break;
      }
      return {
        answer: args.answer || "",
        highlightKey: args.highlightKey,
        missingModule: args.missingModule,
        openUuid: args.openUuid,
        openOptions: Array.isArray(args.openOptions) ? args.openOptions : null,
        videoUrl: args.videoUrl,
        sources: sources.length ? sources : null,
        stumped: Boolean(args.stumped),
        rollFormula: args.rollFormula,
        rollTableId: args.rollTableId,
        runMacroId: args.runMacroId
      };
    }

    // Data tools — execute and feed results back.
    const responses = [];
    for (const call of calls) {
      let result;
      try {
        if (call.name === "queryWorld") result = await executeQueryWorld(call.args || {}, askerUser);
        else if (call.name === "searchWorld") result = await executeSearchWorld(call.args || {}, askerUser);
        else if (call.name === "webHelp") {
          options.onStatus?.("web"); // signal the slow grounded search so the UI can say so
          const res = await geminiGroundedSearch(cfg, call.args?.query || "");
          collectedSources.push(...res.sources);
          // Give the model the summary, video candidates, and source TITLES only — never the URLs, so
          // it can't echo a fabricated one. We attach the real source URLs ourselves at the end.
          result = { summary: res.summary, videoIds: res.videoIds, sources: res.sources.map((s) => s.title) };
        } else result = { error: `Unknown tool: ${call.name}` };
      } catch (err) {
        result = { error: err.message };
      }
      responses.push({ functionResponse: { name: call.name, response: result } });
    }
    if (responses.length) {
      contents.push({ role: "user", parts: responses });
      continue;
    }

    // No function call at all — fall back to any plain text the model produced.
    const text = (content.parts || []).map((p) => p.text || "").join("");
    if (text) return { answer: text };
    break;
  }

  throw new Error(game.i18n.localize("CVP.Errors.NoFinalAnswer"));
}
