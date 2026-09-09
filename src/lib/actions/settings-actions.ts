"use server";

import { revalidatePath } from "next/cache";
import { and, eq, ne } from "drizzle-orm";
import { db } from "@/db/client";
import { labs, labSettings, users, roles, paymentModes, labAssets, reportSignatories } from "@/db/schema";
import { authorize } from "@/lib/auth/guard";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { hashPassword } from "@/lib/crypto";
import { storage } from "@/lib/storage";
import { sendSms } from "@/lib/sms";
import { sendEmail } from "@/lib/email";
import { ActionResult, ok, fail, run } from "@/lib/action";
import { audit } from "@/lib/audit";
import { labProfileSchema, userSchema, paymentModeSchema, type LabProfileInput, type UserInput } from "@/lib/validators/settings";
import { ALL_PERMISSIONS, type PermissionKey } from "@/lib/rbac/permissions";

function fe(issues: { path: (string | number)[]; message: string }[]) {
  const out: Record<string, string> = {};
  for (const i of issues) out[String(i.path[0] ?? "form")] = i.message;
  return out;
}

/** Update lab profile + settings. */
export async function updateLabProfile(input: LabProfileInput): Promise<ActionResult> {
  return run(async () => {
    const user = await authorize(PERMISSIONS.SETTINGS_MANAGE);
    const parsed = labProfileSchema.safeParse(input);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Please check the form.", fe(parsed.error.issues));
    const d = parsed.data;
    await db.update(labs).set({ name: d.name }).where(eq(labs.id, user.labId));
    await db
      .update(labSettings)
      .set({
        address: d.address || null,
        phone: d.phone || null,
        email: d.email || null,
        website: d.website || null,
        panVat: d.panVat || null,
        calendarSystem: d.calendarSystem,
        currency: d.currency,
        taxEnabled: d.taxEnabled,
        taxPercent: d.taxPercent,
        shortLinkBaseUrl: d.shortLinkBaseUrl || null,
        reportMarginTopMm: d.reportMarginTopMm,
        reportMarginBottomMm: d.reportMarginBottomMm,
        reportMarginXMm: d.reportMarginXMm,
        requirePhoneVerification: d.requirePhoneVerification,
        restrictDuePrint: d.restrictDuePrint,
        updatedBy: user.id,
      })
      .where(eq(labSettings.labId, user.labId));
    await audit(user, "settings.lab_profile", { entity: "lab", entityId: user.labId, summary: "Updated lab profile" });
    revalidatePath("/settings/lab-profile");
    return ok(undefined, "Lab profile saved");
  });
}

/** Upload a lab asset (report/bill header/footer or logo) via the storage adapter. */
export async function uploadLabAsset(formData: FormData): Promise<ActionResult<{ url: string }>> {
  return run(async () => {
    const user = await authorize(PERMISSIONS.SETTINGS_MANAGE);
    const kind = String(formData.get("kind") || "");
    const file = formData.get("file") as File | null;
    const allowed = ["report_header", "report_footer", "bill_header", "bill_footer", "logo"];
    if (!allowed.includes(kind)) return fail("Invalid asset type.");
    if (!file || file.size === 0) return fail("Please choose a file to upload.");
    if (file.size > 5 * 1024 * 1024) return fail("File is too large (max 5 MB).");
    if (!file.type.startsWith("image/")) return fail("Please upload an image file.");

    const buf = Buffer.from(await file.arrayBuffer());
    const stored = await storage.put({ data: buf, filename: file.name, contentType: file.type, folder: `${user.labId}/${kind}` });

    // These kinds are single-instance — deactivate any previous active one.
    await db.update(labAssets).set({ isActive: false }).where(and(eq(labAssets.labId, user.labId), eq(labAssets.kind, kind as never)));
    await db.insert(labAssets).values({ labId: user.labId, kind: kind as never, storageKey: stored.key, url: stored.url, mimeType: file.type, isActive: true, createdBy: user.id });

    await audit(user, "settings.asset_upload", { entity: "lab_asset", summary: `Uploaded ${kind}` });
    revalidatePath("/settings/report-assets");
    return ok({ url: stored.url }, "Uploaded successfully");
  });
}

export async function removeLabAsset(id: string): Promise<ActionResult> {
  return run(async () => {
    const user = await authorize(PERMISSIONS.SETTINGS_MANAGE);
    const asset = (await db.select().from(labAssets).where(and(eq(labAssets.id, id), eq(labAssets.labId, user.labId)))).at(0);
    if (!asset) return fail("Asset not found.");
    await db.update(labAssets).set({ isActive: false }).where(eq(labAssets.id, id));
    revalidatePath("/settings/report-assets");
    return ok(undefined, "Removed");
  });
}

/**
 * Create or update a report signatory (admin-managed signature block shown at
 * the end of reports). Accepts an optional image file — required when creating,
 * kept as-is on update when omitted.
 *
 * Which of these a report carries is decided by the approver at approval time
 * (see `approveVisit`), so every active block is simply offered there.
 */
export async function saveReportSignatory(formData: FormData): Promise<ActionResult> {
  return run(async () => {
    const user = await authorize(PERMISSIONS.SETTINGS_MANAGE);
    const id = (formData.get("id") as string) || null;
    const name = String(formData.get("name") || "").trim();
    const description = String(formData.get("description") || "").trim() || null;
    const file = formData.get("file") as File | null;
    if (name.length < 2) return fail("Please enter the signatory's name.", { name: "Name is required" });

    // `userId` is the retired staff-link, kept only so reports approved before
    // signatures were chosen at approval still resolve the way they did then.
    // The editor no longer sends the field, and an absent field must LEAVE IT
    // ALONE — clearing it would silently rewrite an old report's signature row.
    const rawUserId = formData.get("userId");
    const userId = rawUserId === null ? undefined : String(rawUserId).trim() || null;
    if (userId) {
      const staff = (
        await db.select({ id: users.id }).from(users).where(and(eq(users.id, userId), eq(users.labId, user.labId)))
      ).at(0);
      if (!staff) return fail("That staff account was not found.", { userId: "Unknown staff account" });
    }

    let stored: { key: string; url: string; mime: string | null } | null = null;
    if (file && file.size > 0) {
      if (file.size > 5 * 1024 * 1024) return fail("Image is too large (max 5 MB).");
      if (!file.type.startsWith("image/")) return fail("Please upload an image file.");
      const buf = Buffer.from(await file.arrayBuffer());
      const put = await storage.put({ data: buf, filename: file.name, contentType: file.type, folder: `${user.labId}/report_signature` });
      stored = { key: put.key, url: put.url, mime: file.type };
    }

    if (id) {
      const existing = (await db.select().from(reportSignatories).where(and(eq(reportSignatories.id, id), eq(reportSignatories.labId, user.labId)))).at(0);
      if (!existing) return fail("Signatory not found.");
      await db
        .update(reportSignatories)
        .set({
          name,
          description,
          ...(userId === undefined ? {} : { userId }),
          ...(stored ? { storageKey: stored.key, url: stored.url, mimeType: stored.mime } : {}),
          updatedBy: user.id,
        })
        .where(eq(reportSignatories.id, id));
      if (stored && existing.storageKey) await storage.remove(existing.storageKey).catch(() => {});
      await audit(user, "settings.signatory_update", { entity: "report_signatory", entityId: id, summary: `Updated signatory ${name}` });
    } else {
      if (!stored) return fail("Please choose a signature image.", { file: "Signature image is required" });
      const maxOrder = (await db.select().from(reportSignatories).where(eq(reportSignatories.labId, user.labId))).reduce((m, r) => Math.max(m, r.displayOrder), -1);
      await db.insert(reportSignatories).values({
        labId: user.labId,
        userId: userId ?? null,
        name,
        description,
        storageKey: stored.key,
        url: stored.url,
        mimeType: stored.mime,
        displayOrder: maxOrder + 1,
        createdBy: user.id,
      });
      await audit(user, "settings.signatory_create", { entity: "report_signatory", summary: `Added signatory ${name}` });
    }
    revalidatePath("/settings/report-signatories");
    return ok(undefined, "Saved");
  });
}

/** Delete a report signatory and its stored image. */
export async function removeReportSignatory(id: string): Promise<ActionResult> {
  return run(async () => {
    const user = await authorize(PERMISSIONS.SETTINGS_MANAGE);
    const row = (await db.select().from(reportSignatories).where(and(eq(reportSignatories.id, id), eq(reportSignatories.labId, user.labId)))).at(0);
    if (!row) return fail("Signatory not found.");
    await db.delete(reportSignatories).where(eq(reportSignatories.id, id));
    if (row.storageKey) await storage.remove(row.storageKey).catch(() => {});
    await audit(user, "settings.signatory_delete", { entity: "report_signatory", entityId: id, summary: `Removed signatory ${row.name}` });
    revalidatePath("/settings/report-signatories");
    return ok(undefined, "Removed");
  });
}

/** Persist a new left-to-right order for report signatories. */
export async function reorderReportSignatories(orderedIds: string[]): Promise<ActionResult> {
  return run(async () => {
    const user = await authorize(PERMISSIONS.SETTINGS_MANAGE);
    await Promise.all(
      orderedIds.map((id, idx) =>
        db.update(reportSignatories).set({ displayOrder: idx }).where(and(eq(reportSignatories.id, id), eq(reportSignatories.labId, user.labId))),
      ),
    );
    revalidatePath("/settings/report-signatories");
    return ok(undefined, "Reordered");
  });
}

/** Create or update a user. */
export async function saveUser(input: UserInput & { id?: string }): Promise<ActionResult> {
  return run(async () => {
    const admin = await authorize(PERMISSIONS.USERS_MANAGE);
    const parsed = userSchema.safeParse(input);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Please check the form.", fe(parsed.error.issues));
    const d = parsed.data;
    const email = d.email.toLowerCase();
    const role = (await db.select().from(roles).where(eq(roles.id, d.roleId))).at(0);
    if (!role) return fail("Selected role not found.");

    const dup = (await db.select().from(users).where(eq(users.email, email))).at(0);
    if (dup && dup.id !== input.id) return fail("A user with this email already exists.");

    if (input.id) {
      const existing = (await db.select().from(users).where(and(eq(users.id, input.id), eq(users.labId, admin.labId)))).at(0);
      if (!existing) return fail("User not found.");
      await db
        .update(users)
        .set({
          name: d.name,
          email,
          phone: d.phone || null,
          roleId: role.id,
          roleKey: role.key,
          designation: d.designation || null,
          registrationNo: d.registrationNo || null,
          ...(d.password ? { passwordHash: await hashPassword(d.password) } : {}),
          updatedBy: admin.id,
        })
        .where(eq(users.id, input.id));
      await audit(admin, "user.update", { entity: "user", entityId: input.id, summary: `Updated user ${d.name}` });
    } else {
      if (!d.password) return fail("Set a password for the new user.", { password: "Password is required" });
      await db.insert(users).values({
        labId: admin.labId,
        name: d.name,
        email,
        phone: d.phone || null,
        passwordHash: await hashPassword(d.password),
        roleId: role.id,
        roleKey: role.key,
        designation: d.designation || null,
        registrationNo: d.registrationNo || null,
        createdBy: admin.id,
      });
      await audit(admin, "user.create", { entity: "user", summary: `Created user ${d.name} (${role.name})` });
    }
    revalidatePath("/settings/users");
    return ok(undefined, input.id ? "User updated" : "User created");
  });
}

export async function setUserActive(id: string, active: boolean): Promise<ActionResult> {
  return run(async () => {
    const admin = await authorize(PERMISSIONS.USERS_MANAGE);
    if (id === admin.id) return fail("You cannot deactivate your own account.");
    await db.update(users).set({ isActive: active }).where(and(eq(users.id, id), eq(users.labId, admin.labId)));
    await audit(admin, "user.toggle", { entity: "user", entityId: id, summary: active ? "Activated user" : "Deactivated user" });
    revalidatePath("/settings/users");
    return ok(undefined, active ? "User activated" : "User deactivated");
  });
}

export async function updateRolePermissions(roleId: string, permissions: string[]): Promise<ActionResult> {
  return run(async () => {
    const admin = await authorize(PERMISSIONS.ROLES_MANAGE);
    const role = (await db.select().from(roles).where(eq(roles.id, roleId))).at(0);
    if (!role) return fail("Role not found.");
    if (role.key === "super_admin" || role.key === "lab_admin") return fail("Administrator roles always have full access and cannot be limited.");
    const valid = permissions.filter((p) => (ALL_PERMISSIONS as string[]).includes(p)) as PermissionKey[];
    await db.update(roles).set({ permissions: valid }).where(eq(roles.id, roleId));
    await audit(admin, "role.update", { entity: "role", entityId: roleId, summary: `Updated permissions for ${role.name}` });
    revalidatePath("/settings/roles");
    return ok(undefined, "Permissions updated");
  });
}

export async function savePaymentMode(input: { id?: string; name: string; category: string }): Promise<ActionResult> {
  return run(async () => {
    const admin = await authorize(PERMISSIONS.SETTINGS_MANAGE);
    const parsed = paymentModeSchema.safeParse(input);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Please check the form.");
    if (input.id) {
      await db.update(paymentModes).set({ name: parsed.data.name, category: parsed.data.category }).where(and(eq(paymentModes.id, input.id), eq(paymentModes.labId, admin.labId)));
    } else {
      await db.insert(paymentModes).values({ labId: admin.labId, name: parsed.data.name, category: parsed.data.category });
    }
    revalidatePath("/settings/payment-modes");
    return ok(undefined, "Saved");
  });
}

export async function setPaymentModeActive(id: string, active: boolean): Promise<ActionResult> {
  return run(async () => {
    const admin = await authorize(PERMISSIONS.SETTINGS_MANAGE);
    await db.update(paymentModes).set({ isActive: active }).where(and(eq(paymentModes.id, id), eq(paymentModes.labId, admin.labId)));
    revalidatePath("/settings/payment-modes");
    return ok(undefined, active ? "Enabled" : "Disabled");
  });
}

export async function sendTestEmail(email: string): Promise<ActionResult> {
  return run(async () => {
    const admin = await authorize(PERMISSIONS.SETTINGS_MANAGE);
    const ok2 = /.+@.+\..+/.test(email.trim());
    if (!ok2) return fail("Enter a valid email address.");
    const res = await sendEmail({
      labId: admin.labId,
      toEmail: email.trim(),
      subject: "Nidanyo test email",
      html: "<p>This is a test email from Nidanyo — your email configuration is working.</p>",
      purpose: "test",
      sentBy: admin.id,
    });
    if (!res.ok) return fail(res.error ?? "Could not send the test email. Please check your email settings.");
    return ok(undefined, "Test email sent");
  });
}

export async function sendTestSms(phone: string): Promise<ActionResult> {
  return run(async () => {
    const admin = await authorize(PERMISSIONS.SETTINGS_MANAGE);
    if (!phone || phone.trim().length < 6) return fail("Enter a valid phone number.");
    const res = await sendSms({ labId: admin.labId, toPhone: phone.trim(), body: "Nidanyo test message — your SMS configuration is working.", purpose: "other", sentBy: admin.id });
    if (!res.ok) return fail(res.error ?? "Could not send the test message. Please check your SMS settings.");
    return ok(undefined, "Test message sent");
  });
}

export { ne };
