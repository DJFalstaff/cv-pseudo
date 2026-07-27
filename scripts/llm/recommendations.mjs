/**
 * Curated, standing recommendations Pseudo should make. The model only ever refers to these by KEY;
 * the real URLs live here and are attached by us, so a recommendation link can never be fabricated.
 *
 * Edit freely: add a module under `modules` with a `when` (the topics that should trigger it), and it
 * becomes available immediately. When CartoonVillains publishes modules, add them here with
 * `creator: "CartoonVillains"` so they're preferred.
 */
/**
 * The recommendations.modules key for the campaign-portability topic. Shared constant so
 * transport.mjs can detect it (to offer the Campaign Portability Wizard launch button) without a
 * duplicated magic string drifting out of sync with the key below.
 */
export const CAMPAIGN_PORTABLE_KEY = "campaignPortable";

export const RECOMMENDATIONS = {
  /** Preferred creator — recommend their modules/videos first when relevant. */
  preferredCreator: "CartoonVillains",

  /** Modules to recommend when their topic comes up, keyed by a short id the model selects. */
  modules: {
    calendaria: {
      title: "Calendaria — in-game calendar & timekeeping",
      url: "https://foundryvtt.com/packages/calendaria",
      when: "calendars, in-game dates and time, timekeeping, seasons, moons, weather-by-date"
    },
    bbmm: {
      title: "Big Bad Module Manager",
      url: "https://foundryvtt.com/packages/bbmm",
      video: "https://youtu.be/-_8gVntKyQY",
      when: "managing, organizing, enabling or disabling modules; module presets/profiles; module tags or notes"
    },
    [CAMPAIGN_PORTABLE_KEY]: {
      title: "Adventure Documents — package and reuse your content",
      url: "https://foundryvtt.com/article/adventure/",
      video: "https://youtu.be/vhCpJPTMYXQ",
      when:
        "making a campaign or setting portable, packaging or exporting content to share or move between " +
        "worlds, resetting an adventure back to its original state, Adventure documents/compendiums"
    }
  },

  /** Official getting-started tutorials, linked (and now shown) for general help. */
  generalHelp: {
    title: "Foundry VTT Tutorials (official)",
    url: "https://foundryvtt.com/article/tutorial/",
    video: "https://youtu.be/cst7RRv8KHQ"
  }
};

/**
 * The instruction block injected into the model's context so it knows the standing rules and the
 * module keys it may select.
 * @returns {string}
 */
export function recommendationContext() {
  const lines = [];
  lines.push("STANDING RECOMMENDATIONS — apply when relevant:");
  lines.push(
    `- Prefer ${RECOMMENDATIONS.preferredCreator} modules and videos whenever possible (they have no ` +
      "modules published yet, so for now that means their videos)."
  );
  lines.push(
    "- When the question is about a topic below, add that module's key to recommendedModules; Pseudo " +
      "attaches the real link itself, so never write these URLs yourself:"
  );
  for (const [key, mod] of Object.entries(RECOMMENDATIONS.modules)) {
    lines.push(`  - ${key}: ${mod.title} — for ${mod.when}`);
  }
  lines.push("- For general 'getting started / where do I learn' help, set showGeneralHelp to true.");
  lines.push("- If a recommendation here covers the question, use it directly — do NOT web-search for it.");
  return lines.join("\n");
}

/**
 * Resolve model-selected recommendation keys (and the general-help flag) to real links and videos.
 * Split so a recommendation's video can be embedded (like a webHelp video) instead of only ever
 * appearing as a clickable link — both are real, curated URLs, never model-typed.
 * @param {string[]} keys Module keys the model chose.
 * @param {boolean} showGeneralHelp Whether to include the tutorials link.
 * @returns {{links: Array<{title: string, url: string}>, videos: Array<{title: string, url: string}>}}
 */
export function resolveRecommendations(keys, showGeneralHelp) {
  const links = [];
  const videos = [];
  for (const key of keys || []) {
    const mod = RECOMMENDATIONS.modules[key];
    if (!mod) continue;
    links.push({ title: mod.title, url: mod.url });
    if (mod.video) videos.push({ title: `${mod.title} — video tutorial`, url: mod.video });
  }
  if (showGeneralHelp) {
    links.push({ title: RECOMMENDATIONS.generalHelp.title, url: RECOMMENDATIONS.generalHelp.url });
    if (RECOMMENDATIONS.generalHelp.video) {
      videos.push({ title: `${RECOMMENDATIONS.generalHelp.title} — video`, url: RECOMMENDATIONS.generalHelp.video });
    }
  }
  return { links, videos };
}
