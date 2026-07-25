/**
 * Open a document for the user by uuid, on their own screen.
 *
 * Prefers Spotlight Omnisearch's own `onClick` for the matching index entry — it already knows how to
 * open each kind of thing (a journal to the right page, a compendium entry's sheet, etc.). Falls back
 * to resolving the uuid and rendering the sheet directly. A uuid that doesn't resolve is a graceful
 * no-op, so a hallucinated uuid simply opens nothing.
 *
 * @param {string} uuid A document (or page) uuid, typically from a searchWorld result.
 * @returns {Promise<boolean>} Whether something was opened.
 */
export async function openByUuid(uuid) {
  if (!uuid) return false;

  const index = CONFIG?.SpotlightOmnisearch?.INDEX;
  const item = Array.isArray(index) ? index.find((i) => i.data?.uuid === uuid) : null;
  if (typeof item?.onClick === "function") {
    try {
      await item.onClick();
      return true;
    } catch {
      /* fall back to direct render */
    }
  }

  let doc;
  try {
    doc = await fromUuid(uuid);
  } catch {
    return false;
  }
  if (!doc) return false;

  // A journal page opens its parent journal to that page; everything else opens its own sheet.
  if (doc.documentName === "JournalEntryPage" && doc.parent?.sheet) {
    doc.parent.sheet.render(true, { pageId: doc.id });
    return true;
  }
  if (doc.sheet) {
    doc.sheet.render(true);
    return true;
  }
  return false;
}
