import { headers } from "next/headers";
import { Clock, CreditCard, Unlink, ShieldCheck, Hourglass } from "lucide-react";
import { resolvePublicReport, logReportAccess } from "@/lib/queries/public-report";
import { reportUrl } from "@/lib/report-engine";
import { qrDataUrl } from "@/lib/qr";
import { barcodeDataUrl } from "@/lib/barcode";
import { Logo } from "@/components/brand/logo";
import { ReportSheet, type ReportEntry } from "@/components/print/report-sheet";
import { PrintToolbar } from "@/components/print/print-sheet";

export const dynamic = "force-dynamic";
export const metadata = { title: "Your laboratory report", robots: { index: false } };

export default async function PublicReportPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const state = await resolvePublicReport(token);
  const h = await headers();
  const ip = h.get("x-forwarded-for") ?? undefined;
  const ua = h.get("user-agent") ?? undefined;

  if (state.status === "invalid") {
    return <StatusScreen icon={Unlink} tone="danger" title="Invalid or expired report link" message="This link is not valid. Please check the link from your bill or contact the laboratory." />;
  }
  if (state.status === "processing") {
    if (state.linkId) await logReportAccess(state.linkId, "blocked", { reason: "processing", ip, userAgent: ua });
    return <StatusScreen icon={Clock} tone="info" title="Your report is being processed" message="Your report is not ready yet. You will receive an SMS as soon as it is available." />;
  }
  if (state.status === "payment_pending") {
    if (state.linkId) await logReportAccess(state.linkId, "blocked", { reason: "payment_pending", ip, userAgent: ua });
    return <StatusScreen icon={CreditCard} tone="warning" title="Payment is pending" message="Your report is ready but a payment is still due. Please contact the laboratory to clear the balance and unlock your report." />;
  }

  // Ready — note this can be an interim report: the link is released as soon as
  // the first test is approved, so tests that take days (cultures, biopsies)
  // appear here later on the very same link/QR.
  const data = state.data;
  if (state.linkId) await logReportAccess(state.linkId, "view", { ip, userAgent: ua });
  const publicUrl = data.link ? await reportUrl(data.link.token, data.lab?.id) : null;
  const [qr, idBarcode] = await Promise.all([
    publicUrl ? qrDataUrl(publicUrl, 120) : Promise.resolve(""),
    barcodeDataUrl(data.patient!.code, { height: 7, scale: 2 }),
  ]);

  const { approved, total, pending, pendingTests } = state.progress;
  const isPartial = pending > 0;
  const pendingLabel = pendingTests.slice(0, 6).join(", ") + (pendingTests.length > 6 ? ` and ${pendingTests.length - 6} more` : "");
  const pendingNote = isPartial
    ? `Showing ${approved} of ${total} tests from this visit. Still in the laboratory: ${pendingLabel}. They will appear on this same link once completed and approved.`
    : null;

  return (
    <div className="min-h-screen bg-[#eef1ee]">
      <div className="no-print border-b border-border bg-card">
        <div className="mx-auto flex max-w-[210mm] items-center justify-between px-4 py-3">
          <Logo size="sm" />
          <span className="flex items-center gap-1.5 text-xs font-medium text-brand-700"><ShieldCheck className="size-4" /> Verified report</span>
        </div>
      </div>
      {isPartial && (
        <div className="no-print border-b border-amber-200 bg-amber-50">
          <div className="mx-auto flex max-w-[210mm] items-start gap-2 px-4 py-2.5 text-xs text-amber-900">
            <Hourglass className="mt-px size-4 shrink-0" />
            <p>
              <span className="font-semibold">Your report is partly ready — {approved} of {total} tests done.</span>{" "}
              Still in the laboratory: {pendingLabel}. Open this same link (or scan the QR again) later to see the rest;
              you will receive a message once the full report is ready.
            </p>
          </div>
        </div>
      )}
      <PrintToolbar />
      <div className="py-6">
        <ReportSheet
          lab={{ name: data.lab?.name ?? "Laboratory", address: data.settings?.address, phone: data.settings?.phone, email: data.settings?.email, website: data.settings?.website, panVat: data.settings?.panVat }}
          headerUrl={data.headerUrl}
          footerUrl={data.footerUrl}
          marginTopMm={data.settings?.reportMarginTopMm ?? 14}
          marginBottomMm={data.settings?.reportMarginBottomMm ?? 14}
          marginXMm={data.settings?.reportMarginXMm ?? 12}
          patient={{ fullName: data.patient!.fullName, code: data.patient!.code, gender: data.patient!.gender, ageValue: data.patient!.ageValue, ageUnit: data.patient!.ageUnit, phone: data.patient!.phone, address: data.patient!.address, referredBy: data.patient!.referredBy }}
          visit={{ code: data.visit.code, referredBy: data.visit.referredBy, visitDate: data.visit.visitDate }}
          entries={data.entries as unknown as ReportEntry[]}
          signatories={data.signatories}
          idBarcodeUrl={idBarcode}
          qrDataUrl={qr}
          publicUrl={publicUrl}
          pendingNote={pendingNote}
          cal={(data.settings?.calendarSystem as "AD" | "BS") ?? "AD"}
        />
      </div>
    </div>
  );
}

function StatusScreen({
  icon: Icon,
  tone,
  title,
  message,
}: {
  icon: React.ComponentType<{ className?: string }>;
  tone: "danger" | "info" | "warning";
  title: string;
  message: string;
}) {
  const toneCls = tone === "danger" ? "bg-danger-50 text-destructive" : tone === "warning" ? "bg-amber-50 text-amber-700" : "bg-info-50 text-info";
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-surface p-6">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 text-center shadow-card">
        <div className="mb-5 flex justify-center"><Logo size="md" showTagline /></div>
        <div className={`mx-auto mb-4 flex size-16 items-center justify-center rounded-full ${toneCls}`}>
          <Icon className="size-8" />
        </div>
        <h1 className="text-xl font-bold">{title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{message}</p>
      </div>
      <p className="mt-6 text-xs text-muted-foreground">Secured by Nidanyo · by Infobytes Nepal</p>
    </div>
  );
}
