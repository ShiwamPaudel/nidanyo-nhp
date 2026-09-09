import { sqliteTable, text, integer, real, index } from "drizzle-orm/sqlite-core";
import { idCol, timestamps, actorColumns } from "./_shared";
import { labs } from "./lab";
import { visits } from "./billing";

/**
 * samples — a specimen drawn for a visit. `code` is the accession/barcode id.
 * One sample can cover multiple tests of the same specimen type.
 */
export const samples = sqliteTable(
  "samples",
  {
    id: idCol(),
    labId: text("lab_id")
      .notNull()
      .references(() => labs.id),
    code: text("code").notNull(), // accession/barcode, e.g. S-000123
    visitId: text("visit_id")
      .notNull()
      .references(() => visits.id),
    sampleTypeId: text("sample_type_id"),
    sampleTypeName: text("sample_type_name"),
    status: text("status", {
      enum: [
        "waiting",
        "collected",
        "rejected",
        "recollection",
        "sent_to_lab",
        "processing",
        "completed",
      ],
    })
      .notNull()
      .default("waiting"),
    rejectionReason: text("rejection_reason"),
    collectedAt: integer("collected_at", { mode: "timestamp" }),
    collectedBy: text("collected_by"),
    collectedByName: text("collected_by_name"),
    ...timestamps,
    ...actorColumns,
  },
  (t) => ({
    labCodeIdx: index("samples_lab_code_idx").on(t.labId, t.code),
    visitIdx: index("samples_visit_idx").on(t.visitId),
    statusIdx: index("samples_status_idx").on(t.status),
  }),
);

/** sample_events — audit trail of sample status transitions. */
export const sampleEvents = sqliteTable(
  "sample_events",
  {
    id: idCol(),
    sampleId: text("sample_id")
      .notNull()
      .references(() => samples.id),
    fromStatus: text("from_status"),
    toStatus: text("to_status").notNull(),
    note: text("note"),
    actorId: text("actor_id"),
    actorName: text("actor_name"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => ({
    sampleIdx: index("sample_events_sample_idx").on(t.sampleId),
  }),
);

/**
 * result_entries — one per (visit_test) result, holding overall state and
 * technician/approval metadata. Parameter/single values live in result_values.
 */
export const resultEntries = sqliteTable(
  "result_entries",
  {
    id: idCol(),
    labId: text("lab_id")
      .notNull()
      .references(() => labs.id),
    visitId: text("visit_id")
      .notNull()
      .references(() => visits.id),
    visitTestId: text("visit_test_id").notNull(),
    testId: text("test_id").notNull(),
    testName: text("test_name").notNull(),
    sampleId: text("sample_id"),
    status: text("status", {
      enum: [
        "pending",
        "draft",
        "submitted",
        "correction_required",
        "approved",
        "dispatched",
      ],
    })
      .notNull()
      .default("pending"),
    hasAbnormal: integer("has_abnormal", { mode: "boolean" }).notNull().default(false),
    hasCritical: integer("has_critical", { mode: "boolean" }).notNull().default(false),
    technicianRemarks: text("technician_remarks"),
    interpretation: text("interpretation"), // pathologist comment
    correctionNote: text("correction_note"),
    // technician
    enteredBy: text("entered_by"),
    enteredByName: text("entered_by_name"),
    submittedAt: integer("submitted_at", { mode: "timestamp" }),
    // approval
    approvedBy: text("approved_by"),
    approvedByName: text("approved_by_name"),
    approvedByDesignation: text("approved_by_designation"),
    approvedAt: integer("approved_at", { mode: "timestamp" }),
    signatureAssetId: text("signature_asset_id"),
    version: integer("version").notNull().default(1),
    ...timestamps,
    ...actorColumns,
  },
  (t) => ({
    visitIdx: index("result_entries_visit_idx").on(t.visitId),
    statusIdx: index("result_entries_status_idx").on(t.status),
    // (visit_id, status) — the report/dispatch read path asks "does this visit
    // have an approved entry?" once per visit row. With only the two
    // single-column indexes above, SQLite picked the status one, which matches
    // ~94% of the table (nearly every entry ends up 'approved'), so each check
    // scanned most of result_entries. Cost was O(visits × entries); this makes
    // it a direct two-column seek.
    visitStatusIdx: index("result_entries_visit_status_idx").on(t.visitId, t.status),
    // (lab_id, status) — serves the sidebar badge and dashboard "pending /
    // awaiting approval" counts as a COVERING index, so those run on every
    // page load without touching the table itself.
    // (It does not help the dashboard's critical-alerts widget, which still
    // scans: that query filters only on lab_id, and with a single lab that
    // matches every row, so a scan is genuinely the cheapest plan.)
    labStatusIdx: index("result_entries_lab_status_idx").on(t.labId, t.status),
  }),
);

/**
 * result_values — individual values. For multi-parameter tests there is one
 * row per parameter; for single-value tests, one row with parameterId null.
 * Reference + flag are snapshotted at entry time.
 */
export const resultValues = sqliteTable(
  "result_values",
  {
    id: idCol(),
    resultEntryId: text("result_entry_id")
      .notNull()
      .references(() => resultEntries.id),
    parameterId: text("parameter_id"), // null for single-value tests
    label: text("label").notNull(),
    valueText: text("value_text"),
    valueNum: real("value_num"),
    unit: text("unit"),
    refText: text("ref_text"),
    refLow: real("ref_low"),
    refHigh: real("ref_high"),
    flag: text("flag", { enum: ["normal", "low", "high", "critical_low", "critical_high", "abnormal"] })
      .notNull()
      .default("normal"),
    remarks: text("remarks"),
    displayOrder: integer("display_order").notNull().default(0),
    ...timestamps,
  },
  (t) => ({
    entryIdx: index("result_values_entry_idx").on(t.resultEntryId),
  }),
);

/** result_versions — immutable snapshots for edit history/versioning. */
export const resultVersions = sqliteTable(
  "result_versions",
  {
    id: idCol(),
    resultEntryId: text("result_entry_id")
      .notNull()
      .references(() => resultEntries.id),
    version: integer("version").notNull(),
    snapshot: text("snapshot", { mode: "json" }).notNull(), // full values snapshot
    reason: text("reason"),
    actorId: text("actor_id"),
    actorName: text("actor_name"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => ({
    entryIdx: index("result_versions_entry_idx").on(t.resultEntryId),
  }),
);

/** result_approvals — audit of approve / send-back actions. */
export const resultApprovals = sqliteTable(
  "result_approvals",
  {
    id: idCol(),
    resultEntryId: text("result_entry_id")
      .notNull()
      .references(() => resultEntries.id),
    action: text("action", { enum: ["approved", "sent_back"] }).notNull(),
    reason: text("reason"),
    interpretation: text("interpretation"),
    actorId: text("actor_id"),
    actorName: text("actor_name"),
    actorDesignation: text("actor_designation"),
    signatureAssetId: text("signature_asset_id"),
    // Which report_signatories the approver applied in this action — the audit
    // record of the choice `visits.report_signatory_ids` currently reflects.
    signatoryIds: text("signatory_ids", { mode: "json" }).$type<string[]>(),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => ({
    entryIdx: index("result_approvals_entry_idx").on(t.resultEntryId),
  }),
);
