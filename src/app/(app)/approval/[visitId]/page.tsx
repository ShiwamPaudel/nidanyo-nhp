import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, UserRound, AlertTriangle } from "lucide-react";
import { requirePermission } from "@/lib/auth/guard";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { getVisitForApproval, listSignatoriesForApproval } from "@/lib/queries/approval";
import { PageHeader } from "@/components/ui/page";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StatusChip } from "@/components/ui/status-chip";
import { cn, ageLabel, money } from "@/lib/utils";
import { flagSymbol, type ResultFlag } from "@/lib/result-flags";
import { ApprovalActions, ApprovalProvider, SignaturePicker } from "./approval-actions";

export const metadata = { title: "Review results" };

export default async function ApprovalReviewPage({ params }: { params: Promise<{ visitId: string }> }) {
  const user = await requirePermission(PERMISSIONS.APPROVAL_VIEW);
  const { visitId } = await params;
  const [data, signatories] = await Promise.all([
    getVisitForApproval(user.labId, visitId),
    listSignatoriesForApproval(user.labId),
  ]);
  if (!data) notFound();
  const { visit, patient, bill, entries } = data;
  const due = bill?.dueAmount ?? 0;
  const hasSubmitted = entries.some((e) => e.entry.status === "submitted");

  return (
    <ApprovalProvider>
      <PageHeader
        title={`Review · ${visit.code}`}
        description={`${patient?.fullName} · ${patient?.code} · ${patient?.gender}, ${ageLabel(patient?.ageValue, patient?.ageUnit)}`}
        actions={
          <>
            <Link href="/approval" className={buttonVariants({ variant: "outline" })}><ArrowLeft className="size-4" /> Back</Link>
            {hasSubmitted && <ApprovalActions visitId={visitId} dueRemaining={due} />}
          </>
        }
      />

      {due > 0 && (
        <div className="mb-4 rounded-xl border border-blue-200 bg-info-50 px-4 py-3 text-sm text-info">
          This bill has an outstanding due of <span className="font-semibold">{money(due)}</span>. Results can be approved now, but the report will only be released to the patient after payment is cleared.
        </div>
      )}

      {/* Signatures first: the approver chooses them before anything can be signed. */}
      {hasSubmitted && <SignaturePicker signatories={signatories} />}

      <Card className="mb-4">
        <CardContent className="flex items-center gap-3 pt-5">
          <span className="flex size-10 items-center justify-center rounded-full bg-brand-700 text-white"><UserRound className="size-5" /></span>
          <div>
            <p className="font-semibold">{patient?.fullName}</p>
            <p className="text-sm capitalize text-muted-foreground">{patient?.code} · {patient?.gender} · {ageLabel(patient?.ageValue, patient?.ageUnit)} · {patient?.phone ?? "—"}</p>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-4">
        {entries.map(({ entry, values }) => (
          <Card key={entry.id}>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                {entry.testName}
                <StatusChip status={entry.status} />
                {entry.hasCritical && <Badge tone="danger"><AlertTriangle className="size-3" /> Critical</Badge>}
              </CardTitle>
              {entry.enteredByName && <span className="text-xs text-muted-foreground">Entered by {entry.enteredByName}</span>}
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs uppercase text-muted-foreground">
                      <th className="py-2 font-semibold">Parameter</th>
                      <th className="py-2 font-semibold">Result</th>
                      <th className="py-2 font-semibold">Unit</th>
                      <th className="py-2 font-semibold">Reference</th>
                    </tr>
                  </thead>
                  <tbody>
                    {values.map((v) => {
                      const flag = v.flag as ResultFlag;
                      const critical = flag === "critical_low" || flag === "critical_high";
                      const abnormal = flag !== "normal";
                      return (
                        <tr key={v.id} className="border-b border-border/60">
                          <td className="py-2 pr-3 font-medium">{v.label}</td>
                          <td className={cn("py-2 pr-3 font-semibold tabular", critical ? "text-destructive" : abnormal ? "text-amber-700" : "")}>
                            {v.valueText ?? "—"} {abnormal && <span className="ml-1 text-xs">{flagSymbol(flag)}</span>}
                          </td>
                          <td className="py-2 pr-3 text-muted-foreground">{v.unit ?? "—"}</td>
                          <td className="py-2 pr-3 text-muted-foreground">{v.refText ?? "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {entry.technicianRemarks && <p className="mt-3 rounded-lg bg-surface p-2.5 text-sm text-muted-foreground"><span className="font-medium">Remarks:</span> {entry.technicianRemarks}</p>}
              {entry.correctionNote && <p className="mt-2 text-sm text-amber-700"><span className="font-medium">Correction note:</span> {entry.correctionNote}</p>}
            </CardContent>
          </Card>
        ))}
      </div>
    </ApprovalProvider>
  );
}
