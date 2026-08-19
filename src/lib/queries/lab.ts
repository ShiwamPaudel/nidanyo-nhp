import "server-only";
import { cache } from "react";
import { db } from "@/db/client";
import { labs, labSettings, labAssets } from "@/db/schema";
import { and, eq } from "drizzle-orm";

/**
 * Lab profile + settings. Runs on every app page via the layout, so the two
 * independent lookups go out as one libSQL batch (a single HTTP request)
 * rather than two sequential round trips. `cache` still dedupes it per request.
 */
export const getLab = cache(async (labId: string) => {
  const [labRows, settingRows] = await db.batch([
    db.select().from(labs).where(eq(labs.id, labId)),
    db.select().from(labSettings).where(eq(labSettings.labId, labId)),
  ]);
  return { lab: labRows.at(0), settings: settingRows.at(0) };
});

/** Resolve the active asset url for a given kind (header/footer/logo). */
export async function getLabAsset(labId: string, kind: string) {
  const row = (
    await db
      .select()
      .from(labAssets)
      .where(and(eq(labAssets.labId, labId), eq(labAssets.kind, kind as never), eq(labAssets.isActive, true)))
  ).at(0);
  return row ?? null;
}

export async function getAssetById(id: string) {
  return (await db.select().from(labAssets).where(eq(labAssets.id, id))).at(0) ?? null;
}

/**
 * Branding shown on the pre-auth login screen. There is no session (and so no
 * labId) at that point, so this resolves the single active lab and its
 * admin-uploaded logo. Returns nulls when the lab has not uploaded one yet.
 */
export const getLoginBranding = cache(async () => {
  const lab = (await db.select().from(labs).where(eq(labs.isActive, true)).limit(1)).at(0);
  if (!lab) return { labName: null as string | null, logoUrl: null as string | null };
  const logo = await getLabAsset(lab.id, "logo");
  return { labName: lab.name, logoUrl: logo?.url ?? null };
});
