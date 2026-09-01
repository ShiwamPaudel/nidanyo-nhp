"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Beaker } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea, Field } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Badge } from "@/components/ui/badge";
import { saveTest, setTestActive, loadTestForEdit } from "@/lib/actions/catalog-actions";
import type { TestInput } from "@/lib/validators/catalog";

type Option = { id: string; name: string };
type Param = NonNullable<TestInput["parameters"]>[number];

const blank = (): TestInput & { id?: string } => ({
  name: "",
  shortCode: "",
  departmentId: null,
  sampleTypeId: null,
  price: 0,
  method: null,
  unit: null,
  description: null,
  resultType: "numeric",
  selectOptions: null,
  refLow: null,
  refHigh: null,
  refRangeText: null,
  criticalLow: null,
  criticalHigh: null,
  tatHours: 24,
  parameters: [],
});

export function NewTestButton({ departments, sampleTypes }: { departments: Option[]; sampleTypes: Option[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}><Plus className="size-4" /> Add test</Button>
      {open && <TestFormModal departments={departments} sampleTypes={sampleTypes} initial={blank()} onClose={() => setOpen(false)} />}
    </>
  );
}

export function EditTestButton({ testId, departments, sampleTypes }: { testId: string; departments: Option[]; sampleTypes: Option[] }) {
  const [open, setOpen] = useState(false);
  const [initial, setInitial] = useState<(TestInput & { id?: string }) | null>(null);
  const [loading, setLoading] = useState(false);

  async function openEdit() {
    setLoading(true);
    const res = await loadTestForEdit(testId);
    setLoading(false);
    if (res.ok) {
      setInitial(res.data);
      setOpen(true);
    } else toast.error(res.error);
  }

  return (
    <>
      <Button variant="ghost" size="icon-sm" onClick={openEdit} loading={loading} aria-label="Edit"><Pencil className="size-4" /></Button>
      {open && initial && <TestFormModal departments={departments} sampleTypes={sampleTypes} initial={initial} onClose={() => setOpen(false)} />}
    </>
  );
}

export function ToggleTestButton({ testId, active }: { testId: string; active: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => start(async () => { const r = await setTestActive(testId, !active); r.ok ? toast.success(r.message ?? "") : toast.error(r.error); if (r.ok) router.refresh(); })}
      loading={pending}
    >
      {active ? "Deactivate" : "Activate"}
    </Button>
  );
}

/** Dropdown choices are edited as one comma-separated line. */
const optionsToText = (o: string[] | null | undefined) => (o ?? []).join(", ");
const textToOptions = (t: string) => {
  const parts = t.split(",").map((x) => x.trim()).filter(Boolean);
  return parts.length ? parts : null;
};

/**
 * Numeric bounds are meaningless on a text / dropdown / positive-negative
 * result, and dropdown choices are meaningless on anything else. Clearing them
 * on switch keeps a parameter from carrying settings its type cannot use — and
 * stops a stale "5 – 10" from printing as the reference range of a colour.
 */
function paramTypePatch(next: Param["resultType"]): Partial<Param> {
  if (next === "numeric") return { resultType: next, selectOptions: null };
  const cleared = { refLow: null, refHigh: null, criticalLow: null, criticalHigh: null };
  // Leave existing choices alone when staying on / moving to a dropdown.
  return next === "select"
    ? { resultType: next, ...cleared }
    : { resultType: next, selectOptions: null, ...cleared };
}

function TestFormModal({ departments, sampleTypes, initial, onClose }: { departments: Option[]; sampleTypes: Option[]; initial: TestInput & { id?: string }; onClose: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [form, setForm] = useState<TestInput & { id?: string }>(initial);
  const set = <K extends keyof TestInput>(k: K, v: (TestInput & { id?: string })[K]) => setForm((f) => ({ ...f, [k]: v }));
  const multi = (form.parameters?.length ?? 0) > 0;

  function addParam() {
    set("parameters", [...(form.parameters ?? []), { name: "", unit: null, resultType: "numeric", selectOptions: null, refLow: null, refHigh: null, refRangeText: null, criticalLow: null, criticalHigh: null }] as Param[]);
  }
  function updateParam(i: number, patch: Partial<Param>) {
    const next = [...(form.parameters ?? [])];
    next[i] = { ...next[i], ...patch };
    set("parameters", next as Param[]);
  }
  function removeParam(i: number) {
    set("parameters", (form.parameters ?? []).filter((_, idx) => idx !== i) as Param[]);
  }

  function submit() {
    start(async () => {
      const res = await saveTest(form);
      if (res.ok) {
        toast.success(res.message ?? "Saved");
        onClose();
        router.refresh();
      } else toast.error(res.error);
    });
  }

  const num = (v: number | null | undefined) => (v == null ? "" : v);

  // Auto-derived "N – M" range string from low/high (mirrors report rendering).
  const autoRange = (low: number | null | undefined, high: number | null | undefined) => {
    if (low != null && high != null) return `${low} – ${high}`;
    if (low != null) return `> ${low}`;
    if (high != null) return `< ${high}`;
    return "";
  };

  // Update ref low/high AND auto-fill the display range — unless the user has
  // manually customised the range (i.e. it no longer matches the auto value).
  function setRefBound(field: "refLow" | "refHigh", val: number | null) {
    setForm((f) => {
      const keepAuto = !f.refRangeText || f.refRangeText === autoRange(f.refLow, f.refHigh);
      const nextLow = field === "refLow" ? val : f.refLow ?? null;
      const nextHigh = field === "refHigh" ? val : f.refHigh ?? null;
      return { ...f, [field]: val, refRangeText: keepAuto ? autoRange(nextLow, nextHigh) || null : f.refRangeText };
    });
  }
  function setParamRefBound(i: number, field: "refLow" | "refHigh", val: number | null) {
    const p = form.parameters![i];
    const keepAuto = !p.refRangeText || p.refRangeText === autoRange(p.refLow, p.refHigh);
    const nextLow = field === "refLow" ? val : p.refLow ?? null;
    const nextHigh = field === "refHigh" ? val : p.refHigh ?? null;
    const patch: Partial<Param> = { [field]: val };
    if (keepAuto) patch.refRangeText = autoRange(nextLow, nextHigh) || null;
    updateParam(i, patch);
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={form.id ? "Edit test" : "Add test"}
      description="Define pricing, reference ranges, and parameters."
      size="lg"
      footer={<><Button variant="outline" onClick={onClose} disabled={pending}>Cancel</Button><Button onClick={submit} loading={pending}>Save test</Button></>}
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Test name" required><Input value={form.name} onChange={(e) => set("name", e.target.value)} autoFocus /></Field>
          <Field label="Short code" required><Input value={form.shortCode} onChange={(e) => set("shortCode", e.target.value.toUpperCase())} /></Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Department"><Select value={form.departmentId ?? ""} onChange={(e) => set("departmentId", e.target.value || null)}><option value="">—</option>{departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></Field>
          <Field label="Sample type"><Select value={form.sampleTypeId ?? ""} onChange={(e) => set("sampleTypeId", e.target.value || null)}><option value="">—</option>{sampleTypes.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
          <Field label="Price" required><Input type="number" min={0} value={form.price} onChange={(e) => set("price", Number(e.target.value))} /></Field>
        </div>

        <Field label="Method (optional)"><Input value={form.method ?? ""} onChange={(e) => set("method", e.target.value || null)} placeholder="e.g. Flow cytometry" /></Field>

        <Field label="Report note / description" hint="Printed under this test on the report (e.g. instrument & methodology statement)">
          <Textarea value={form.description ?? ""} onChange={(e) => set("description", e.target.value || null)} placeholder="e.g. This test is performed on an advanced hematology analyzer with ScatterFlow technology." className="min-h-[60px]" />
        </Field>

        {!multi && (
          <div className="rounded-lg border border-border bg-surface p-3">
            <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Single-value reference (used when no parameters added)</p>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Result type"><Select value={form.resultType} onChange={(e) => set("resultType", e.target.value as TestInput["resultType"])}><option value="numeric">Numeric</option><option value="text">Text</option><option value="select">Dropdown</option><option value="pos_neg">Positive/Negative</option></Select></Field>
              {form.resultType === "select" && (
                <Field label="Choices" hint="Separate with commas — this is the dropdown the technician picks from">
                  <Input value={optionsToText(form.selectOptions)} onChange={(e) => set("selectOptions", textToOptions(e.target.value))} placeholder="e.g. Reactive, Non-reactive" />
                </Field>
              )}
              <Field label="Unit"><Input value={form.unit ?? ""} onChange={(e) => set("unit", e.target.value || null)} /></Field>
              <Field label="Critical high"><Input type="number" value={num(form.criticalHigh)} onChange={(e) => set("criticalHigh", e.target.value === "" ? null : Number(e.target.value))} /></Field>
              <Field label="Ref low"><Input type="number" value={num(form.refLow)} onChange={(e) => setRefBound("refLow", e.target.value === "" ? null : Number(e.target.value))} /></Field>
              <Field label="Ref high"><Input type="number" value={num(form.refHigh)} onChange={(e) => setRefBound("refHigh", e.target.value === "" ? null : Number(e.target.value))} /></Field>
              <Field label="Display reference range" hint="Shown on reports. Auto-filled from ref low/high — edit to override. Press Enter for multiple lines (e.g. age/sex bands)."><Textarea rows={2} value={form.refRangeText ?? ""} onChange={(e) => set("refRangeText", e.target.value || null)} placeholder={"e.g.\nMale: 40 – 80\nFemale: 35 – 70"} className="min-h-[38px] resize-y" /></Field>
            </div>
          </div>
        )}

        {/* Parameters */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-semibold">Parameters {multi && <Badge tone="info" className="ml-1">Multi-parameter</Badge>}</p>
            <Button size="sm" variant="subtle" onClick={addParam}><Plus className="size-4" /> Add parameter</Button>
          </div>
          {multi ? (
            <div className="space-y-2">
              {form.parameters!.map((p, i) => (
                // Every row is labelled, because rows no longer share a layout:
                // a numeric parameter shows ranges, a dropdown shows its choices.
                <div key={i} className="grid grid-cols-12 items-end gap-2 rounded-lg border border-border p-2">
                  <div className="col-span-12 sm:col-span-3"><Field label="Name"><Input value={p.name} onChange={(e) => updateParam(i, { name: e.target.value })} placeholder="e.g. Hemoglobin" className="h-9" /></Field></div>
                  <div className="col-span-6 sm:col-span-2">
                    <Field label="Result type">
                      <Select value={p.resultType} onChange={(e) => updateParam(i, paramTypePatch(e.target.value as Param["resultType"]))} className="h-9">
                        <option value="numeric">Numeric</option>
                        <option value="text">Text</option>
                        <option value="select">Dropdown</option>
                        <option value="pos_neg">Positive/Negative</option>
                      </Select>
                    </Field>
                  </div>

                  {p.resultType === "numeric" && (
                    <>
                      <div className="col-span-6 sm:col-span-1"><Field label="Unit"><Input value={p.unit ?? ""} onChange={(e) => updateParam(i, { unit: e.target.value || null })} className="h-9" /></Field></div>
                      <div className="col-span-4 sm:col-span-1"><Field label="Low"><Input type="number" value={num(p.refLow)} onChange={(e) => setParamRefBound(i, "refLow", e.target.value === "" ? null : Number(e.target.value))} className="h-9" /></Field></div>
                      <div className="col-span-4 sm:col-span-1"><Field label="High"><Input type="number" value={num(p.refHigh)} onChange={(e) => setParamRefBound(i, "refHigh", e.target.value === "" ? null : Number(e.target.value))} className="h-9" /></Field></div>
                      <div className="col-span-4 sm:col-span-1"><Field label="Crit. high"><Input type="number" value={num(p.criticalHigh)} onChange={(e) => updateParam(i, { criticalHigh: e.target.value === "" ? null : Number(e.target.value) })} className="h-9" /></Field></div>
                      <div className="col-span-11 sm:col-span-2"><Field label="Reference range"><Textarea rows={1} value={p.refRangeText ?? ""} onChange={(e) => updateParam(i, { refRangeText: e.target.value || null })} placeholder={autoRange(p.refLow, p.refHigh) || "e.g. 40 – 80"} className="min-h-9 resize-y py-1.5 leading-tight" /></Field></div>
                    </>
                  )}

                  {p.resultType === "select" && (
                    <>
                      <div className="col-span-12 sm:col-span-4">
                        <Field label="Choices" hint="Separate with commas — this is the dropdown the technician picks from">
                          <Input value={optionsToText(p.selectOptions)} onChange={(e) => updateParam(i, { selectOptions: textToOptions(e.target.value) })} placeholder="e.g. Pale yellow, Yellow, Amber, Red" className="h-9" />
                        </Field>
                      </div>
                      <div className="col-span-11 sm:col-span-2"><Field label="Reference range"><Textarea rows={1} value={p.refRangeText ?? ""} onChange={(e) => updateParam(i, { refRangeText: e.target.value || null })} placeholder="e.g. Pale yellow" className="min-h-9 resize-y py-1.5 leading-tight" /></Field></div>
                    </>
                  )}

                  {(p.resultType === "text" || p.resultType === "pos_neg") && (
                    <div className="col-span-11 sm:col-span-6"><Field label="Reference range"><Textarea rows={1} value={p.refRangeText ?? ""} onChange={(e) => updateParam(i, { refRangeText: e.target.value || null })} placeholder={p.resultType === "pos_neg" ? "e.g. Negative" : "e.g. Clear"} className="min-h-9 resize-y py-1.5 leading-tight" /></Field></div>
                  )}

                  <div className="col-span-1"><Button variant="ghost" size="icon-sm" onClick={() => removeParam(i)} className="text-destructive" aria-label="Remove"><Trash2 className="size-4" /></Button></div>
                </div>
              ))}
            </div>
          ) : (
            <p className="rounded-lg border border-dashed border-border p-3 text-sm text-muted-foreground">
              <Beaker className="mr-1 inline size-4" /> This is a single-value test. Add parameters to make it multi-parameter (e.g. CBC).
            </p>
          )}
        </div>
      </div>
    </Modal>
  );
}
