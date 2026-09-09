/**
 * LEGACY rule — which signature blocks appear on a report that was approved
 * before the approver chose them explicitly.
 *
 * A lab with several technicians does not want all of their signatures on every
 * report — it wants the one who actually handled the visit, next to the
 * pathologist. So a signatory row is one of two kinds:
 *
 *   • **staff-specific** (`userId` set) — printed only on reports for visits
 *     that this staff member registered (`visits.createdBy`).
 *   • **lab-wide** (`userId` null) — printed on every report. This is the
 *     pathologist / lab director block.
 *
 * The staff-specific match is emitted first so it lands on the LEFT of the
 * signature row, with the lab-wide block(s) to its right.
 *
 * Superseded by `visits.reportSignatoryIds`, which records the signatures the
 * approver actually selected. This is kept only so that visits approved before
 * that existed keep printing exactly what they printed then — a report already
 * handed to a patient must never change retroactively. New approvals never
 * reach this function; see `pickReportSignatoriesForVisit`.
 */

/** Most signature blocks a single report can carry. */
export const MAX_REPORT_SIGNATORIES = 3;

export interface SignatoryRow {
  id: string;
  userId: string | null;
  name: string;
  description: string | null;
  url: string;
  displayOrder: number;
}

export interface PickedSignatory {
  id: string;
  name: string;
  description: string | null;
  url: string;
}

/**
 * @param rows        Active signatories for the lab, already sorted by displayOrder.
 * @param createdById `visits.createdBy` — who registered the visit. Null on
 *                    legacy visits recorded before the column was populated.
 */
export function pickReportSignatories(
  rows: SignatoryRow[],
  createdById: string | null | undefined,
): PickedSignatory[] {
  const strip = ({ id, name, description, url }: SignatoryRow): PickedSignatory => ({
    id,
    name,
    description,
    url,
  });

  const labWide = rows.filter((r) => !r.userId);

  // No staff-specific blocks configured at all → the lab has not opted into
  // per-technician signatures, so behave exactly as before: print every active
  // block in configured order.
  if (labWide.length === rows.length) return rows.map(strip);

  // Only the block belonging to the person who registered THIS visit. If they
  // have none (a receptionist registered it, or the visit predates the column),
  // no staff signature is printed — better a missing signature than the wrong
  // person's on a medical document.
  const staff = createdById ? rows.filter((r) => r.userId === createdById) : [];

  return [...staff, ...labWide].map(strip);
}


/**
 * The signatures for a report, in print order (left to right).
 *
 * The approver's explicit choice wins whenever there is one. A visit approved
 * before signature selection existed has none stored, so it falls back to the
 * old staff-linked rule and keeps printing what it always did.
 */
export function pickReportSignatoriesForVisit(
  rows: SignatoryRow[],
  visit: { reportSignatoryIds?: string[] | null; createdBy?: string | null },
): PickedSignatory[] {
  const chosen = visit.reportSignatoryIds;
  if (chosen && chosen.length > 0) {
    const byId = new Map(rows.map((r) => [r.id, r]));
    // Ordered by the approver's selection, not displayOrder. A signature since
    // deactivated or deleted simply drops out rather than blanking the row.
    return chosen
      .map((id) => byId.get(id))
      .filter((r): r is SignatoryRow => Boolean(r))
      .map(({ id, name, description, url }) => ({ id, name, description, url }));
  }
  return pickReportSignatories(rows, visit.createdBy);
}
