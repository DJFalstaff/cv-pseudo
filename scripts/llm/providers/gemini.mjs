/**
 * Low-level Gemini generateContent request with light retry on rate limits. Returns the parsed JSON
 * response; throws on non-429 errors. Used by the function-calling loop in the transport.
 * @param {{apiKey: string, model: string, baseUrl: string}} cfg
 * @param {object} payload The full request body (contents, tools, systemInstruction, …).
 * @returns {Promise<object>} Parsed response JSON.
 */
export async function geminiRequest(cfg, payload) {
  const base = (cfg.baseUrl || "https://generativelanguage.googleapis.com/v1beta").replace(/\/+$/, "");
  const url = `${base}/models/${encodeURIComponent(cfg.model)}:generateContent`;

  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": cfg.apiKey },
      body: JSON.stringify(payload)
    });
    if (response.status === 429) {
      if (attempt < 2) {
        await new Promise((r) => setTimeout(r, 2500 * (attempt + 1))); // back off and retry
        continue;
      }
      throw new Error(game.i18n.localize("CVP.Errors.RateLimited"));
    }
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 300);
      throw new Error(`Gemini ${response.status}: ${detail}`);
    }
    return response.json();
  }
  throw new Error(game.i18n.localize("CVP.Errors.RateLimited"));
}

/**
 * Grounded web search via Gemini's Google Search tool. Returns the grounded summary and the REAL
 * sources from grounding metadata — never URLs scraped from the model's prose, which can be
 * fabricated. The source URIs are Google redirect wrappers that always resolve to the real page.
 * YouTube video ids are still pulled from the text as candidates, but callers must validate them
 * (via oEmbed) before trusting them. Grounding can't share a request with function-calling, so this
 * is its own call, invoked by the webHelp tool.
 * @param {{apiKey: string, model: string, baseUrl: string}} cfg
 * @param {string} query
 * @returns {Promise<{summary: string, sources: Array<{title: string, url: string}>, videoIds: string[]}>}
 */
export async function geminiGroundedSearch(cfg, query) {
  const data = await geminiRequest(cfg, {
    contents: [{ role: "user", parts: [{ text: query }] }],
    tools: [{ google_search: {} }]
  });
  const candidate = data?.candidates?.[0];
  const parts = candidate?.content?.parts || [];
  const text = parts.map((p) => p.text || "").join("");

  // Real, Google-verified sources. These are the only URLs we ever surface to the user.
  const sources = [];
  const seen = new Set();
  for (const chunk of candidate?.groundingMetadata?.groundingChunks || []) {
    const url = chunk.web?.uri;
    if (!url || seen.has(url)) continue;
    seen.add(url);
    sources.push({ title: chunk.web?.title || url, url });
  }

  const videoIds = [
    ...new Set(
      [...text.matchAll(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([A-Za-z0-9_-]{11})/g)].map((m) => m[1])
    )
  ];

  return { summary: text.slice(0, 2000), sources: sources.slice(0, 6), videoIds: videoIds.slice(0, 3) };
}

/**
 * Google Gemini transport (AI Studio / Generative Language API).
 *
 * The key travels in the `x-goog-api-key` header, not the URL query string, so it never lands in
 * server logs, browser history, or a referrer. When a schema is supplied, Gemini's structured-output
 * mode is engaged so the reply parses cleanly instead of arriving wrapped in conversational filler.
 *
 * @param {{apiKey: string, model: string, baseUrl: string}} cfg Provider configuration.
 * @param {string} prompt The GM's question or instruction.
 * @param {object} [options]
 * @param {object|string} [options.context] World context to ground the answer.
 * @param {object} [options.schema] A response schema to force structured JSON output.
 * @param {string} [options.system] System instruction (persona / ground rules).
 * @returns {Promise<string|object>} The reply text, or parsed JSON when a schema is given.
 */
export async function callGemini(cfg, prompt, { context = {}, schema = null, system = "" } = {}) {
  const base = (cfg.baseUrl || "https://generativelanguage.googleapis.com/v1beta").replace(/\/+$/, "");
  const url = `${base}/models/${encodeURIComponent(cfg.model)}:generateContent`;

  const parts = [];
  const hasContext = typeof context === "string" ? context.length > 0 : Object.keys(context ?? {}).length > 0;
  if (hasContext) {
    const body = typeof context === "string" ? context : JSON.stringify(context);
    parts.push({ text: `Context:\n${body}` });
  }
  parts.push({ text: prompt });

  const generationConfig = { temperature: 0.7 };
  if (schema) {
    generationConfig.responseMimeType = "application/json";
    generationConfig.responseSchema = schema;
  }

  const payload = { contents: [{ parts }], generationConfig };
  if (system) payload.systemInstruction = { parts: [{ text: system }] };

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": cfg.apiKey },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300);
    throw new Error(`Gemini ${response.status}: ${detail}`);
  }

  const data = await response.json();
  const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  if (!text) throw new Error(game.i18n.localize("CVP.Errors.EmptyReply"));

  return schema ? JSON.parse(text) : text;
}
