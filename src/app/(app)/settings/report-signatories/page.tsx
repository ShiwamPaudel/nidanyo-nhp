import { asc, eq } from "drizzle-orm";
import { requirePermission } from "@/lib/auth/guard";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { db } from "@/db/client";
import { reportSignatories } from "@/db/schema";
import { SignatoriesManager } from "./signatories-manager";

export const metadata = { title: "Report Signatories" };

export default async function ReportSignatoriesPage() {
  const me = await requirePermission(PERMISSIONS.SETTINGS_MANAGE);
  const rows = await db
    .select()
    .from(reportSignatories)
    .where(eq(reportSignatories.labId, me.labId))
    .orderBy(asc(reportSignatories.displayOrder), asc(reportSignatories.createdAt));

  return (
    <SignatoriesManager
      items={rows.map((r) => ({ id: r.id, name: r.name, description: r.description, url: r.url }))}
    />
  );
}
