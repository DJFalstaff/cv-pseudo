import { CAMPAIGN_PORTABLE_KEY } from "../llm/recommendations.mjs";
import { CampaignPortableWizard } from "./campaign-portable-wizard.mjs";

/**
 * Every curated wizard Pseudo can launch, in one place. The /wizards catalog, the contextual
 * chat-recommendation launch button, and any future entry point all read from this list — add a
 * wizard here and it shows up everywhere automatically, with nothing else to keep in sync.
 * @type {Array<{
 *   id: string,
 *   title: string,
 *   description: string,
 *   icon: string,
 *   gmOnly: boolean,
 *   recommendationKey: ?string,
 *   open: () => void
 * }>}
 */
export const WIZARDS = [
  {
    id: "campaignPortable",
    title: "Make Your Campaign Portable",
    description: "Package this World's campaign as a real, standalone, installable Foundry module.",
    icon: "fa-box-archive",
    gmOnly: true,
    recommendationKey: CAMPAIGN_PORTABLE_KEY,
    open: () => CampaignPortableWizard.open()
  }
];

/**
 * @param {string} id
 * @returns {?object} The wizard with this id, or null.
 */
export function getWizard(id) {
  return WIZARDS.find((w) => w.id === id) ?? null;
}

/**
 * @param {string} key A recommendations.mjs module key.
 * @returns {?object} The wizard tied to that recommendation, or null.
 */
export function findWizardByRecommendationKey(key) {
  return WIZARDS.find((w) => w.recommendationKey === key) ?? null;
}

/**
 * @returns {Array<object>} Wizards visible to the current user — GM-only ones hidden from players.
 */
export function availableWizards() {
  return WIZARDS.filter((w) => !w.gmOnly || game.user.isGM);
}
