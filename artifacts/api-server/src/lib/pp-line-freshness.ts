/** How far back synced PP lines stay on the board / dashboard KPIs. */
export const PP_LINE_FRESHNESS_MS = 24 * 60 * 60 * 1000;

export function ppLineFreshSince(): Date {
  return new Date(Date.now() - PP_LINE_FRESHNESS_MS);
}
