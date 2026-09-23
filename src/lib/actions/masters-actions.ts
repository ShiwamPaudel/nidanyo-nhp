"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { departments, sampleTypes, referringDoctors } from "@/db/schema";
import { authorize } from "@/lib/auth/guard";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { ActionResult, ok, fail, run } from "@/lib/action";
import { audit } from "@/lib/audit";

/* ── Departments ─────────────────────────────────────────────── */
export async function saveDepartment(input: {
  id?: string;
  name: string;
  displayOrder?: number;
  billingOnly?: boolean;
  /** Print the Unit column for this department's tests (Settings → Departments). */
  showUnit?: boolean;
  /** Print the Reference Range column for this department's tests. */
  showReferenceRange?: boolean;
}): Promise<ActionResult> {
  return run(async () => {
    const user = await authorize(PERMISSIONS.SETTINGS_MANAGE);
    const name = input.name?.trim();
    if (!name) return fail("Department name is required.");
    const billingOnly = input.billingOnly ?? false;
    if (input.id) {
      // Only write displayOrder when the caller actually supplied one —
      // defaulting to 0 here silently reset a department's order every time
      // someone edited its name.
      await db
        .update(departments)
        // Same reasoning as displayOrder for the two column flags: a caller
        // that does not mention them must not silently switch them back on.
        .set({
          name,
          billingOnly,
          ...(input.displayOrder != null ? { displayOrder: input.displayOrder } : {}),
          ...(input.showUnit != null ? { showUnit: input.showUnit } : {}),
          ...(input.showReferenceRange != null ? { showReferenceRange: input.showReferenceRange } : {}),
        })
        .where(and(eq(departments.id, input.id), eq(departments.labId, user.labId)));
    } else {
      await db.insert(departments).values({
        labId: user.labId,
        name,
        displayOrder: input.displayOrder ?? 0,
        billingOnly,
        showUnit: input.showUnit ?? true,
        showReferenceRange: input.showReferenceRange ?? true,
      });
    }
    await audit(user, "department.save", { entity: "department", summary: `Saved department ${name}${billingOnly ? " (billing-only)" : ""}` });
    revalidatePath("/settings/departments");
    revalidatePath("/billing");
    // The flags change what a report prints, so both report surfaces must
    // re-render rather than serve a cached four-column layout.
    revalidatePath("/print/report", "layout");
    revalidatePath("/r", "layout");
    return ok(undefined, "Saved");
  });
}

export async function setDepartmentActive(id: string, active: boolean): Promise<ActionResult> {
  return run(async () => {
    const user = await authorize(PERMISSIONS.SETTINGS_MANAGE);
    await db.update(departments).set({ isActive: active }).where(and(eq(departments.id, id), eq(departments.labId, user.labId)));
    revalidatePath("/settings/departments");
    return ok(undefined, active ? "Enabled" : "Disabled");
  });
}

/* ── Sample types ────────────────────────────────────────────── */
export async function saveSampleType(input: { id?: string; name: string; colorHex?: string | null }): Promise<ActionResult> {
  return run(async () => {
    const user = await authorize(PERMISSIONS.SETTINGS_MANAGE);
    const name = input.name?.trim();
    if (!name) return fail("Sample type name is required.");
    if (input.id) {
      await db.update(sampleTypes).set({ name, colorHex: input.colorHex || null }).where(and(eq(sampleTypes.id, input.id), eq(sampleTypes.labId, user.labId)));
    } else {
      await db.insert(sampleTypes).values({ labId: user.labId, name, colorHex: input.colorHex || null });
    }
    await audit(user, "sample_type.save", { entity: "sample_type", summary: `Saved sample type ${name}` });
    revalidatePath("/settings/sample-types");
    return ok(undefined, "Saved");
  });
}

export async function setSampleTypeActive(id: string, active: boolean): Promise<ActionResult> {
  return run(async () => {
    const user = await authorize(PERMISSIONS.SETTINGS_MANAGE);
    await db.update(sampleTypes).set({ isActive: active }).where(and(eq(sampleTypes.id, id), eq(sampleTypes.labId, user.labId)));
    revalidatePath("/settings/sample-types");
    return ok(undefined, active ? "Enabled" : "Disabled");
  });
}

/* ── Referring doctors ───────────────────────────────────────── */
export async function saveDoctor(input: { id?: string; name: string; qualification?: string | null; clinic?: string | null; phone?: string | null; commissionPercent?: number }): Promise<ActionResult> {
  return run(async () => {
    const user = await authorize(PERMISSIONS.SETTINGS_MANAGE);
    const name = input.name?.trim();
    if (!name) return fail("Doctor name is required.");
    const values = {
      name,
      qualification: input.qualification || null,
      clinic: input.clinic || null,
      phone: input.phone || null,
      commissionPercent: input.commissionPercent ?? 0,
    };
    if (input.id) {
      await db.update(referringDoctors).set(values).where(and(eq(referringDoctors.id, input.id), eq(referringDoctors.labId, user.labId)));
    } else {
      await db.insert(referringDoctors).values({ labId: user.labId, ...values });
    }
    await audit(user, "doctor.save", { entity: "referring_doctor", summary: `Saved referring doctor ${name}` });
    revalidatePath("/settings/doctors");
    return ok(undefined, "Saved");
  });
}

export async function setDoctorActive(id: string, active: boolean): Promise<ActionResult> {
  return run(async () => {
    const user = await authorize(PERMISSIONS.SETTINGS_MANAGE);
    await db.update(referringDoctors).set({ isActive: active }).where(and(eq(referringDoctors.id, id), eq(referringDoctors.labId, user.labId)));
    revalidatePath("/settings/doctors");
    return ok(undefined, active ? "Enabled" : "Disabled");
  });
}
