"use client";

import { useEffect, useRef, useState } from "react";
import { Printer, ArrowLeft } from "lucide-react";
import { ReportSheet, ReportBody, type ReportSheetProps } from "@/components/print/report-sheet";
import { PrintHeader, PrintFooter } from "@/components/print/letterhead";

const PX_PER_MM = 3.7795275591; // 96dpi
const PAGE_WIDTH_MM = 210; // A4

/**
 * Printable report view. Uses paged.js to paginate the report so a live
 * "Page X of Y" line can be shown just above the footer on every page. The
 * letterhead header/footer are placed into paged.js running elements (repeated
 * per page via @page margin boxes); the reserved margins are measured from the
 * actual header/footer heights so full-width letterhead images are never cropped.
 *
 * Paged.js runs in the browser only. Until it finishes — or if it errors — we
 * fall back to the native table-based ReportSheet, which is fully functional on
 * its own (just without the per-page number). This guarantees the report always
 * renders.
 */
export function ReportPrintView(props: ReportSheetProps) {
  const [showHeader, setShowHeader] = useState(true);
  const [showFooter, setShowFooter] = useState(true);
  const [paged, setPaged] = useState(false); // true once paged.js output is shown
  const sourceRef = useRef<HTMLDivElement>(null);
  const targetRef = useRef<HTMLDivElement>(null);

  const marginX = props.marginXMm ?? 12;
  // When a band is switched off we reserve the configured margin instead, so a
  // pre-printed letterpad is never overprinted. Top and bottom are configured
  // separately — the bottom used to reuse the top value.
  const fallbackTopMm = props.marginTopMm ?? 14;
  const fallbackBottomMm = props.marginBottomMm ?? 14;
  const contentWidthMm = PAGE_WIDTH_MM - 2 * marginX;

  useEffect(() => {
    let cancelled = false;
    const source = sourceRef.current;
    const target = targetRef.current;
    if (!source || !target) return;

    async function paginate() {
      try {
        setPaged(false);
        target!.innerHTML = "";

        // Wait for header/footer/body images so heights measure correctly.
        const imgs = Array.from(source!.querySelectorAll("img"));
        await Promise.all(
          imgs.map((img) =>
            img.complete && img.naturalHeight > 0
              ? Promise.resolve()
              : new Promise<void>((res) => {
                  img.addEventListener("load", () => res(), { once: true });
                  img.addEventListener("error", () => res(), { once: true });
                }),
          ),
        );
        if (cancelled) return;

        const headerEl = source!.querySelector(".rpt-header") as HTMLElement | null;
        const footerEl = source!.querySelector(".rpt-footer") as HTMLElement | null;
        const headerMm = showHeader && headerEl?.offsetHeight ? headerEl.offsetHeight / PX_PER_MM + 3 : 0;
        const footerMm = showFooter && footerEl?.offsetHeight ? footerEl.offsetHeight / PX_PER_MM + 3 : 0;
        // The configured margin is a FLOOR, honoured in both modes:
        //  - band off  → it is the blank reserve for a pre-printed letterpad.
        //  - band on   → the band still gets its measured height, but never less
        //                than the configured margin.
        // Previously it was consulted only when the band was off, so changing it
        // with the header on appeared to do nothing at all.
        const topMm = Math.max(headerMm, fallbackTopMm);
        const bottomMm = Math.max(footerMm, fallbackBottomMm);

        // Continuation pages (2nd onward) get a little extra top breathing room
        // so a department section that flows onto a new page doesn't sit cramped
        // against the top edge. Only applied when the header band is OFF (printing
        // on a pre-printed letter pad): with the band ON the running header must
        // stay at the same height on every page, so page 1 and 2 keep one margin.
        const contTopExtraMm = showHeader ? 0 : 8;

        const css = `
          @page {
            size: A4;
            margin: ${topMm + contTopExtraMm}mm ${marginX}mm ${bottomMm}mm ${marginX}mm;
            @top-center { content: element(rptHeader); }
            @bottom-center { content: element(rptFooter); }
          }
          @page:first { margin-top: ${topMm}mm; }
          .rpt-header { position: running(rptHeader); width: 100%; }
          .rpt-footer { position: running(rptFooter); width: 100%; }
          .rpt-content { width: 100%; }
        `;

        const { Previewer } = await import("pagedjs");
        if (cancelled) return;
        const previewer = new Previewer();
        await previewer.preview(source!.innerHTML, [{ _: css }], target!);
        if (cancelled) return;

        // Fill in the per-page number now that total pages are known. Paged.js
        // clones the running footer (incl. .rpt-pageno) into every page.
        const pages = target!.querySelectorAll(".pagedjs_page");
        const total = pages.length;
        pages.forEach((pg, i) => {
          const no = pg.querySelector(".rpt-pageno");
          if (no) no.textContent = `Page ${i + 1} of ${total}`;
        });
        setPaged(total > 0);
      } catch (err) {
        console.error("[report paged.js]", err);
        if (!cancelled) setPaged(false); // keep table fallback
      }
    }

    paginate();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showHeader, showFooter, fallbackTopMm, fallbackBottomMm, marginX]);

  return (
    <div className="min-h-screen bg-[#eef1ee] print-root">
      <div className="no-print sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 border-b border-border bg-card px-4 py-3">
        <button onClick={() => window.history.back()} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted">
          <ArrowLeft className="size-4" /> Back
        </button>
        <div className="flex flex-wrap items-center gap-4">
          <span className="text-xs text-muted-foreground">Printing on a pre-printed letter pad? Turn these off.</span>
          <label className="flex cursor-pointer items-center gap-1.5 text-sm font-medium">
            <input type="checkbox" className="size-4 accent-brand-700" checked={showHeader} onChange={(e) => setShowHeader(e.target.checked)} /> Include header
          </label>
          <label className="flex cursor-pointer items-center gap-1.5 text-sm font-medium">
            <input type="checkbox" className="size-4 accent-brand-700" checked={showFooter} onChange={(e) => setShowFooter(e.target.checked)} /> Include footer
          </label>
          <button onClick={() => window.print()} className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-brand-700">
            <Printer className="size-4" /> Print / Save PDF
          </button>
        </div>
      </div>

      <style>{`
        .report-paged .pagedjs_page { background:#fff; margin:0 auto 16px; box-shadow:0 1px 8px rgba(0,0,0,.12); }
        @media print { .report-paged .pagedjs_page { box-shadow:none; margin:0; } }
      `}</style>

      {/* Hidden source that paged.js paginates (running letterhead + content). */}
      <div
        ref={sourceRef}
        aria-hidden
        className="no-print"
        style={{ position: "absolute", left: -99999, top: 0, width: `${contentWidthMm}mm`, visibility: "hidden" }}
      >
        <div className="rpt-header">{showHeader && <PrintHeader headerUrl={props.headerUrl} lab={props.lab} />}</div>
        <div className="rpt-footer">
          <div className="rpt-pageno" style={{ textAlign: "center", fontSize: 10, fontStyle: "italic", color: "#647067", marginBottom: "1mm" }} />
          {showFooter && <PrintFooter footerUrl={props.footerUrl} lab={props.lab} />}
        </div>
        <div className="rpt-content">
          <ReportBody cal={props.cal} patient={props.patient} visit={props.visit} entries={props.entries} signatories={props.signatories} idBarcodeUrl={props.idBarcodeUrl} qrDataUrl={props.qrDataUrl} publicUrl={props.publicUrl} />
        </div>
      </div>

      {/* Paged.js output (shown once ready). */}
      <div ref={targetRef} className="report-paged" style={{ display: paged ? "block" : "none" }} />

      {/* Fallback: native table-based report until paged.js is ready or if it fails. */}
      {!paged && (
        <div className="py-6 print-page-wrap">
          <ReportSheet {...props} showHeader={showHeader} showFooter={showFooter} />
        </div>
      )}
    </div>
  );
}
