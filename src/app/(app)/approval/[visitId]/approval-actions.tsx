"use client";

import { createContext, useCallback, useContext, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckCircle2, Undo2, PenLine, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea, Field } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/feedback";
import { cn } from "@/lib/utils";
import { approveVisit, sendBackResults } from "@/lib/actions/approval-actions";
import { MAX_REPORT_SIGNATORIES } from "@/lib/report-signatories";

export interface ApprovalSignatory {
  id: string;
  name: string;
  description: string | null;
  url: string;
}

/**
 * The signature choice is made in the page body but gates the "Approve & sign"
 * button in the page header, so the two share state through this context rather
 * than the page hoisting client state of its own.
 */
const SignatureCtx = createContext<{
  selected: string[];
  toggle: (id: string) => void;
  atLimit: boolean;
} | null>(null);

function useSignatureSelection() {
  const ctx = useContext(SignatureCtx);
  if (!ctx) throw new Error("Signature components must render inside <ApprovalProvider>");
  return ctx;
}

export function ApprovalProvider({ children }: { children: React.ReactNode }) {
  // Selection order is preserved — it becomes the left-to-right print order.
  const [selected, setSelected] = useState<string[]>([]);

  const toggle = useCallback((id: string) => {
    setSelected((cur) => {
      if (cur.includes(id)) return cur.filter((x) => x !== id);
      if (cur.length >= MAX_REPORT_SIGNATORIES) {
        toast.error(`A report can carry at most ${MAX_REPORT_SIGNATORIES} signatures.`);
        return cur;
      }
      return [...cur, id];
    });
  }, []);

  const value = useMemo(
    () => ({ selected, toggle, atLimit: selected.length >= MAX_REPORT_SIGNATORIES }),
    [selected, toggle],
  );
  return <SignatureCtx.Provider value={value}>{children}</SignatureCtx.Provider>;
}

/**
 * Signature picker. Shows the actual signature image with the name and
 * designation beneath it, because an approver picks by recognising a signature,
 * not by reading a list of names.
 */
export function SignaturePicker({ signatories }: { signatories: ApprovalSignatory[] }) {
  const { selected, toggle, atLimit } = useSignatureSelection();

  return (
    <Card className="mb-4">
      <CardHeader className="flex-row items-center justify-between gap-3">
        <CardTitle className="flex items-center gap-2">
          <PenLine className="size-4 text-brand-700" />
          Signatures on this report
          <span className="text-destructive" aria-hidden>
            *
          </span>
        </CardTitle>
        <span className={cn("text-xs", selected.length === 0 ? "text-destructive" : "text-muted-foreground")}>
          {selected.length === 0
            ? "Select at least one to enable approval"
            : `${selected.length} of ${MAX_REPORT_SIGNATORIES} selected`}
        </span>
      </CardHeader>
      <CardContent>
        {signatories.length === 0 ? (
          <EmptyState
            title="No signatures configured"
            description="An administrator must add signature blocks under Settings → Report Signatories before results can be approved."
          />
        ) : (
          <>
            <p className="mb-3 text-sm text-muted-foreground">
              These appear at the end of the printed report and on the patient&rsquo;s online copy, in the order you
              select them.
            </p>
            <div
              role="group"
              aria-label="Report signatures"
              className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
            >
              {signatories.map((s) => {
                const idx = selected.indexOf(s.id);
                const on = idx >= 0;
                const blocked = !on && atLimit;
                return (
                  <button
                    key={s.id}
                    type="button"
                    role="checkbox"
                    aria-checked={on}
                    disabled={blocked}
                    onClick={() => toggle(s.id)}
                    className={cn(
                      "relative rounded-xl border p-3 text-left transition-colors",
                      on
                        ? "border-brand-700 bg-brand-50 ring-1 ring-brand-700"
                        : "border-border bg-card hover:border-brand-700/40 hover:bg-surface",
                      blocked && "cursor-not-allowed opacity-50 hover:border-border hover:bg-card",
                    )}
                  >
                    <span
                      className={cn(
                        "absolute right-2 top-2 flex size-5 items-center justify-center rounded-md border",
                        on ? "border-brand-700 bg-brand-700 text-white" : "border-border bg-card",
                      )}
                    >
                      {on && <Check className="size-3.5" strokeWidth={3} />}
                    </span>
                    {on && (
                      <span className="absolute left-2 top-2 rounded bg-brand-700 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                        {idx + 1}
                      </span>
                    )}
                    <span className="mb-2 flex h-16 items-center justify-center rounded-lg border border-dashed border-border bg-surface">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={s.url} alt="" className="max-h-full max-w-full object-contain" />
                    </span>
                    <span className="block text-sm font-semibold">{s.name}</span>
                    <span className="block whitespace-pre-line text-xs text-muted-foreground">
                      {s.description ?? "—"}
                    </span>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export function ApprovalActions({ visitId, dueRemaining }: { visitId: string; dueRemaining: number }) {
  const router = useRouter();
  const { selected } = useSignatureSelection();
  const [pending, start] = useTransition();
  const [approveOpen, setApproveOpen] = useState(false);
  const [backOpen, setBackOpen] = useState(false);
  const [interpretation, setInterpretation] = useState("");
  const [reason, setReason] = useState("");

  const noSignature = selected.length === 0;

  function doApprove() {
    if (noSignature) return toast.error("Select at least one signature before approving");
    start(async () => {
      const res = await approveVisit({
        visitId,
        interpretation: interpretation || null,
        signatoryIds: selected,
      });
      if (res.ok) {
        toast.success(res.message ?? "Approved");
        setApproveOpen(false);
        router.push("/approval");
        router.refresh();
      } else toast.error(res.error);
    });
  }
  function doSendBack() {
    if (reason.trim().length < 3) return toast.error("Please provide a reason");
    start(async () => {
      const res = await sendBackResults({ visitId, reason });
      if (res.ok) {
        toast.success(res.message ?? "Sent back");
        setBackOpen(false);
        router.push("/approval");
        router.refresh();
      } else toast.error(res.error);
    });
  }

  return (
    <>
      <Button variant="outline" className="text-destructive hover:bg-danger-50" onClick={() => setBackOpen(true)}>
        <Undo2 className="size-4" /> Send back
      </Button>
      <Button
        onClick={() => setApproveOpen(true)}
        disabled={noSignature}
        title={noSignature ? "Select at least one signature first" : undefined}
      >
        <CheckCircle2 className="size-4" /> Approve &amp; sign
      </Button>

      <Modal
        open={approveOpen}
        onClose={() => setApproveOpen(false)}
        title="Approve & sign results"
        description={`Signing with ${selected.length} signature${selected.length === 1 ? "" : "s"}.`}
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setApproveOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={doApprove} loading={pending} disabled={noSignature}>
              Approve
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {dueRemaining > 0 && (
            <div className="rounded-lg border border-blue-200 bg-info-50 px-3 py-2 text-sm text-info">
              This bill still has an outstanding due. The report will be approved now but only released to the patient
              once payment is cleared.
            </div>
          )}
          <Field label="Interpretation / comments (optional)">
            <Textarea
              value={interpretation}
              onChange={(e) => setInterpretation(e.target.value)}
              placeholder="Clinical interpretation shown on the report"
              className="min-h-[80px]"
            />
          </Field>
        </div>
      </Modal>

      <Modal
        open={backOpen}
        onClose={() => setBackOpen(false)}
        title="Send back for correction"
        description="The technician will be asked to correct and resubmit."
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setBackOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button variant="danger" onClick={doSendBack} loading={pending}>
              Send back
            </Button>
          </>
        }
      >
        <Field label="Reason for correction" required>
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Please re-check the WBC value"
            autoFocus
          />
        </Field>
      </Modal>
    </>
  );
}
