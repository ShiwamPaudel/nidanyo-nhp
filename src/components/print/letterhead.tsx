import { DropletMark } from "@/components/brand/logo";

export interface LabInfo {
  name: string;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  panVat?: string | null;
}

/**
 * Print header. If the lab uploaded a header image, it is placed exactly as
 * given (full width). Otherwise a clean text letterhead is built from settings.
 * No lab name is hard-coded anywhere.
 */
export function PrintHeader({ headerUrl, lab }: { headerUrl?: string | null; lab: LabInfo }) {
  if (headerUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={headerUrl} alt="" className="block w-full object-contain" />;
  }
  return (
    <div className="flex items-center justify-between border-b-2 border-brand-700 pb-3">
      <div className="flex items-center gap-3">
        <DropletMark size={40} />
        <div>
          <h1 className="text-xl font-bold text-brand-700">{lab.name}</h1>
          {lab.address && <p className="text-[12px] text-[#475467]">{lab.address}</p>}
          <p className="text-[12px] text-[#475467]">
            {[lab.phone, lab.email, lab.website].filter(Boolean).join("  ·  ")}
          </p>
        </div>
      </div>
      {lab.panVat && <p className="text-[12px] text-[#475467]">PAN/VAT: {lab.panVat}</p>}
    </div>
  );
}

export function PrintFooter({ footerUrl, lab }: { footerUrl?: string | null; lab: LabInfo }) {
  if (footerUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={footerUrl} alt="" className="block w-full object-contain" />;
  }
  return (
    <div className="border-t border-[#DFE2E2] pt-2 text-center text-[11px] text-[#647067]">
      {lab.name} · Generated with Nidanyo by Infobytes Nepal
    </div>
  );
}
