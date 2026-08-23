import { and, asc, eq } from "drizzle-orm";
import { requirePermission } from "@/lib/auth/guard";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { db } from "@/db/client";
import { reportSignatories, users } from "@/db/schema";
import { SignatoriesManager } from "./signatories-manager";

export const metadata = { title: "Report Signatories" };

export default async function ReportSignatoriesPage() {
  const me = await requirePermission(PERMISSIONS.SETTINGS_MANAGE);
  const [rows, staff] = await Promise.all([
    db
      .select()
      .from(reportSignatories)
      .where(eq(reportSignatories.labId, me.labId))
      .orderBy(asc(reportSignatories.displayOrder), asc(reportSignatories.createdAt)),
    // Candidates for a staff-specific signature: any active account in the lab.
    // The lab decides which of them sign — reception rarely does, technicians do.
    db
      .select({ id: users.id, name: users.name, designation: users.designation, roleKey: users.roleKey })
      .from(users)
      .where(and(eq(users.labId, me.labId), eq(users.isActive, true)))
      .orderBy(asc(users.name)),
  ]);

  return (
    <SignatoriesManager
      items={rows.map((r) => ({
        id: r.id,
        userId: r.userId,
        name: r.name,
        description: r.description,
        url: r.url,
      }))}
      staff={staff}
    />
  );
}
