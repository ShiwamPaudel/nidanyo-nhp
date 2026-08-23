# Nidanyo — Project Memory

> Context primer for new chats so you don't need to re-study the whole codebase.
> Nidanyo is a **live, production** Laboratory Information & Operations Management
> System (LIMS) for a diagnostic lab in Nepal, by Infobytes Nepal.
> **Golden rule: do not disrupt existing data or flows. Prefer additive, low-risk
> changes. New behaviour that changes existing flows must be opt-in (default off).**
>
> **This checkout is the National Health Pathology Center Pvt. Ltd. (NHP) deployment**
> (`DATABASE_URL` → `nidanyofornhp`). Nidanyo runs one database per clinic; a sibling
> checkout serves a different clinic. Nothing clinic-specific may be hardcoded — the
> lab name, logo, report/bill headers, signatories, tests, prices and reference ranges
> all come from the database and are edited by the lab admin under Settings.

Keep this file up to date whenever you make a meaningful change.

---

## Stack & conventions

- **Next.js 15** (App Router, React 19, RSC), **TypeScript**, **Tailwind**.
- **DB:** SQLite via **libSQL/Turso**, **Drizzle ORM**. Schema is split under
  `src/db/schema/*.ts` (barrel `index.ts`). Money fields are `real`; timestamps are
  epoch integers.
- **Migrations:** `npm run db:generate` (from schema) → creates `drizzle/NNNN_*.sql`
  + snapshot. Apply with `npm run db:migrate` (runs `db/migrate.ts`).
  ⚠️ `db:migrate`/`db:push` connect to `DATABASE_URL` — **could be production**. Never
  run them casually; generate the SQL and let a human apply it on deploy.
- **Seed:** `db/seed.ts` only INSERTS rows that don't exist (idempotent, no updates).
  So **seed does NOT re-sync existing roles/permissions on prod** (see RBAC note).
  ⚠️ `db/seed.ts` is the **demo/dev** seed — it plants a demo test catalogue, demo
  `*@nidanyo.local` staff and demo referring doctors. **Never run it on a live lab.**
- **New live lab:** `npm run db:migrate` then `npm run db:bootstrap`
  (`db/bootstrap-lab.ts`, `--dry` to preview). Seeds only the cross-lab reference
  data — 8 roles, 19 departments, 10 sample types, 6 payment modes, counters —
  plus the lab row, its settings and the admin user. Tests, prices, reference
  ranges, headers, logo, signatories, doctors and staff stay empty and are
  configured from Settings. Driven by `SEED_LAB_NAME` / `SEED_LAB_CODE` /
  `SEED_ADMIN_*` / `SEED_SHORT_LINK_BASE_URL` in `.env.local`. Idempotent.
- Scripts: `dev`, `build`, `typecheck` (`tsc --noEmit`), `lint`, `db:*`.
- Platform is Windows; shell is PowerShell (Bash tool also available).

## Auth & RBAC (important)

- Session: signed JWT cookie → `src/lib/auth/session.ts` (`getCurrentUser`). User's
  `permissions` come from their **role's stored `permissions` array** (a snapshot).
- Guards: `src/lib/auth/guard.ts` — `requireUser`, `requirePermission` (redirects),
  `authorize` (throws, for server actions), `hasPermission`, `hasAny`.
- Permission registry: `src/lib/rbac/permissions.ts`. Default role→perms seed:
  `src/lib/rbac/roles.ts`. `super_admin`/`lab_admin` are seeded with `ALL_PERMISSIONS`.
- **Gotcha:** adding a NEW permission to `permissions.ts` does **not** grant it to
  existing prod roles (their arrays are snapshots; seed won't update them, and the
  roles editor blocks editing admin roles). So for an "admin-only" gate on live,
  **key off an existing admin-held permission** — `PERMISSIONS.SETTINGS_MANAGE` is the
  reliable "is admin" marker (only `super_admin`/`lab_admin` hold it; reception,
  accounts, lab_technician, dispatch, pathologist, sample_collection do not).

## Domain model (high level)

- `patients` → `visits` → one `bills` per visit → `payments` (money-in events; never
  deleted, refunds are rows). `visit_tests` are the ordered tests; `bill_items` mirror
  them. Referral is `visits.referredBy` (per visit) with fallback `patients.referredBy`.
- Workflow: visit status registered → sample → in_progress → result_pending →
  awaiting_approval → approved → dispatched. Results: `result_entries` +
  `result_values`, approved entries drive the report.
- Reports: `report_links` (public tokenized link, `isActive`, view counts),
  `report_dispatches`, `report_signatories` (admin-managed signature blocks at report end).
- **Which signatures print** — `src/lib/report-signatories.ts` (`pickReportSignatories`),
  called once inside `getReportData`, so the in-lab print and the patient's public
  link can never sign differently. A `report_signatories` row with `user_id` set is
  **staff-specific**: it prints only when `visits.createdBy` matches, and is emitted
  FIRST so it lands on the left. Rows with `user_id` null are **lab-wide** (the
  pathologist) and print on every report, to the right. If a lab links nobody, every
  active block prints — the pre-existing behaviour. No match (reception registered the
  visit, or a legacy null `createdBy`) → no staff signature rather than a wrong one.

## Key areas / file map

- **Finance queries:** `src/lib/queries/finance.ts` — `listTransactions`,
  `getEodSummary`, `getTestRevenue`, `getOutstandingDuesTotal`. Date ranges are
  resolved to **lab-local day bounds** (`src/lib/datetime.ts`), not server UTC.
- **Transactions UI:** `src/app/(app)/transactions/page.tsx`.
- **Financial Reports UI:** `src/app/(app)/financial-reports/page.tsx` (aggregate cards
  only, no per-row transaction table). Its Export PDF/Excel buttons reuse the
  transactions export.
- **Transactions exports (shared by both screens):** PDF =
  `src/app/print/transactions/page.tsx`; CSV = `src/app/api/export/transactions/route.ts`.
- **Report rendering:** `src/components/print/report-sheet.tsx` (`ReportSheet` = table
  layout that repeats letterhead via thead/tfoot; `ReportBody` = shared content).
  Letterhead: `src/components/print/letterhead.tsx`.
- **Report print page:** `src/app/print/report/[visitId]/page.tsx` (server: auth, data,
  QR, **due-print gate**) → `report-print-view.tsx` (client: **paged.js** pagination
  with running header/footer + "Page X of Y"; falls back to `ReportSheet` if paged.js
  isn't ready/fails). Print CSS in `src/app/globals.css` (`@media print`, `@page`).
- **Lab settings:** schema `src/db/schema/lab.ts` (`labSettings`); read via
  `src/lib/queries/lab.ts` `getLab`; edit via `src/app/(app)/settings/lab-profile/`
  (`page.tsx` builds `initial`, `profile-form.tsx` client form) → server action
  `updateLabProfile` in `src/lib/actions/settings-actions.ts`; validator
  `src/lib/validators/settings.ts` (`labProfileSchema`). **When adding a lab setting you
  must touch all five: schema, validator, action `.set()`, page `initial`, form field.**
- **Reports list:** `src/app/(app)/reports/page.tsx`. **Dispatch:**
  `src/app/(app)/dispatch/page.tsx` + `dispatch-actions.tsx` (dispatch already hides the
  print link until the report link is active/paid).

## Change log (most recent first)

### 2026-08-05 — Public link state is DERIVED, not read from `is_active`
- **The bug.** Progressive release (below) only fired on an approval or a payment
  recompute. A visit that was already approved-and-paid before that shipped — e.g.
  **V-000522**, 2 of 3 tests approved, dues cleared — had no event left to fire, so its
  `report_links.is_active` stayed 0 and the QR/link answered *"Your report is being
  processed"* forever. Every visit in that state was stranded.
- **`resolvePublicReport` (`src/lib/queries/public-report.ts`)** now derives the decision
  from the data — **≥1 approved test + due cleared** — instead of trusting the stored flag,
  and flips `is_active` to catch up (**silently — a page view never sends an SMS**;
  notification stays with the approval flow). `is_active` still short-circuits to "ready"
  when set, so nothing that was working stops working.
- **Staff screens derive the same rule** so they don't say "Inactive" while the patient's
  QR already works: `listReports` (`queries/dispatch.ts`) adds a `hasApprovedTest` exists-
  subquery and ORs it into `linkActive` (guarded on due ≤ 0, bill `active`, visit not
  cancelled); the visit-detail Report card uses the same `linkLive` expression.
- **Still blocked, verified:** outstanding due → "payment pending" and the flag is *not*
  flipped; nothing approved → "processing"; cancelled bill → never released (its message
  stays the pre-existing "payment pending" — a cancelled bill is never "due cleared").
- **Known consequence of deriving:** admin **reopen** deactivates the link, but if the
  visit still has other approved tests and no due, the next view re-derives it as live and
  shows those remaining tests (the reopened one is gone from the report, since it is no
  longer approved). Consistent with progressive release; call it out if the lab expects
  reopen to take the whole report offline.

### 2026-08-05 — Progressive report release (QR shows the approved tests already)
- **The ask.** Some tests finish in minutes, others take days. A patient scanning the
  QR on their bill saw "Your report is being processed" until the *last* test was
  approved. Now the link shows whatever is already approved and fills in later.
- **`src/lib/report-engine.ts`**
  - New **`getApprovalProgress(visitId)`** → `{ total, approved, pending, pendingTests,
    hasApproved, isComplete }`. Counts the visit's reportable result entries (billing-only
    departments still excluded, `dispatched` counts as done). `isVisitFullyApproved` is now
    a one-line wrapper over `isComplete` (single source of truth). Side effect of counting
    dispatched as done: an already-handed-over visit whose due is cleared *afterwards* now
    activates its link (and sends the SMS) — it used to stay dark forever.
  - **`activateReportLinkIfReady`** releases the link when **≥1 test is approved AND the
    due is cleared** (was: *all* tests approved). Due-clearing rule is unchanged.
    `reportLinks.activatedAt` is no longer written on that first release — it now marks
    the **final** release and doubles as the "report-ready message already sent" flag, so
    the visit→`approved` status update and the SMS/email still fire **once, only when the
    last test is approved**. No schema change.
- **`approval-actions.ts`** — `approveVisit` calls `activateReportLinkIfReady` on *every*
  approval (it self-gates), not only when nothing remains; visit status still flips only
  when nothing remains. Toast for a partial release: "Approved — these tests are live on
  the patient's report link (N still pending)". `reopenApprovedResults` also clears
  `activatedAt` alongside `isActive:false`, so a corrected report notifies the patient
  again on re-approval (the behaviour before this change).
- **`public-report.ts`** — `ready` state now carries `progress`; the inactive-link
  explanation uses `hasApproved && !cleared` → "payment pending" (so a partly-done visit
  with a due says *payment*, not *processing*).
- **`/r/[token]`** — amber on-screen banner "Your report is partly ready — X of Y tests
  done. Still in the laboratory: <names>…" plus a printed **"Interim report"** note above
  the end-of-report line (new
  optional `pendingNote` prop on `ReportSheet`/`ReportBody`, passed **only** by the public
  page — in-lab prints are byte-identical).
- **Visit detail** "Report" card reads "Shared — X of Y tests visible" while partial.
  **Bill print** paid-status line now reads "each test appears on this link as soon as it
  is approved".
- **Bug fixed along the way (needed for the above):** `getReportData` filtered entries on
  `status = 'approved'` only, but `markDispatched` flips approved entries to
  `'dispatched'` — so once a report was marked dispatched, `/print/report/[visitId]`
  404'd and `/r/[token]` fell back to "being processed". It now accepts
  `['approved','dispatched']`.
- No migration. Reports/Dispatch queries, due-print restriction, and the print picker are
  untouched (partially-approved visits already surfaced on Reports via `includePartial`;
  they now show their link as "Active", which is the point).

### 2026-07-31 — Sample Collection "Tests" column shows the billed profile
- **The ask.** A patient billed for CBC showed up on Sample Collection as a wall of
  analyte chips (DC, Neutrophils, Lymphocytes, Hemoglobin…). The collector cares what the
  tube is *for*, so a profile should read as one chip: **CBC**.
- **`listSamples` (`src/lib/queries/samples.ts`) — the `testNames` subquery only.** It now
  selects `distinct coalesce(visit_tests.group_name, visit_tests.test_name) as label`
  and orders/group_concats on `label`, instead of concatenating raw `test_name`s. Tests
  ordered as part of a profile collapse into their single `group_name`; standalone tests
  (no `group_id`, so `group_name` is null) still print their own name. Same
  `coalesce(group, test)` convention `getTopTests` (`dashboard.ts`) and the report's
  profile sections already use, reading the `visit_tests.group_name` snapshot — no schema
  change, no new join, no migration.
- **Deliberately unchanged:** the `sample_type_id` + `status <> 'cancelled'` filters (a
  cancelled analyte still never shows, and a profile spanning two tubes still names itself
  on both — correct, each tube is genuinely drawn for part of it); `testCount`, which
  still counts **individual tests**, so a row can read "CBC" over "5 tests" on purpose;
  the ordered-subquery trick (SQLite's `group_concat` has no ordering of its own); and
  the page's chip rendering, which still splits on `", "`.
- **Files:** `src/lib/queries/samples.ts` (query), `src/app/(app)/sample-collection/page.tsx`
  (comment only — no JSX change).
- **Verified:** `npx tsc --noEmit` and `npm run lint` clean; SQL exercised against a
  throwaway in-memory SQLite table (never the configured DATABASE_URL — `local.db` is
  empty here): a visit with 3 CBC analytes + a cancelled 4th + standalone ESR on EDTA and
  LFT + Sugar (F) on serum renders `CBC, ESR` (n=4) and `LFT, Sugar (F)` (n=2).

### 2026-07-26 — Transactions export: dues cleared later read as settled
- **The problem.** `getSalesInRange` computed `due = grandTotal − collected-in-range`, so
  re-exporting the day a bill was raised kept showing the old due even after the patient
  had cleared it days later. The export is meant to be re-printable at any time and must
  reflect reality *now*.
- **`getSalesInRange` (`src/lib/queries/finance.ts`) now returns three separate figures
  per bill**, so the day's cash is not disturbed while the due reads true:
  - `collected` — received **within the period** (unchanged; the day's own takings, so
    end-of-day cash reconciliation for that date never moves).
  - `settledLater` — **new**; received against the same bill **after** the period, via a
    second aggregated subquery (`paid_after_range`, `payments.paidAt > rangeEnd`), mirroring
    the existing `paid_in_range` one. A bill raised in the range can have no payments before
    it, so in-range + after-range is everything ever collected on it.
  - `due` — **now the live outstanding** (`bills.dueAmount`, kept current by `recomputeBill`),
    clamped at ≥ 0, instead of a period-derived figure. Matches how the Financial Reports
    "Due generated" card and the Dues screen already read dues, so the screens now agree.
  - `totals` gained `settledLater` alongside the existing keys. Barring refunds,
    Collected + Settled later + Due = Net sales on every row.
- **Both exports show the new column** (the only layout change): PDF
  (`src/app/print/transactions/page.tsx`) — "Collected · Settled Later · Due (Now)", tfoot
  colSpans bumped to 11 columns, plus a one-line caption under the section heading
  explaining the three; CSV (`src/app/api/export/transactions/route.ts`) — same three
  headers/values/totals. A row with nothing settled later prints "—" in the PDF.
- **Deliberately unchanged:** the money still counts on the day it actually arrived — the
  "Dues Collected Today (Previous Days' Bills)" table (payment-date driven, from
  `listTransactions`) is untouched, so nothing is double-counted across the two reports.
  `getEodSummary`, the summary strip, Tests Performed, the Transactions screen (uses only
  `totals.gross`), and the Dues screen are all untouched.
- **Verified** against a throwaway copy of `local.db` (never the configured DATABASE_URL):
  bill of 1000 raised 20 Jul, 600 paid that day, 400 cleared 25 Jul → the 20 Jul export
  reads Collected 600 · Settled later 400 · **Due 0**, the bill is not re-listed as a sale
  on the 25th, and the 400 still shows in that day's previous-days'-dues total. Regression
  case (400 never paid) still reads Due 400.
- **Refund caveat:** `bills.dueAmount` is `grandTotal − paid` and does not add refunds back,
  while `collected` nets them off — so on a bill refunded after the period, Collected +
  Settled later + Due can fall short of Net sales by the refunded amount. The refund itself
  is still reported in the summary's Refunds line and the transactions table. Pre-existing
  behaviour (the old Due column overstated by the same amount); left alone.

### 2026-07-25 — Profile names on the report + profile-level print picker + gross sales
1. **Report prints the profile/panel name.** `getReportData` now returns `groupName` per
   entry (from the `visit_tests.group_name` snapshot) and `ReportBody`
   (`report-sheet.tsx`) splits each department's entries into **profile sections** via a
   new `profileSections()` helper: a group's tests print under one heading (e.g.
   "Complete Blood Count (CBC)") in brand colour, with its tests indented one level under
   it (`ValueRow`'s `indent` went from boolean → level `0 | 1 | 2`, so a parameter of a
   test inside a profile indents twice). Standalone tests are unchanged (no heading, same
   indentation as before). Applies everywhere `ReportBody`/`ReportSheet` render: print
   view, table fallback, and the public `/r/[token]` report. Presentation only — the
   department grouping, ordering (`report-order.ts`) and per-department notes are untouched.
2. **Print picker offers a profile as one item.** `ReportTestOption` gained
   `groupId`/`groupName` (`listReportTestOptions`, which also now sorts department →
   group → test name so a profile's tests stay together). `ReportTestPicker` rolls the
   flat list up with a new `buildItems()`: **one row per profile** (label = group name,
   sub-line "Department · N tests") instead of its member tests, standalone tests as
   before. Ticking a profile selects/deselects all of its printable entries at once;
   the `?entries=` URL is still a list of entry ids, so the printer is unchanged. Status
   chip for a profile: the common status when all members agree, else "n of m approved"
   (warning) or "In progress". **The reopen-results modal reuses the same query but still
   lists individual tests — corrections are per test — and is unaffected.**
3. **Transactions headline card is now "Gross sales (range)"** — was "Net collected
   (range)". Value comes from `getSalesInRange(...).totals.gross` (sum of bill subtotals
   for bills *raised* in the range, matching the "Gross Sales" column already used by the
   transactions PDF/CSV), not from payments collected. The three page queries now run in
   one `Promise.all`. The Transactions count card, the table, and the PDF/Excel exports
   are unchanged.

### 2026-07-18 — Admin reopen of approved results + Enter-to-advance
- **Reopen approved results (admin only).** `reopenApprovedResults({visitId, entryIds, reason})`
  in `approval-actions.ts` sends already-approved/dispatched tests back to results entry:
  status → `correction_required` (reason as correction note), visit → `result_pending`,
  report link deactivated (reactivates via normal re-approval). Logged as a `sent_back`
  approval event (reused existing enum — no migration). Gated on `SETTINGS_MANAGE` (admin).
  UI: `ReopenResultsButton` in `visits/[id]/visit-actions.tsx` (reuses `getVisitReportTests`
  to list approved tests + checkboxes + reason), shown in the visit-detail header only when
  `isAdmin && hasApprovedTests && !cancelled`.
- **Enter advances to next field** in results entry (`result-entry-form.tsx`): container-level
  `onKeyDown` moves focus to the next enabled input/select (fires only from text inputs, selects
  the next field's text). Tab still works.

### 2026-07-18 — Partial submit (submit only the ready tests)
- Results entry submit is no longer all-or-nothing. `saveResults` now sends **only the
  tests that have a value** for approval (`submitThis = mode==="submit" && anyValue`); empty
  tests are kept as **draft** so a technician can submit the ready tests now and finish the
  rest later. Returns `{ submitted, drafted }` and a message like "2 tests sent for approval
  · 3 kept as draft".
- Client guard changed from "every test must have a value" → **"at least one test filled"**.
  A partial submit keeps you on the visit (`router.push` only when `drafted === 0`).
- Works because `listApprovalQueue` keys on `resultEntries.status === "submitted"` (not visit
  status), so a partially-submitted visit still reaches the pathologist; approving those makes
  it a partial-approved visit, which the Reports page (`includePartial`) + print picker handle.
  Visit status stays `result_pending` until all tests are submitted (existing `remaining` check).

### 2026-07-18 — Per-department report notes + partial-print (select tests)
- **Report notes now print per department.** `ReportBody` (`report-sheet.tsx`) renders
  each test's "Report note / description" right after that department's table (before the
  next department), instead of pooling them all above the end-of-report line.
- **Print selected tests (partial report).** A visit's completed tests can be printed
  while others are still in progress:
  - `getReportData(labId, visitId, onlyEntryIds?)` takes an optional approved-entry subset.
  - `/print/report/[visitId]?entries=id1,id2` → prints only those approved entries (omit → full).
  - New `listReportTestOptions()` query + `getVisitReportTests()` action (`report-actions.ts`)
    list a visit's tests with status for the picker.
  - `ReportTestPicker` (client, in `reports/`) — a ListChecks icon on each Reports row opens
    a modal of the visit's tests with checkboxes + `StatusChip`; only approved/dispatched are
    selectable, drafts shown disabled. "Print selected" opens the `?entries=` URL.
  - `listReports(..., { includePartial: true })` now also surfaces visits with ≥1 approved
    test (not just fully-approved) **on the Reports page only** — Dispatch is unchanged.
    This is the one behavioral change: partially-completed visits now appear in Reports so
    their done tests can be handed over; their `StatusChip` shows the real (e.g. "Result
    pending") state and the report link stays inactive until fully approved + paid.
  - Due-print restriction still applies (picker/printer hidden, Lock shown) when enabled.

### 2026-07-17 — Results entry: remove technician remarks, dept headers
- Removed the **"Technician remarks (optional)" textarea** and its `setRemarks` handler
  from `src/app/(app)/results/[visitId]/result-entry-form.tsx` (technicians don't add
  remarks). The `technicianRemarks` value is still round-tripped through the save payload
  unchanged, so `saveResults` never wipes an existing stored remark and none can be added.
  The DB column and server action were left intact (non-destructive).
- Results entry was **already grouped by department** (server sorts via
  `compareEntries`, form renders a per-department header) — bumped the header style to
  match the report (`text-[13px] font-extrabold`).

### 2026-07-17 — Report notes moved to the bottom
- A test's **"Report note / description"** (`tests.description` → `note` on `ReportEntry`)
  no longer prints inline under the test. All such notes are now collected into one block
  at the very bottom of the report, **just above the "End of report" line**, each prefixed
  with its test name and separated by a blank-line gap (`mt-3`) when there's more than one.
  `tests.method` ("Method: …") **stays inline** under the test — only the note moved.
  Change is entirely in `src/components/print/report-sheet.tsx` (`ReportBody` collects
  `testNotes`; `ValueRow` lost its `note` prop), so it applies to the print view, the
  table fallback, and the public `/r/[token]` report (all render `ReportBody`/`ReportSheet`).

### 2026-07-17 — Four production improvements
1. **Referral tracking in finance reports.** `listTransactions` now joins `visits` and
   returns `referredBy = visit.referredBy ?? patient.referredBy ?? null`. Added a
   **"Referred by"** column (shows `Walk-in` when null) to: Transactions screen table,
   Transactions PDF (`print/transactions`), and CSV export. Financial Reports screen has
   no per-row table, but its Export PDF/Excel reuse these, so the column appears there too.
   *(If a "Collection by referrer" breakdown card is wanted directly on the Financial
   Reports screen, that's a further additive step — not done, was scoped to "column for now".)*
2. **Report department heading** (`report-sheet.tsx`) enlarged: `text-[11px] font-bold`
   → `text-[13px] font-extrabold`.
3. **Continuation-page top margin.** In `report-print-view.tsx` paged.js CSS, 2nd page
   onward gets **+8mm** top margin **only when the header band is OFF** (pre-printed
   letter pad); page 1 keeps its margin via `@page:first`. Header-ON layouts unchanged.
4. **Admin-configurable due-print restriction.** New `labSettings.restrictDuePrint`
   boolean (**default false** — preserves existing behaviour until an admin opts in;
   migration `drizzle/0008_cultured_tony_stark.sql`). When ON, a report whose bill has
   `dueAmount > 0` can only be printed by an admin (`hasPermission(user, SETTINGS_MANAGE)`).
   Enforced hard in `print/report/[visitId]/page.tsx` (shows a "Payment due — printing
   blocked" notice to non-admins), covering all entry points. Soft-gated on the Reports
   list (lock icon instead of print button). Toggle lives in Lab Profile → "Report & link
   settings". **Deploy step: run `npm run db:migrate` (migration 0008).**

### 2026-08-17 — Read-path performance + SMS/Email put dormant
Performance refactor only; no business logic, statuses, billing or auth behaviour changed.

1. **Indexes (migration `drizzle/0009_right_violations.sql`).** The report/dispatch read
   path ran `exists (… re.visit_id = v.id and re.status = 'approved')` per visit row, and
   SQLite served it with `result_entries_status_idx` — which matches ~94% of the table, so
   each check scanned most of `result_entries` (cost was O(visits × entries)). Added
   `result_entries(visit_id, status)`; the plan is now a **covering** seek
   `(visit_id=? AND status=?)`. Also added `result_entries(lab_id, status)` (covering, for
   the sidebar badge / dashboard counts), `visits(lab_id, status, updated_at)` (dispatch
   queue — index seek, temp-b-tree sort gone), `visits(lab_id, visit_date)` (billing list,
   date-bounded reports, peak hours), `patients(lab_id, is_active, created_at)` (patient
   list — sort gone). Dropped `report_links_token_idx`, a duplicate of the index the
   `token` unique constraint already creates.
   ⚠️ **Root cause worth remembering: production had NO `sqlite_stat1` — `ANALYZE` had
   never been run**, so the planner was working from heuristics. Migration 0009 therefore
   ends with `ANALYZE;`. Re-run `ANALYZE` after any future bulk import.
   **Deploy step: apply migration 0009.**

2. **SMS and Email are now dormant** (`src/lib/messaging.ts`). The clinic uses neither.
   The switch is the *existing* `SMS_PROVIDER` / `EMAIL_PROVIDER` env vars — a channel is
   live only when it names a real provider; unset/`mock`/`off`/`none`/`disabled` = dormant.
   No new config system. `sendSms`/`sendEmail` return early: **no provider call and no
   `sms_logs` / `email_logs` row**. `trySendReportReadySms` bails before its four lookups.
   Dispatch UI hides the SMS resend button and the SMS/Email dispatch channels, and
   `recordDispatch` rejects those channels defensively. Settings → SMS/Email keep their
   history tables (read-only) and now say the channel is off; the test-send widgets are
   hidden while dormant. **Preserved: both tables, all historical rows, `patients.email`,
   `patients.phone`, both adapters with their Sparrow/Twilio/Resend/SendGrid branches, the
   `sms.send` permission, and the `report_dispatches.channel` enum.** To re-enable, set the
   provider env var — no code change.

3. **`listReports` (`src/lib/queries/dispatch.ts`)** lost the correlated `sms_logs` count
   (SMS is dormant) and the correlated `report_dispatches` count (**it was never rendered
   anywhere**). The `hasApprovedTest` EXISTS stays — it drives `linkActive`, and its
   `('approved','dispatched')` set is deliberately wider than the `includePartial` branch's
   `'approved'`; both were left exactly as they were. Now returns `{ rows, hasMore }`
   (fetches limit+1) so a truncated list can no longer look complete.

4. **Round trips.** `getCurrentUser` was 4 sequential queries (session → user → role →
   lab_settings); all are PK lookups off the session row, so it is now **one join**
   (`innerJoin users`, `leftJoin roles/labSettings` — left joins preserve the old
   fallbacks). **212 ms → 52 ms.** `getLab`'s two queries became one `db.batch`:
   **97 ms → 51 ms.** Together ~206 ms off *every* page. Session/permission data is still
   read fresh per request — deliberately not cached.

5. **Dispatch bounding.** The "Ready" tab is a live work queue (29 approved visits were
   already older than 30 days), so it is **deliberately not date-defaulted** — hiding
   pending work would be worse than the scan. Instead the new
   `visits(lab_id, status, updated_at)` index makes it a seek. The "Dispatched"/"All" tabs
   now default to today and carry the same `DateRangeFilter` as Reports; a search still
   spans all dates. Both Reports and Dispatch show a "showing the first 200" notice.

**Considered and deliberately NOT done:** `sms_logs(visit_id, status)` (the query it would
optimise is gone); `visits(lab_id, updated_at)` (`updated_at` changes on every visit write
and the status composite already covers the hot path); UNIQUE on `bills.visit_id` /
`report_links.visit_id` (0 duplicates and single insert paths confirmed, but it is an
integrity change with write-rejection risk, not a performance one — worth doing separately);
FTS5 patient search (search measures at the ~48 ms network floor); keyset pagination
(offset page 100 costs 6 ms more than page 1).
