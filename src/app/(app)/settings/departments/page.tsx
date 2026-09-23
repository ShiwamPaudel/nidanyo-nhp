import { asc, eq } from "drizzle-orm";
import { requirePermission } from "@/lib/auth/guard";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { db } from "@/db/client";
import { departments } from "@/db/schema";
import { MastersManager } from "../masters-manager";

export const metadata = { title: "Departments" };

export default async function DepartmentsPage() {
  const me = await requirePermission(PERMISSIONS.SETTINGS_MANAGE);
  const rows = await db.select().from(departments).where(eq(departments.labId, me.labId)).orderBy(asc(departments.displayOrder), asc(departments.name));
  return (
    <MastersManager
      kind="department"
      hint="Organize tests by department (Hematology, Biochemistry…). Mark a department billing-only when it is charged but produces no lab report. Edit a department to choose which result columns its tests print on the report."
      items={rows.map((r) => ({
        id: r.id,
        name: r.name,
        isActive: r.isActive,
        billingOnly: r.billingOnly,
        showUnit: r.showUnit,
        showReferenceRange: r.showReferenceRange,
        displayOrder: r.displayOrder,
      }))}
    />
  );
}
