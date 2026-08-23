/**
 * Which signature blocks appear on a given report.
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
 * Both report surfaces (in-lab print and the patient's public link) run through
 * this one function, so a report never signs differently depending on where it
 * is viewed.
 */

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
