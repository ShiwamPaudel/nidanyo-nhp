import { sqliteTable, text, integer, real, index } from "drizzle-orm/sqlite-core";
import { idCol, timestamps, actorColumns } from "./_shared";
import { labs } from "./lab";

/** departments — organizational grouping for tests (Hematology, Biochemistry...). */
export const departments = sqliteTable("departments", {
  id: idCol(),
  labId: text("lab_id")
    .notNull()
    .references(() => labs.id),
  name: text("name").notNull(),
  displayOrder: integer("display_order").notNull().default(0),
  /**
   * Billing-only departments (Dental, Radiology, Consultation…) are charged on a
   * bill but never produce a lab report from this system. Their tests get no
   * result entry, and a visit made up solely of them carries no report QR.
   */
  billingOnly: integer("billing_only", { mode: "boolean" }).notNull().default(false),
  /**
   * Report column visibility for this department's tests.
   *
   * Some departments never produce a unit or a reference range — a
   * Parasitology stool exam reports "Ova/cyst not seen" and nothing else — so
   * printing those columns leaves a blank strip down every line of the report.
   * Switching one off drops the whole column for that department's section
   * only; the remaining columns take the freed width.
   *
   * Both default to true, so every existing department keeps the four-column
   * layout it already prints. The stored reference-range/unit values are left
   * untouched — this hides them, it does not delete them, so flipping the
   * switch back restores the column exactly as it was.
   */
  showUnit: integer("show_unit", { mode: "boolean" }).notNull().default(true),
  showReferenceRange: integer("show_reference_range", { mode: "boolean" }).notNull().default(true),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  ...timestamps,
});

/** sample_types — configurable specimen types (Blood, Urine, Serum...). */
export const sampleTypes = sqliteTable("sample_types", {
  id: idCol(),
  labId: text("lab_id")
    .notNull()
    .references(() => labs.id),
  name: text("name").notNull(),
  colorHex: text("color_hex"), // tube/label color hint
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  ...timestamps,
});

/** referring_doctors — master list of referring doctors/clinics, admin-managed. */
export const referringDoctors = sqliteTable("referring_doctors", {
  id: idCol(),
  labId: text("lab_id")
    .notNull()
    .references(() => labs.id),
  name: text("name").notNull(),
  qualification: text("qualification"), // e.g. MBBS, MD
  clinic: text("clinic"), // hospital / clinic name
  phone: text("phone"),
  commissionPercent: real("commission_percent").notNull().default(0),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  ...timestamps,
});

/** payment_modes — configurable (Cash, eSewa/QR, Card, Bank...). */
export const paymentModes = sqliteTable("payment_modes", {
  id: idCol(),
  labId: text("lab_id")
    .notNull()
    .references(() => labs.id),
  name: text("name").notNull(),
  category: text("category", {
    enum: ["cash", "digital", "card", "bank", "other"],
  })
    .notNull()
    .default("other"),
  displayOrder: integer("display_order").notNull().default(0),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  ...timestamps,
});

/**
 * tests — orderable test catalog. A test may have a single result value or
 * multiple parameters (see test_parameters). `resultType` covers single-value
 * tests; multi-parameter tests use the parameter rows instead.
 */
export const tests = sqliteTable(
  "tests",
  {
    id: idCol(),
    labId: text("lab_id")
      .notNull()
      .references(() => labs.id),
    name: text("name").notNull(),
    shortCode: text("short_code").notNull(),
    departmentId: text("department_id").references(() => departments.id),
    sampleTypeId: text("sample_type_id").references(() => sampleTypes.id),
    price: real("price").notNull().default(0),
    method: text("method"),
    unit: text("unit"),
    // Free-text note/description printed under this test on the report
    // (e.g. instrument/methodology statement).
    description: text("description"),
    // Single-value reference handling
    resultType: text("result_type", {
      enum: ["numeric", "text", "select", "pos_neg", "multi"],
    })
      .notNull()
      .default("numeric"),
    selectOptions: text("select_options", { mode: "json" }).$type<string[]>(),
    refRangeText: text("ref_range_text"), // free-text reference (when not numeric)
    refLow: real("ref_low"),
    refHigh: real("ref_high"),
    criticalLow: real("critical_low"),
    criticalHigh: real("critical_high"),
    defaultRemarks: text("default_remarks"),
    tatHours: integer("tat_hours"), // expected turnaround time
    displayOrder: integer("display_order").notNull().default(0),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    ...timestamps,
    ...actorColumns,
  },
  (t) => ({
    labNameIdx: index("tests_lab_name_idx").on(t.labId, t.name),
    codeIdx: index("tests_code_idx").on(t.shortCode),
  }),
);

/**
 * test_parameters — sub-analytes for multi-parameter tests (e.g. CBC).
 * Supports gender- and age-specific reference ranges via JSON overrides.
 */
export const testParameters = sqliteTable(
  "test_parameters",
  {
    id: idCol(),
    testId: text("test_id")
      .notNull()
      .references(() => tests.id),
    name: text("name").notNull(),
    unit: text("unit"),
    resultType: text("result_type", {
      enum: ["numeric", "text", "select", "pos_neg"],
    })
      .notNull()
      .default("numeric"),
    selectOptions: text("select_options", { mode: "json" }).$type<string[]>(),
    refRangeText: text("ref_range_text"),
    refLow: real("ref_low"),
    refHigh: real("ref_high"),
    criticalLow: real("critical_low"),
    criticalHigh: real("critical_high"),
    // [{ gender?: 'male'|'female', minAge?, maxAge?, low?, high?, text? }]
    refOverrides: text("ref_overrides", { mode: "json" }).$type<
      Array<{
        gender?: "male" | "female";
        minAge?: number;
        maxAge?: number;
        low?: number;
        high?: number;
        text?: string;
      }>
    >(),
    defaultRemarks: text("default_remarks"),
    displayOrder: integer("display_order").notNull().default(0),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    ...timestamps,
  },
  (t) => ({
    testIdx: index("test_parameters_test_idx").on(t.testId),
  }),
);

/** test_groups — profiles/panels (CBC, LFT, Lipid Profile...). */
export const testGroups = sqliteTable("test_groups", {
  id: idCol(),
  labId: text("lab_id")
    .notNull()
    .references(() => labs.id),
  name: text("name").notNull(),
  shortCode: text("short_code"),
  departmentId: text("department_id").references(() => departments.id),
  // pricing: "fixed" uses groupPrice, "sum" uses sum of included tests
  pricingMode: text("pricing_mode", { enum: ["fixed", "sum"] })
    .notNull()
    .default("fixed"),
  groupPrice: real("group_price").notNull().default(0),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  ...timestamps,
  ...actorColumns,
});

/** test_group_items — tests included in a group. */
export const testGroupItems = sqliteTable(
  "test_group_items",
  {
    id: idCol(),
    groupId: text("group_id")
      .notNull()
      .references(() => testGroups.id),
    testId: text("test_id")
      .notNull()
      .references(() => tests.id),
    displayOrder: integer("display_order").notNull().default(0),
  },
  (t) => ({
    groupIdx: index("test_group_items_group_idx").on(t.groupId),
  }),
);
