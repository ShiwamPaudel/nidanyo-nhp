"use client";

import { Fragment, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Save, Send, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { computeFlag, flagSymbol, type ResultFlag } from "@/lib/result-flags";
import { saveResults, type ResultEntryInput } from "@/lib/actions/result-actions";

export interface RowDef {
  parameterId: string | null;
  label: string;
  unit: string | null;
  refText: string;
  refLow: number | null;
  refHigh: number | null;
  criticalLow: number | null;
  criticalHigh: number | null;
  resultType: "numeric" | "text" | "select" | "pos_neg";
  options: string[] | null;
  value: string;
}
export interface EntryDef {
  entryId: string;
  testName: string;
  /** Department this test belongs to; entries are shown grouped under it. */
  department: string | null;
  status: string;
  locked: boolean;
  correctionNote: string | null;
  technicianRemarks: string;
  rows: RowDef[];
}

// Result-entry status → dot colour + hover label. Replaces the old text chip:
// the workflow state is now a small coloured dot beside the test name (grey =
// draft, amber = pending/awaiting approval, red = correction, green = approved).
const STATUS_DOT: Record<string, { color: string; label: string }> = {
  pending: { color: "bg-amber-500", label: "Pending result" },
  draft: { color: "bg-gray-400", label: "Draft" },
  submitted: { color: "bg-amber-500", label: "Awaiting approval" },
  correction_required: { color: "bg-red-500", label: "Correction required" },
  approved: { color: "bg-green-500", label: "Approved" },
  dispatched: { color: "bg-brand-600", label: "Dispatched" },
};

function StatusDot({ status }: { status: string }) {
  const s = STATUS_DOT[status] ?? { color: "bg-gray-400", label: status.replace(/_/g, " ") };
  return <span title={s.label} aria-label={s.label} className={cn("inline-block size-2 shrink-0 rounded-full", s.color)} />;
}

export function ResultEntryForm({ visitId, initialEntries }: { visitId: string; initialEntries: EntryDef[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [entries, setEntries] = useState<EntryDef[]>(initialEntries);
  const formRef = useRef<HTMLDivElement>(null);

  // Pressing Enter in a result field jumps to the next field, just like Tab —
  // technicians type a value and hit Enter to move down the list without
  // reaching for the mouse. Only fires from text inputs so it never hijacks a
  // dropdown's own Enter (select an option). The next field's text is selected
  // so an existing value can be typed straight over.
  function handleEnterAdvance(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "Enter") return;
    const target = e.target as HTMLElement;
    if (target.tagName !== "INPUT") return;
    e.preventDefault();
    const root = formRef.current;
    if (!root) return;
    const autofilled = autofillDc(target);
    const fields = Array.from(root.querySelectorAll<HTMLInputElement | HTMLSelectElement>("input:not([disabled]), select:not([disabled])"));
    const next = fields[fields.indexOf(target as HTMLInputElement) + 1];
    if (next) {
      next.focus();
      // After an autofill the next box's new value lands on the next render, so
      // select it then — otherwise the selection is lost when the value changes.
      if (next instanceof HTMLInputElement) {
        if (autofilled) requestAnimationFrame(() => next.select());
        else next.select();
      }
    }
  }

  // DC (differential count) autofill, on Enter only — the filled values stay
  // freely editable. Neutrophils + Lymphocytes make 90; Monocytes + Eosinophils
  // + Basophils make 10. Enter on Neutrophils fills Lymphocytes; on Monocytes
  // fills Eosinophils and sets Basophils to 0; on Eosinophils fills Basophils.
  // Rows are found by label, in the same test first (DC as one test with these
  // parameters) and otherwise anywhere on the form (each as its own test).
  function autofillDc(target: HTMLElement): boolean {
    const ei = Number(target.dataset.ei);
    const ri = Number(target.dataset.ri);
    if (Number.isNaN(ei) || Number.isNaN(ri)) return false;
    const row = entries[ei]?.rows[ri];
    if (!row) return false;
    const kind = dcKind(row.label);
    if (!kind || row.value.trim() === "") return false;
    const typed = Number(row.value);
    if (Number.isNaN(typed)) return false;

    const find = (k: DcKind): [number, number] | null => {
      const own = entries[ei].rows.findIndex((r) => dcKind(r.label) === k);
      if (own >= 0) return [ei, own];
      for (let i = 0; i < entries.length; i++) {
        const j = entries[i].rows.findIndex((r) => dcKind(r.label) === k);
        if (j >= 0) return [i, j];
      }
      return null;
    };
    const fills: { at: [number, number]; value: number }[] = [];
    if (kind === "neutrophils") {
      const lym = find("lymphocytes");
      if (lym) fills.push({ at: lym, value: 90 - typed });
    } else if (kind === "monocytes") {
      const eos = find("eosinophils");
      const baso = find("basophils");
      if (eos) fills.push({ at: eos, value: 10 - typed });
      if (baso) fills.push({ at: baso, value: 0 });
    } else if (kind === "eosinophils") {
      const mono = find("monocytes");
      const baso = find("basophils");
      const monoVal = mono ? entries[mono[0]].rows[mono[1]].value.trim() : "";
      if (baso && monoVal !== "" && !Number.isNaN(Number(monoVal))) {
        fills.push({ at: baso, value: 10 - Number(monoVal) - typed });
      }
    }
    // Skip a fill that would go negative or into a locked (approved) test.
    const valid = fills.filter((f) => f.value >= 0 && !entries[f.at[0]].locked);
    if (valid.length === 0) return false;
    setEntries((prev) => {
      const next = structuredClone(prev);
      // toFixed + Number trims float noise (e.g. 90 - 70.1 → 19.9, not 19.900000000000006).
      for (const f of valid) next[f.at[0]].rows[f.at[1]].value = String(Number(f.value.toFixed(2)));
      return next;
    });
    return true;
  }

  function setValue(ei: number, ri: number, value: string) {
    setEntries((prev) => {
      const next = structuredClone(prev);
      next[ei].rows[ri].value = value;
      return next;
    });
  }
  function payload(): { visitId: string; entries: ResultEntryInput[] } {
    return {
      visitId,
      entries: entries
        .filter((e) => !e.locked)
        // technicianRemarks is no longer entered by technicians (the input was
        // removed). Any value already stored is passed straight back through so a
        // re-save never wipes an existing remark; no new one can be added.
        .map((e) => ({
          entryId: e.entryId,
          technicianRemarks: e.technicianRemarks || null,
          values: e.rows.map((r) => ({ parameterId: r.parameterId, label: r.label, value: r.value })),
        })),
    };
  }

  function save(mode: "draft" | "submit") {
    if (mode === "submit") {
      // Only the tests that have a value are submitted; the rest stay draft. So
      // we just need at least one test filled in overall — not every test.
      const anyFilled = entries.some((e) => !e.locked && e.rows.some((r) => r.value.trim()));
      if (!anyFilled) return toast.error("Enter values for at least one test before submitting.");
    }
    start(async () => {
      const res = await saveResults({ ...payload(), mode });
      if (res.ok) {
        toast.success(res.message ?? "Saved");
        // A full submit returns to the queue; a partial submit (some tests left
        // as draft) keeps you on the visit to finish the remaining tests.
        if (mode === "submit" && res.data.drafted === 0) router.push("/results");
        router.refresh();
      } else toast.error(res.error);
    });
  }

  // Group for display only — each entry keeps its index into `entries`, because
  // setValue addresses rows by position. Reordering the state array here would
  // write values into the wrong test.
  const byDept: { dept: string; items: { entry: EntryDef; ei: number }[] }[] = [];
  entries.forEach((entry, ei) => {
    const dept = entry.department ?? "Other";
    const last = byDept[byDept.length - 1];
    // The server already sorts entries by department, so equal neighbours group.
    if (last && last.dept === dept) last.items.push({ entry, ei });
    else byDept.push({ dept, items: [{ entry, ei }] });
  });

  return (
    <div ref={formRef} className="space-y-4" onKeyDown={handleEnterAdvance}>
      {byDept.map(({ dept, items }) => (
        <div key={dept} className="space-y-2">
          <p className="rounded bg-[#F1F5F2] px-2 py-1 text-[13px] font-extrabold uppercase tracking-wide text-brand-700">{dept}</p>
          {/* One table per department — the column headings are printed once at
              the top of the department, not repeated for every test. */}
          <Card>
            <CardContent className="overflow-x-auto p-5">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase text-muted-foreground">
                    <th className="py-2 font-semibold">Parameter</th>
                    <th className="py-2 font-semibold">Result</th>
                    <th className="py-2 font-semibold">Unit</th>
                    <th className="py-2 font-semibold">Reference</th>
                    <th className="py-2 font-semibold">Flag</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map(({ entry, ei }) => {
                    // A "one-liner" test (single value named after the test itself)
                    // is one row: the status dot + name sit beside its result box.
                    // A multi-parameter test gets a name row (dot + name) above its
                    // indented parameter rows.
                    const oneLiner =
                      entry.rows.length === 1 &&
                      entry.rows[0].label.trim().toLowerCase() === entry.testName.trim().toLowerCase();
                    return (
                      <Fragment key={entry.entryId}>
                        {!oneLiner && (
                          <tr className="border-b border-border/60">
                            <td colSpan={5} className="pt-3 pb-1">
                              <span className="inline-flex items-center gap-2 font-semibold">
                                <StatusDot status={entry.status} />
                                {entry.testName}
                              </span>
                            </td>
                          </tr>
                        )}
                        {entry.correctionNote && (
                          <tr>
                            <td colSpan={5} className="pb-2 pt-1">
                              <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                                <span><span className="font-medium">Correction requested:</span> {entry.correctionNote}</span>
                              </div>
                            </td>
                          </tr>
                        )}
                        {entry.rows.map((row, ri) => (
                          <ParamRow
                            key={ri}
                            row={row}
                            disabled={entry.locked}
                            ei={ei}
                            ri={ri}
                            onChange={(v) => setValue(ei, ri, v)}
                            indent={!oneLiner}
                            label={
                              oneLiner ? (
                                <span className="inline-flex items-center gap-2">
                                  <StatusDot status={entry.status} />
                                  {row.label}
                                </span>
                              ) : (
                                row.label
                              )
                            }
                          />
                        ))}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </div>
      ))}

      <div className="sticky bottom-4 flex items-center justify-end gap-2 rounded-xl border border-border bg-card/90 p-3 shadow-lift backdrop-blur">
        <Button variant="outline" onClick={() => save("draft")} loading={pending}>
          <Save className="size-4" /> Save draft
        </Button>
        <Button onClick={() => save("submit")} loading={pending}>
          <Send className="size-4" /> Submit for approval
        </Button>
      </div>
    </div>
  );
}

/** One editable result row: Parameter | Result input | Unit | Reference | Flag. */
type DcKind = "neutrophils" | "lymphocytes" | "monocytes" | "eosinophils" | "basophils";

/** Which DC (differential count) parameter a row is, by its label; null if none. */
function dcKind(label: string): DcKind | null {
  const l = label.trim().toLowerCase();
  if (l.startsWith("neutrophil")) return "neutrophils";
  if (l.startsWith("lymphocyte")) return "lymphocytes";
  if (l.startsWith("monocyte")) return "monocytes";
  if (l.startsWith("eosinophil")) return "eosinophils";
  if (l.startsWith("basophil")) return "basophils";
  return null;
}

function ParamRow({
  row,
  disabled,
  ei,
  ri,
  onChange,
  label,
  indent,
}: {
  row: RowDef;
  disabled: boolean;
  /** Entry/row position, read back by the Enter handler for the DC autofill. */
  ei: number;
  ri: number;
  onChange: (value: string) => void;
  label: React.ReactNode;
  indent?: boolean;
}) {
  const num = row.value.trim() === "" ? null : Number(row.value);
  const flag: ResultFlag =
    num != null && !Number.isNaN(num)
      ? computeFlag(num, { refLow: row.refLow, refHigh: row.refHigh, criticalLow: row.criticalLow, criticalHigh: row.criticalHigh })
      : "normal";
  const critical = flag === "critical_low" || flag === "critical_high";
  return (
    <tr className="border-b border-border/60">
      <td className={cn("py-2 pr-3", indent ? "pl-6 text-muted-foreground" : "font-medium")}>{label}</td>
      <td className="py-2 pr-3">
        {row.resultType === "select" && row.options ? (
          <Select value={row.value} onChange={(e) => onChange(e.target.value)} disabled={disabled} className="h-9 w-36">
            <option value="">—</option>
            {row.options.map((o) => <option key={o} value={o}>{o}</option>)}
          </Select>
        ) : row.resultType === "pos_neg" ? (
          <Select value={row.value} onChange={(e) => onChange(e.target.value)} disabled={disabled} className="h-9 w-36">
            <option value="">—</option>
            <option value="Negative">Negative</option>
            <option value="Positive">Positive</option>
          </Select>
        ) : (
          <Input
            value={row.value}
            onChange={(e) => onChange(e.target.value)}
            disabled={disabled}
            data-ei={ei}
            data-ri={ri}
            inputMode={row.resultType === "numeric" ? "decimal" : "text"}
            className={cn(
              "h-9 w-36",
              // Out-of-range values make the box itself glow (kept while focused), matching the flag badge tone.
              critical &&
                "border-destructive bg-red-50 text-destructive font-semibold ring-2 ring-destructive/40 shadow-[0_0_12px_rgba(255,51,51,0.55)] focus-visible:border-destructive focus-visible:ring-destructive/50",
              flag !== "normal" && !critical &&
                "border-amber-500 bg-amber-50 text-amber-900 font-semibold ring-2 ring-amber-400/50 shadow-[0_0_12px_rgba(245,158,11,0.55)] focus-visible:border-amber-500 focus-visible:ring-amber-400/60",
            )}
            placeholder="Enter"
          />
        )}
      </td>
      <td className="py-2 pr-3 text-muted-foreground">{row.unit ?? "—"}</td>
      <td className="py-2 pr-3 text-muted-foreground">{row.refText}</td>
      <td className="py-2">
        {flag !== "normal" && (
          <Badge tone={critical ? "danger" : "warning"}>
            {critical && <AlertTriangle className="size-3" />} {flagSymbol(flag)}
          </Badge>
        )}
      </td>
    </tr>
  );
}
