import { sqliteTable, text, integer, real, index } from "drizzle-orm/sqlite-core";
import { idCol, timestamps, actorColumns } from "./_shared";
import { labs } from "./lab";
import { patients } from "./patients";

/**
 * visits — an encounter for a patient. Drives the whole workflow.
 * `code` is the human-readable visit number. A visit owns one bill.
 */
export const visits = sqliteTable(
  "visits",
  {
    id: idCol(),
    labId: text("lab_id")
      .notNull()
      .references(() => labs.id),
    code: text("code").notNull(), // V-000123
    patientId: text("patient_id")
      .notNull()
      .references(() => patients.id),
    referredBy: text("referred_by"),
    priority: text("priority", { enum: ["normal", "urgent"] })
      .notNull()
      .default("normal"),
    // Workflow status of the visit as a whole
    status: text("status", {
      enum: [
        "registered",
        "sample_pending",
        "in_progress",
        "result_pending",
        "awaiting_approval",
        "approved",
        "dispatched",
        "cancelled",
      ],
    })
      .notNull()
      .default("registered"),
    cancelledReason: text("cancelled_reason"),
    cancelledAt: integer("cancelled_at", { mode: "timestamp" }),
    cancelledBy: text("cancelled_by"),
    // report_signatories ids chosen by the approver, in the order they should
    // print (left to right). Set at approval time — see approveVisit. Null on
    // visits approved before signature selection existed; those fall back to
    // the older staff-linked rule (see src/lib/report-signatories.ts).
    reportSignatoryIds: text("report_signatory_ids", { mode: "json" }).$type<string[]>(),
    visitDate: integer("visit_date", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    ...timestamps,
    ...actorColumns,
  },
  (t) => ({
    labCodeIdx: index("visits_lab_code_idx").on(t.labId, t.code),
    patientIdx: index("visits_patient_idx").on(t.patientId),
    statusIdx: index("visits_status_idx").on(t.status),
    // (lab_id, status, updated_at) — the dispatch queue is "approved visits,
    // newest first". Without this it scanned every visit for the lab and then
    // sorted the survivors in a temp b-tree; now it seeks the status and walks
    // updated_at in order, stopping at the limit. Also serves the sidebar
    // badge and dashboard "ready to dispatch" counts.
    labStatusUpdatedIdx: index("visits_lab_status_updated_idx").on(t.labId, t.status, t.updatedAt),
    // (lab_id, visit_date) — visit lists and the dashboard's day/hour buckets
    // all filter or order on visit_date.
    labVisitDateIdx: index("visits_lab_visit_date_idx").on(t.labId, t.visitDate),
  }),
);

/**
 * visit_tests — individual ordered tests on a visit (a group expands into
 * these rows, tagged with `groupId`/`groupName` for grouping on reports).
 */
export const visitTests = sqliteTable(
  "visit_tests",
  {
    id: idCol(),
    visitId: text("visit_id")
      .notNull()
      .references(() => visits.id),
    testId: text("test_id").notNull(),
    testName: text("test_name").notNull(), // snapshot
    departmentId: text("department_id"),
    sampleTypeId: text("sample_type_id"),
    groupId: text("group_id"), // if added as part of a profile
    groupName: text("group_name"),
    price: real("price").notNull().default(0),
    // per-test workflow state
    status: text("status", {
      enum: [
        "ordered",
        "sample_collected",
        "result_draft",
        "result_submitted",
        "correction_required",
        "approved",
        "cancelled",
      ],
    })
      .notNull()
      .default("ordered"),
    ...timestamps,
  },
  (t) => ({
    visitIdx: index("visit_tests_visit_idx").on(t.visitId),
  }),
);

/**
 * bills — one per visit. Money fields are denormalized running totals kept in
 * sync by server actions. Status tracks payment state.
 */
export const bills = sqliteTable(
  "bills",
  {
    id: idCol(),
    labId: text("lab_id")
      .notNull()
      .references(() => labs.id),
    code: text("code").notNull(), // B-000123
    visitId: text("visit_id")
      .notNull()
      .references(() => visits.id),
    patientId: text("patient_id")
      .notNull()
      .references(() => patients.id),
    subtotal: real("subtotal").notNull().default(0),
    discountAmount: real("discount_amount").notNull().default(0),
    discountReason: text("discount_reason"),
    taxPercent: real("tax_percent").notNull().default(0),
    taxAmount: real("tax_amount").notNull().default(0),
    grandTotal: real("grand_total").notNull().default(0),
    paidAmount: real("paid_amount").notNull().default(0),
    dueAmount: real("due_amount").notNull().default(0),
    refundedAmount: real("refunded_amount").notNull().default(0),
    paymentStatus: text("payment_status", {
      enum: ["unpaid", "partial", "paid", "refunded", "cancelled"],
    })
      .notNull()
      .default("unpaid"),
    status: text("status", { enum: ["active", "cancelled"] })
      .notNull()
      .default("active"),
    cancelledReason: text("cancelled_reason"),
    remarks: text("remarks"),
    ...timestamps,
    ...actorColumns,
  },
  (t) => ({
    labCodeIdx: index("bills_lab_code_idx").on(t.labId, t.code),
    visitIdx: index("bills_visit_idx").on(t.visitId),
    payStatusIdx: index("bills_pay_status_idx").on(t.paymentStatus),
  }),
);

/** bill_items — line items mirroring visit tests/groups for the printed bill. */
export const billItems = sqliteTable(
  "bill_items",
  {
    id: idCol(),
    billId: text("bill_id")
      .notNull()
      .references(() => bills.id),
    visitTestId: text("visit_test_id"),
    label: text("label").notNull(),
    kind: text("kind", { enum: ["test", "group"] }).notNull().default("test"),
    qty: integer("qty").notNull().default(1),
    unitPrice: real("unit_price").notNull().default(0),
    lineTotal: real("line_total").notNull().default(0),
  },
  (t) => ({
    billIdx: index("bill_items_bill_idx").on(t.billId),
  }),
);

/**
 * payments — every money-in event against a bill. Never deleted; reversals
 * are recorded as refunds. `mode` snapshots the payment mode name.
 */
export const payments = sqliteTable(
  "payments",
  {
    id: idCol(),
    labId: text("lab_id")
      .notNull()
      .references(() => labs.id),
    code: text("code").notNull(), // receipt no, e.g. R-000123
    billId: text("bill_id")
      .notNull()
      .references(() => bills.id),
    patientId: text("patient_id").notNull(),
    amount: real("amount").notNull(),
    modeId: text("mode_id"),
    mode: text("mode").notNull().default("Cash"), // snapshot
    kind: text("kind", { enum: ["payment", "due_collection", "refund"] })
      .notNull()
      .default("payment"),
    reference: text("reference"), // txn ref / cheque no
    remarks: text("remarks"),
    receivedBy: text("received_by"),
    receivedByName: text("received_by_name"),
    paidAt: integer("paid_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    ...timestamps,
  },
  (t) => ({
    billIdx: index("payments_bill_idx").on(t.billId),
    paidAtIdx: index("payments_paid_at_idx").on(t.paidAt),
    receivedByIdx: index("payments_received_by_idx").on(t.receivedBy),
  }),
);
