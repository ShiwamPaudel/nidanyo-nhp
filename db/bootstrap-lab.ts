import { config } from "dotenv";
// Load .env.local first (takes precedence, mirrors Next.js), then .env fills gaps.
config({ path: ".env.local" });
config({ path: ".env" });
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import * as schema from "../src/db/schema";
import { ALL_PERMISSIONS, type PermissionKey } from "../src/lib/rbac/permissions";

/**
 * Bootstraps a NEW, EMPTY lab database for a live clinic.
 *
 *   npx tsx db/bootstrap-lab.ts --dry     # preview, writes nothing
 *   npx tsx db/bootstrap-lab.ts
 *
 * Seeds ONLY the reference/master data that is identical across labs — roles,
 * departments, sample types, payment modes, counters — plus the lab row, its
 * settings and the admin account. Everything clinic-specific (tests, prices,
 * reference ranges, report/bill headers, logo, signatories, referring doctors,
 * staff accounts) is left empty and configured by the lab admin from Settings.
 *
 * The master lists mirror the established production configuration of the first
 * Nidanyo deployment, so a new lab starts from a known-good baseline rather than
 * the demo catalogue in `db/seed.ts`.
 *
 * Idempotent: every step is insert-if-missing, so re-running never overwrites
 * anything an admin has since changed. Run `npm run db:migrate` first.
 */

const id = () => randomUUID();
const DRY = process.argv.includes("--dry");

/** Roles + permission sets shared by every Nidanyo lab. */
const ROLES: {
  key: string;
  name: string;
  description: string;
  global?: boolean;
  permissions: PermissionKey[];
}[] = [
  {
    key: "super_admin",
    name: "Super Admin",
    description: "Product administrator — full access across the system.",
    global: true,
    permissions: ALL_PERMISSIONS,
  },
  {
    key: "lab_admin",
    name: "Lab Admin",
    description: "Full access within the laboratory.",
    permissions: ALL_PERMISSIONS,
  },
  {
    key: "reception",
    name: "Reception / Billing",
    description: "Registration, visits, billing, payments and dues.",
    permissions: [
      "dashboard.view", "patient.view", "patient.manage", "visit.view", "visit.create",
      "visit.cancel", "bill.view", "bill.manage", "payment.receive", "due.view",
      "due.collect", "catalog.view", "report.view", "transactions.view",
      "finance.reports.view", "finance.export",
    ] as PermissionKey[],
  },
  {
    key: "sample_collection",
    name: "Sample Collection",
    description: "Sample queue, accessioning and specimen handling.",
    permissions: [
      "dashboard.view", "patient.view", "visit.view", "sample.view", "sample.manage",
    ] as PermissionKey[],
  },
  {
    key: "lab_technician",
    name: "Lab Technician",
    description: "Result entry and submission for approval.",
    permissions: [
      "dashboard.view", "patient.view", "visit.view", "sample.view", "sample.manage",
      "result.view", "result.enter", "approval.view", "approval.act", "report.view",
    ] as PermissionKey[],
  },
  {
    key: "pathologist",
    name: "Doctor / Pathologist",
    description: "Review, approve and sign results.",
    permissions: [
      "dashboard.view", "patient.view", "visit.view", "result.view", "approval.view",
      "approval.act", "report.view",
    ] as PermissionKey[],
  },
  {
    key: "accounts",
    name: "Accounts",
    description: "Payments, dues, EOD and financial reports.",
    permissions: [
      "dashboard.view", "patient.view", "visit.view", "bill.view", "due.view",
      "transactions.view", "finance.reports.view", "finance.export", "result.view",
      "catalog.view", "report.view", "dispatch.view",
    ] as PermissionKey[],
  },
  {
    key: "dispatch",
    name: "Dispatch",
    description: "Dispatch approved and cleared reports.",
    permissions: [
      "dashboard.view", "patient.view", "visit.view", "report.view", "dispatch.view",
      "dispatch.act", "sms.send",
    ] as PermissionKey[],
  },
];

/** `billingOnly` departments hold billable services that produce no lab report. */
const DEPARTMENTS: { name: string; displayOrder: number; billingOnly: boolean }[] = [
  { name: "Hematology", displayOrder: 1, billingOnly: false },
  { name: "Biochemistry", displayOrder: 2, billingOnly: false },
  { name: "Immunology", displayOrder: 3, billingOnly: false },
  { name: "Serology", displayOrder: 4, billingOnly: false },
  { name: "Microbiology", displayOrder: 5, billingOnly: false },
  { name: "Andrology", displayOrder: 6, billingOnly: false },
  { name: "Clinical Pathology", displayOrder: 7, billingOnly: false },
  { name: "Cytology", displayOrder: 8, billingOnly: false },
  { name: "Parasitology", displayOrder: 9, billingOnly: false },
  { name: "Toxicology", displayOrder: 10, billingOnly: false },
  { name: "Cardiology", displayOrder: 11, billingOnly: true },
  { name: "Radiology", displayOrder: 12, billingOnly: true },
  { name: "Histopathology", displayOrder: 13, billingOnly: true },
  { name: "Dental", displayOrder: 14, billingOnly: true },
  { name: "Doctor Consultation", displayOrder: 15, billingOnly: true },
  { name: "Physiotherapy", displayOrder: 16, billingOnly: true },
  { name: "Procedure", displayOrder: 17, billingOnly: true },
  { name: "Suture", displayOrder: 18, billingOnly: true },
  { name: "Others", displayOrder: 19, billingOnly: true },
];

const SAMPLE_TYPES: { name: string; colorHex: string }[] = [
  { name: "Whole Blood", colorHex: "#B91C1C" },
  { name: "Serum", colorHex: "#D97706" },
  { name: "Sputum", colorHex: "#16A34A" },
  { name: "Urine", colorHex: "#CA8A04" },
  { name: "Stool", colorHex: "#92400E" },
  { name: "Swab", colorHex: "#2563EB" },
  { name: "Semen", colorHex: "#fffff0" },
  { name: "Fluid", colorHex: "#3e2768" },
  { name: "Pus", colorHex: "#ddea2a" },
  { name: "Skin", colorHex: "#ffc800" },
];

const PAYMENT_MODES: { name: string; category: "cash" | "digital" | "card" | "bank" | "other" }[] = [
  { name: "Cash", category: "cash" },
  { name: "eSewa", category: "digital" },
  { name: "Khalti", category: "digital" },
  { name: "QR / Fonepay", category: "digital" },
  { name: "Card", category: "card" },
  { name: "Bank Transfer", category: "bank" },
];

async function main() {
  const url = process.env.DATABASE_URL || "file:local.db";
  const client = createClient({ url, authToken: process.env.DATABASE_AUTH_TOKEN || undefined });
  const db = drizzle(client, { schema });

  const labName = process.env.SEED_LAB_NAME;
  if (!labName) throw new Error("SEED_LAB_NAME is required");
  const labCode = process.env.SEED_LAB_CODE || "lab";
  const adminName = process.env.SEED_ADMIN_NAME || "Lab Administrator";
  const adminEmail = process.env.SEED_ADMIN_EMAIL;
  const adminPassword = process.env.SEED_ADMIN_PASSWORD;
  if (!adminEmail || !adminPassword) {
    throw new Error("SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD are required");
  }
  // Left NULL unless explicitly given: `reportUrl()` then falls back to
  // NEXT_PUBLIC_APP_URL at request time, so a dev value never gets baked into
  // live report links. The admin can pin it under Settings → Lab Profile.
  const shortLinkBaseUrl = process.env.SEED_SHORT_LINK_BASE_URL?.trim() || null;

  console.log(`Bootstrapping "${labName}"`);
  console.log(`  database   : ${url}`);
  console.log(`  short links: ${shortLinkBaseUrl ?? "(falls back to NEXT_PUBLIC_APP_URL)"}`);
  if (DRY) console.log("  MODE       : dry run — nothing will be written");
  console.log("");

  // ── Lab + settings ───────────────────────────────────────────────────────
  let lab = (await db.select().from(schema.labs).limit(1)).at(0);
  if (!lab) {
    const labId = id();
    if (!DRY) {
      await db
        .insert(schema.labs)
        .values({ id: labId, name: labName, code: labCode, isActive: true });
      await db.insert(schema.labSettings).values({
        id: id(),
        labId,
        // Address, phone, email, website and PAN/VAT are filled in by the admin
        // under Settings → Lab Profile.
        currency: "NPR",
        calendarSystem: "BS",
        taxEnabled: false,
        taxPercent: 0,
        reportMarginTopMm: 30,
        reportMarginBottomMm: 24,
        reportMarginXMm: 12,
        shortLinkBaseUrl,
        patientPrefix: "P",
        visitPrefix: "V",
        billPrefix: "B",
        samplePrefix: "S",
        requirePhoneVerification: false,
        restrictDuePrint: true,
      });
      lab = (await db.select().from(schema.labs).where(eq(schema.labs.id, labId))).at(0);
    }
    console.log(`  + Lab created: ${labName} (${labCode})`);
  } else {
    console.log(`  = Lab already exists: ${lab.name}`);
  }
  const labId = lab?.id ?? "(dry-run)";

  // ── Roles ────────────────────────────────────────────────────────────────
  const roleIdByKey: Record<string, string> = {};
  let rolesAdded = 0;
  for (const r of ROLES) {
    const existing = (await db.select().from(schema.roles).where(eq(schema.roles.key, r.key))).at(0);
    if (existing) {
      roleIdByKey[r.key] = existing.id;
      continue;
    }
    const rid = id();
    roleIdByKey[r.key] = rid;
    rolesAdded++;
    if (DRY) continue;
    await db.insert(schema.roles).values({
      id: rid,
      labId: r.global ? null : labId,
      key: r.key,
      name: r.name,
      description: r.description,
      permissions: r.permissions,
      isSystem: true,
      isActive: true,
    });
  }
  console.log(`  + Roles: ${rolesAdded} added, ${ROLES.length - rolesAdded} already present`);

  // ── Admin user ───────────────────────────────────────────────────────────
  const existingAdmin = (
    await db.select().from(schema.users).where(eq(schema.users.email, adminEmail))
  ).at(0);
  if (!existingAdmin) {
    if (!DRY) {
      await db.insert(schema.users).values({
        id: id(),
        labId,
        name: adminName,
        email: adminEmail,
        passwordHash: await bcrypt.hash(adminPassword, 10),
        roleId: roleIdByKey["lab_admin"],
        roleKey: "lab_admin",
        designation: "Administrator",
        isActive: true,
      });
    }
    console.log(`  + Admin user: ${adminEmail}`);
  } else {
    console.log(`  = Admin user already exists: ${adminEmail}`);
  }

  // ── Departments ──────────────────────────────────────────────────────────
  let deptAdded = 0;
  for (const d of DEPARTMENTS) {
    const ex = (
      await db.select().from(schema.departments).where(eq(schema.departments.name, d.name))
    ).at(0);
    if (ex) continue;
    deptAdded++;
    if (DRY) continue;
    await db.insert(schema.departments).values({
      id: id(),
      labId,
      name: d.name,
      displayOrder: d.displayOrder,
      billingOnly: d.billingOnly,
      isActive: true,
    });
  }
  console.log(
    `  + Departments: ${deptAdded} added, ${DEPARTMENTS.length - deptAdded} already present`,
  );

  // ── Sample types ─────────────────────────────────────────────────────────
  let stAdded = 0;
  for (const st of SAMPLE_TYPES) {
    const ex = (
      await db.select().from(schema.sampleTypes).where(eq(schema.sampleTypes.name, st.name))
    ).at(0);
    if (ex) continue;
    stAdded++;
    if (DRY) continue;
    await db.insert(schema.sampleTypes).values({
      id: id(),
      labId,
      name: st.name,
      colorHex: st.colorHex,
      isActive: true,
    });
  }
  console.log(
    `  + Sample types: ${stAdded} added, ${SAMPLE_TYPES.length - stAdded} already present`,
  );

  // ── Payment modes ────────────────────────────────────────────────────────
  let pmAdded = 0;
  for (let i = 0; i < PAYMENT_MODES.length; i++) {
    const m = PAYMENT_MODES[i];
    const ex = (
      await db.select().from(schema.paymentModes).where(eq(schema.paymentModes.name, m.name))
    ).at(0);
    if (ex) continue;
    pmAdded++;
    if (DRY) continue;
    await db.insert(schema.paymentModes).values({
      id: id(),
      labId,
      name: m.name,
      category: m.category,
      displayOrder: i,
      isActive: true,
    });
  }
  console.log(
    `  + Payment modes: ${pmAdded} added, ${PAYMENT_MODES.length - pmAdded} already present`,
  );

  // ── Counters (code generators start at zero for a brand-new lab) ─────────
  for (const entity of ["patient", "visit", "bill", "sample", "payment"]) {
    const ex = (
      await db.select().from(schema.counters).where(eq(schema.counters.entity, entity))
    ).at(0);
    if (ex || DRY) continue;
    await db.insert(schema.counters).values({ id: id(), labId, entity, period: "all", value: 0 });
  }
  console.log("  + Counters ready");

  console.log(
    DRY
      ? "\nDry run complete — nothing was written."
      : "\nBootstrap complete. Sign in at /login, then configure tests, prices, reference " +
          "ranges, report/bill headers, logo and signatories from Settings.",
  );
  client.close();
}

main().catch((err) => {
  console.error("Bootstrap failed:", err);
  process.exit(1);
});
