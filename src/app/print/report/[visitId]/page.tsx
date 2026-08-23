import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Lock } from "lucide-react";
import { requireUser, hasPermission } from "@/lib/auth/guard";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { getReportData } from "@/lib/queries/report";
import { reportUrl } from "@/lib/report-engine";
import { qrDataUrl } from "@/lib/qr";
import { barcodeDataUrl } from "@/lib/barcode";
import { formatMoney } from "@/lib/utils";
import { type ReportEntry } from "@/components/print/report-sheet";
import { ReportPrintView } from "./report-print-view";

export const metadata = { title: "Report" };

export default async function ReportPrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ visitId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  if (!hasPermission(user, PERMISSIONS.REPORT_VIEW)) redirect("/no-access");
  const { visitId } = await params;
  const sp = await searchParams;
  // Optional subset of approved entries to print (from the "print selected
  // tests" picker). Omitted → the full report (every approved test).
  const entryIds = typeof sp.entries === "string" ? sp.entries.split(",").map((s) => s.trim()).filter(Boolean) : undefined;
  const data = await getReportData(user.labId, visitId, entryIds);
  if (!data || data.entries.length === 0) notFound();

  // Due-print restriction (admin-configurable). When enabled, a report for a
  // visit with an outstanding due may only be printed by an admin (settings
  // manager). Other staff — lab technicians, reception, dispatch — are blocked
  // until the bill is cleared. Enforced here so every print entry point (Reports
  // list, Dispatch, direct URL) is covered.
  const dueAmount = data.bill?.dueAmount ?? 0;
  const isAdmin = hasPermission(user, PERMISSIONS.SETTINGS_MANAGE);
  if (data.settings?.restrictDuePrint && dueAmount > 0 && !isAdmin) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#eef1ee] p-6">
        <div className="max-w-md rounded-xl border border-border bg-card p-8 text-center shadow-card">
          <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-amber-100 text-amber-700">
            <Lock className="size-6" />
          </div>
          <h1 className="text-lg font-semibold text-foreground">Payment due — printing blocked</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            This report has an outstanding due of{" "}
            <span className="font-semibold text-foreground">{formatMoney(dueAmount, data.settings?.currency ?? "NPR")}</span>.
            Only an administrator can print it until the bill is cleared. Please collect the due or ask an admin.
          </p>
          <Link href="/reports" className="mt-6 inline-block rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-brand-700">
            Back to Reports
          </Link>
        </div>
      </div>
    );
  }

  const publicUrl = data.link ? await reportUrl(data.link.token, user.labId) : null;
  const [qr, idBarcode] = await Promise.all([
    publicUrl ? qrDataUrl(publicUrl, 120) : Promise.resolve(""),
    // Same Code 128 symbology as the sample labels, so one handheld scanner
    // reads a tube and a printed report alike.
    barcodeDataUrl(data.patient!.code, { height: 7, scale: 2 }),
  ]);

  return (
    <ReportPrintView
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
      cal={(data.settings?.calendarSystem as "AD" | "BS") ?? "AD"}
    />
  );
}
