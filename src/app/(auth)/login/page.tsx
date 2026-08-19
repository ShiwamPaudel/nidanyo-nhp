import { redirect } from "next/navigation";
import { Phone } from "lucide-react";
import { getCurrentUser } from "@/lib/auth/session";
import { getLoginBranding } from "@/lib/queries/lab";
import { Logo } from "@/components/brand/logo";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in" };

export default async function LoginPage() {
  const user = await getCurrentUser();
  if (user) redirect("/dashboard");
  const { labName, logoUrl } = await getLoginBranding();

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* Brand panel */}
      <div className="relative hidden flex-col justify-between overflow-hidden bg-brand-700 p-12 text-white lg:flex">
        <div
          className="absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage:
              "radial-gradient(circle at 20% 20%, white 1px, transparent 1px), radial-gradient(circle at 70% 60%, white 1px, transparent 1px)",
            backgroundSize: "44px 44px",
          }}
        />
        <div className="relative z-10 flex items-center gap-3">
          <div className="rounded-xl bg-white px-3 py-2">
            <Logo size="md" />
          </div>
        </div>
        <div className="relative z-10 space-y-4">
          <h1 className="max-w-md text-3xl font-bold leading-tight">
            The complete laboratory workflow, from liquid to logic.
          </h1>
          <p className="max-w-md text-sm text-white/80">
            Registration, billing, sample collection, result entry, pathologist approval, secure
            report delivery and end-of-day finance — all in one calm, fast workspace.
          </p>
          <ul className="grid max-w-md grid-cols-2 gap-2 pt-2 text-sm text-white/90">
            {[
              "Patient registration & billing",
              "Sample tracking",
              "Result entry & approval",
              "Secure report links & SMS",
            ].map((f) => (
              <li key={f} className="flex items-center gap-2">
                <span className="size-1.5 rounded-full bg-[#FF3131]" />
                {f}
              </li>
            ))}
          </ul>
        </div>
        <div className="relative z-10 flex items-end justify-between gap-4">
          <a
            href="https://www.infobytesnepal.com"
            target="_blank"
            rel="noreferrer"
            className="text-xs text-white/60 transition-colors hover:text-white/90"
          >
            by Infobytes Nepal Pvt. Ltd.
          </a>
          <div className="text-right text-xs text-white/70">
            <p className="text-white/60">In case of Support Please Contact.</p>
            <p className="mt-1 flex items-center justify-end gap-1.5 font-medium text-white/90">
              <Phone className="size-3.5" />
              <a href="tel:+9779843468715" className="hover:underline">
                +977 984 3468715
              </a>
              <span className="text-white/40">|</span>
              <a href="tel:+9779863777171" className="hover:underline">
                986 3777171
              </a>
            </p>
          </div>
        </div>
      </div>

      {/* Form panel */}
      <div className="flex items-center justify-center bg-surface p-6">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <Logo size="lg" showTagline />
          </div>
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={logoUrl}
              alt={labName ?? "Laboratory"}
              className="mb-6 w-full rounded-2xl object-cover shadow-sm ring-1 ring-black/5"
            />
          ) : labName ? (
            <p className="mb-6 text-center text-lg font-semibold text-brand-700">{labName}</p>
          ) : null}
          <div className="space-y-1.5">
            <h2 className="text-2xl font-bold tracking-tight">Sign in</h2>
            <p className="text-sm text-muted-foreground">
              Enter your credentials to access your laboratory workspace.
            </p>
          </div>
          <div className="mt-6">
            <LoginForm />
          </div>
          <p className="mt-8 text-center text-xs text-muted-foreground">
            Accounts are created by your administrator. There is no public sign-up.
          </p>
        </div>
      </div>
    </div>
  );
}
