"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, ArrowLeft, ArrowRight, Upload, ImageIcon, UserCheck, Building2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Textarea, Select, Field } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/feedback";
import { saveReportSignatory, removeReportSignatory, reorderReportSignatories } from "@/lib/actions/settings-actions";

export interface SignatoryItem {
  id: string;
  /** Staff account this block belongs to; null = lab-wide (prints on every report). */
  userId: string | null;
  name: string;
  description: string | null;
  url: string;
}

export interface StaffOption {
  id: string;
  name: string;
  designation: string | null;
  roleKey: string;
}

export function SignatoriesManager({ items, staff }: { items: SignatoryItem[]; staff: StaffOption[] }) {
  const staffById = new Map(staff.map((s) => [s.id, s]));
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<SignatoryItem | null>(null);
  const [pending, start] = useTransition();

  function openNew() { setEditing(null); setOpen(true); }
  function openEdit(it: SignatoryItem) { setEditing(it); setOpen(true); }

  function remove(it: SignatoryItem) {
    if (!confirm(`Remove ${it.name} from report signatories?`)) return;
    start(async () => {
      const r = await removeReportSignatory(it.id);
      r.ok ? toast.success(r.message ?? "Removed") : toast.error(r.error);
      if (r.ok) router.refresh();
    });
  }

  function move(idx: number, dir: -1 | 1) {
    const next = idx + dir;
    if (next < 0 || next >= items.length) return;
    const ids = items.map((i) => i.id);
    [ids[idx], ids[next]] = [ids[next], ids[idx]];
    start(async () => {
      const r = await reorderReportSignatories(ids);
      if (r.ok) router.refresh(); else toast.error(r.error);
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <p className="text-sm text-muted-foreground">
          Signature blocks shown at the <strong>end of every report</strong> (last page only), independent of who approved the results.
          Add each signatory&rsquo;s signature image with their name and designation. Left-to-right order matches the list below.
          {" "}Link a block to a <strong>staff account</strong> and it prints only on reports for visits that person registered —
          so a lab with several technicians shows the one who handled the visit, on the left, beside the lab-wide
          signatory (pathologist) on the right. Leave it unlinked to print on every report.
        </p>
        <Button onClick={openNew} className="shrink-0"><Plus className="size-4" /> Add signatory</Button>
      </div>

      {items.length === 0 ? (
        <EmptyState title="No report signatories" description="Add the people who sign off reports (e.g. Consultant Pathologist, Lab Director)." />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((it, idx) => (
            <Card key={it.id}>
              <CardContent className="pt-5">
                <div className="mb-3 flex h-16 items-center justify-center rounded-lg border border-dashed border-border bg-surface">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={it.url} alt="" className="max-h-full max-w-full object-contain" />
                </div>
                <p className="font-semibold">{it.name}</p>
                <p className="text-xs text-muted-foreground">{it.description ?? "—"}</p>
                <p className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-muted px-2 py-1 text-[11px] font-medium text-muted-foreground">
                  {it.userId ? (
                    <><UserCheck className="size-3.5 text-brand-700" /> Only visits registered by {staffById.get(it.userId)?.name ?? "a removed account"}</>
                  ) : (
                    <><Building2 className="size-3.5" /> Every report</>
                  )}
                </p>
                <div className="mt-3 flex items-center justify-between">
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="icon-sm" disabled={idx === 0 || pending} onClick={() => move(idx, -1)} aria-label="Move left"><ArrowLeft className="size-4" /></Button>
                    <Button variant="ghost" size="icon-sm" disabled={idx === items.length - 1 || pending} onClick={() => move(idx, 1)} aria-label="Move right"><ArrowRight className="size-4" /></Button>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="icon-sm" onClick={() => openEdit(it)} aria-label="Edit"><Pencil className="size-4" /></Button>
                    <Button variant="ghost" size="icon-sm" className="text-destructive" onClick={() => remove(it)} aria-label="Remove"><Trash2 className="size-4" /></Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {open && <SignatoryForm initial={editing} staff={staff} onClose={() => setOpen(false)} />}
    </div>
  );
}

function SignatoryForm({ initial, staff, onClose }: { initial: SignatoryItem | null; staff: StaffOption[]; onClose: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [userId, setUserId] = useState(initial?.userId ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(initial?.url ?? null);

  function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!f.type.startsWith("image/")) return toast.error("Please choose an image file");
    setFile(f);
    setPreview(URL.createObjectURL(f));
  }

  function submit() {
    if (name.trim().length < 2) return toast.error("Please enter the signatory's name");
    if (!initial && !file) return toast.error("Please choose a signature image");
    const fd = new FormData();
    if (initial) fd.set("id", initial.id);
    fd.set("name", name);
    fd.set("description", description);
    fd.set("userId", userId);
    if (file) fd.set("file", file);
    start(async () => {
      const r = await saveReportSignatory(fd);
      if (r.ok) { toast.success(r.message ?? "Saved"); onClose(); router.refresh(); }
      else toast.error(r.error);
    });
  }

  return (
    <Modal open onClose={onClose} title={`${initial ? "Edit" : "Add"} signatory`} size="sm"
      footer={<><Button variant="outline" onClick={onClose} disabled={pending}>Cancel</Button><Button onClick={submit} loading={pending}>Save</Button></>}>
      <div className="space-y-3">
        <Field label="Signature image" required={!initial} hint="Transparent PNG recommended">
          <div className="flex items-center gap-3">
            <div className="flex h-16 w-32 items-center justify-center overflow-hidden rounded-lg border border-dashed border-border bg-surface">
              {preview ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={preview} alt="" className="max-h-full max-w-full object-contain" />
              ) : (
                <ImageIcon className="size-5 text-muted-foreground" />
              )}
            </div>
            <Button type="button" variant="outline" size="sm" onClick={() => inputRef.current?.click()}><Upload className="size-4" /> {preview ? "Replace" : "Upload"}</Button>
            <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={pick} />
          </div>
        </Field>
        <Field label="Name" required><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Dr. A. Sharma" autoFocus /></Field>
        <Field label="Description" hint="Designation / qualification shown under the name"><Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="MD, Consultant Pathologist" rows={2} /></Field>
        <Field
          label="Print on"
          hint={
            userId
              ? "Prints only on reports for visits this person registered."
              : "Prints on every report — use this for the pathologist / lab director."
          }
        >
          <Select value={userId} onChange={(e) => setUserId(e.target.value)}>
            <option value="">Every report (lab-wide)</option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                Visits registered by {s.name}
                {s.designation ? ` — ${s.designation}` : ""}
              </option>
            ))}
          </Select>
        </Field>
      </div>
    </Modal>
  );
}
