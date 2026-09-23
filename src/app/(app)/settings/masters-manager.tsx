"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Field } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Badge } from "@/components/ui/badge";
import { TableWrap, Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/feedback";
import {
  saveDepartment, setDepartmentActive,
  saveSampleType, setSampleTypeActive,
  saveDoctor, setDoctorActive,
} from "@/lib/actions/masters-actions";

export type MasterKind = "department" | "sampleType" | "doctor";

export interface MasterItem {
  id: string;
  name: string;
  isActive: boolean;
  billingOnly?: boolean;
  /** Departments only — whether reports print the Unit / Reference Range column. */
  showUnit?: boolean;
  showReferenceRange?: boolean;
  displayOrder?: number;
  colorHex?: string | null;
  qualification?: string | null;
  clinic?: string | null;
  phone?: string | null;
  commissionPercent?: number | null;
}

const CONFIG: Record<MasterKind, { singular: string; save: typeof saveDepartment; toggle: typeof setDepartmentActive }> = {
  department: { singular: "department", save: saveDepartment, toggle: setDepartmentActive },
  sampleType: { singular: "sample type", save: saveSampleType, toggle: setSampleTypeActive },
  doctor: { singular: "referring doctor", save: saveDoctor as never, toggle: setDoctorActive },
};

export function MastersManager({ kind, items, hint }: { kind: MasterKind; items: MasterItem[]; hint?: string }) {
  const cfg = CONFIG[kind];
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<MasterItem | null>(null);

  function openNew() { setEditing(null); setOpen(true); }
  function openEdit(it: MasterItem) { setEditing(it); setOpen(true); }

  return (
    <>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{hint}</p>
        <Button onClick={openNew}><Plus className="size-4" /> Add {cfg.singular}</Button>
      </div>

      {items.length === 0 ? (
        <EmptyState title={`No ${cfg.singular}s yet`} description={`Add your first ${cfg.singular}.`} />
      ) : (
        <TableWrap>
          <Table>
            <THead>
              <TR>
                <TH>Name</TH>
                {kind === "doctor" && <><TH>Qualification</TH><TH>Clinic</TH><TH>Phone</TH></>}
                {kind === "sampleType" && <TH>Color</TH>}
                {kind === "department" && <><TH>Order</TH><TH>Type</TH><TH>Report columns</TH></>}
                <TH>Status</TH>
                <TH className="text-right">Actions</TH>
              </TR>
            </THead>
            <TBody>
              {items.map((it) => (
                <TR key={it.id}>
                  <TD className="font-medium">{it.name}</TD>
                  {kind === "doctor" && <><TD className="text-muted-foreground">{it.qualification ?? "—"}</TD><TD className="text-muted-foreground">{it.clinic ?? "—"}</TD><TD className="text-muted-foreground tabular">{it.phone ?? "—"}</TD></>}
                  {kind === "sampleType" && <TD>{it.colorHex ? <span className="inline-flex items-center gap-1.5"><span className="size-3 rounded-full" style={{ background: it.colorHex }} />{it.colorHex}</span> : "—"}</TD>}
                  {kind === "department" && (
                    <>
                      <TD className="tabular text-muted-foreground">{it.displayOrder ?? 0}</TD>
                      <TD>{it.billingOnly ? <Badge tone="neutral">Billing only</Badge> : <Badge tone="brand">Reportable</Badge>}</TD>
                      <TD><ReportColumns item={it} /></TD>
                    </>
                  )}
                  <TD>{it.isActive ? <Badge tone="success">Active</Badge> : <Badge tone="neutral">Inactive</Badge>}</TD>
                  <TD className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <ToggleBtn kind={kind} id={it.id} active={it.isActive} />
                      <Button variant="ghost" size="icon-sm" onClick={() => openEdit(it)} aria-label="Edit"><Pencil className="size-4" /></Button>
                    </div>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </TableWrap>
      )}

      {open && <MasterForm kind={kind} initial={editing} onClose={() => setOpen(false)} />}
    </>
  );
}

/**
 * Which result columns this department's reports carry. Billing-only
 * departments never reach a report at all, so the question does not apply.
 */
function ReportColumns({ item }: { item: MasterItem }) {
  if (item.billingOnly) return <span className="text-muted-foreground">—</span>;
  const on = [
    item.showUnit !== false ? "Unit" : null,
    item.showReferenceRange !== false ? "Ref. range" : null,
  ].filter(Boolean) as string[];
  if (on.length === 2) return <span className="text-muted-foreground">Unit · Ref. range</span>;
  return (
    <span className="flex flex-wrap items-center gap-1">
      {on.map((c) => (
        <Badge key={c} tone="neutral">{c}</Badge>
      ))}
      <Badge tone="warning">{on.length === 0 ? "Both hidden" : "1 hidden"}</Badge>
    </span>
  );
}

function ToggleBtn({ kind, id, active }: { kind: MasterKind; id: string; active: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button variant="ghost" size="sm" loading={pending} onClick={() => start(async () => {
      const r = await CONFIG[kind].toggle(id, !active);
      r.ok ? toast.success(r.message ?? "") : toast.error(r.error);
      if (r.ok) router.refresh();
    })}>{active ? "Disable" : "Enable"}</Button>
  );
}

function MasterForm({ kind, initial, onClose }: { kind: MasterKind; initial: MasterItem | null; onClose: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const cfg = CONFIG[kind];
  const [form, setForm] = useState({
    name: initial?.name ?? "",
    billingOnly: initial?.billingOnly ?? false,
    showUnit: initial?.showUnit ?? true,
    showReferenceRange: initial?.showReferenceRange ?? true,
    displayOrder: initial?.displayOrder ?? 0,
    colorHex: initial?.colorHex ?? "#075323",
    qualification: initial?.qualification ?? "",
    clinic: initial?.clinic ?? "",
    phone: initial?.phone ?? "",
    commissionPercent: initial?.commissionPercent ?? 0,
  });
  const set = (k: keyof typeof form, v: string | number | boolean) => setForm((f) => ({ ...f, [k]: v }));

  function submit() {
    start(async () => {
      let res;
      if (kind === "department")
        res = await saveDepartment({
          id: initial?.id,
          name: form.name,
          billingOnly: form.billingOnly,
          displayOrder: Number(form.displayOrder) || 0,
          showUnit: form.showUnit,
          showReferenceRange: form.showReferenceRange,
        });
      else if (kind === "sampleType") res = await saveSampleType({ id: initial?.id, name: form.name, colorHex: form.colorHex });
      else res = await saveDoctor({ id: initial?.id, name: form.name, qualification: form.qualification, clinic: form.clinic, phone: form.phone, commissionPercent: Number(form.commissionPercent) });
      if (res.ok) { toast.success(res.message ?? "Saved"); onClose(); router.refresh(); }
      else toast.error(res.error);
    });
  }

  return (
    <Modal open onClose={onClose} title={`${initial ? "Edit" : "Add"} ${cfg.singular}`} size="sm"
      footer={<><Button variant="outline" onClick={onClose} disabled={pending}>Cancel</Button><Button onClick={submit} loading={pending}>Save</Button></>}>
      <div className="space-y-3">
        <Field label="Name" required><Input value={form.name} onChange={(e) => set("name", e.target.value)} autoFocus /></Field>
        {kind === "department" && (
          <Field label="Display order" hint="Lower numbers print first on reports and appear first on the result entry screen. Departments sharing a number fall back to alphabetical order.">
            <Input
              type="number"
              min={0}
              value={form.displayOrder}
              onChange={(e) => set("displayOrder", Number(e.target.value))}
            />
          </Field>
        )}
        {kind === "department" && (
          <Field label="Billing only" hint="Charged on the bill but produces no lab report — no result entry, and no report QR on a bill made up only of these. Use for Dental, Radiology, Consultation, Physiotherapy…">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.billingOnly}
                onChange={(e) => set("billingOnly", e.target.checked)}
                className="size-4 rounded border-border accent-brand-700"
              />
              This department is for billing only
            </label>
          </Field>
        )}
        {kind === "department" && !form.billingOnly && (
          <Field
            label="Columns to print on the report"
            hint="Uncheck a column that this department never fills in — it is then left out of this department’s table on the report instead of printing blank on every line. Other departments are unaffected, and any values already saved are kept."
          >
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.showUnit}
                  onChange={(e) => set("showUnit", e.target.checked)}
                  className="size-4 rounded border-border accent-brand-700"
                />
                Unit
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.showReferenceRange}
                  onChange={(e) => set("showReferenceRange", e.target.checked)}
                  className="size-4 rounded border-border accent-brand-700"
                />
                Reference range
              </label>
            </div>
          </Field>
        )}
        {kind === "sampleType" && (
          <Field label="Label color">
            <div className="flex items-center gap-2">
              <input type="color" value={form.colorHex} onChange={(e) => set("colorHex", e.target.value)} className="h-9 w-12 rounded border border-border" />
              <Input value={form.colorHex} onChange={(e) => set("colorHex", e.target.value)} className="flex-1" />
            </div>
          </Field>
        )}
        {kind === "doctor" && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Qualification"><Input value={form.qualification} onChange={(e) => set("qualification", e.target.value)} placeholder="MBBS, MD" /></Field>
              <Field label="Phone"><Input value={form.phone} onChange={(e) => set("phone", e.target.value)} /></Field>
            </div>
            <Field label="Clinic / Hospital"><Input value={form.clinic} onChange={(e) => set("clinic", e.target.value)} /></Field>
            <Field label="Commission %" hint="Optional — for referral commission reports"><Input type="number" min={0} max={100} value={form.commissionPercent} onChange={(e) => set("commissionPercent", Number(e.target.value))} /></Field>
          </>
        )}
      </div>
    </Modal>
  );
}
