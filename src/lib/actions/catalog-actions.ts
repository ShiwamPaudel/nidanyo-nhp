"use server";

import { revalidatePath } from "next/cache";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { tests, testParameters, testGroups, testGroupItems } from "@/db/schema";
import { authorize } from "@/lib/auth/guard";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { ActionResult, ok, fail, run } from "@/lib/action";
import { audit } from "@/lib/audit";
import { testSchema, groupSchema, type TestInput, type GroupInput } from "@/lib/validators/catalog";

function fieldErrors(issues: { path: (string | number)[]; message: string }[]) {
  const fe: Record<string, string> = {};
  for (const i of issues) fe[String(i.path[0] ?? "form")] = i.message;
  return fe;
}

export async function saveTest(input: TestInput & { id?: string }): Promise<ActionResult<{ id: string }>> {
  return run(async () => {
    const user = await authorize(PERMISSIONS.CATALOG_MANAGE);
    const parsed = testSchema.safeParse(input);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Please check the form.", fieldErrors(parsed.error.issues));
    const d = parsed.data;
    const isMulti = d.parameters.length > 0;

    if (input.id) {
      const existing = (await db.select().from(tests).where(and(eq(tests.id, input.id), eq(tests.labId, user.labId)))).at(0);
      if (!existing) return fail("Test not found.");
      await db
        .update(tests)
        .set({
          name: d.name,
          shortCode: d.shortCode,
          departmentId: d.departmentId || null,
          sampleTypeId: d.sampleTypeId || null,
          price: d.price,
          method: d.method || null,
          unit: d.unit || null,
          description: d.description || null,
          resultType: isMulti ? "multi" : d.resultType,
          selectOptions: !isMulti && d.resultType === "select" ? d.selectOptions : null,
          refLow: d.refLow ?? null,
          refHigh: d.refHigh ?? null,
          refRangeText: d.refRangeText || null,
          criticalLow: d.criticalLow ?? null,
          criticalHigh: d.criticalHigh ?? null,
          tatHours: d.tatHours ?? null,
          updatedBy: user.id,
        })
        .where(eq(tests.id, input.id));
      // Replace parameters
      await db.delete(testParameters).where(eq(testParameters.testId, input.id));
      await insertParams(input.id, d.parameters);
      await audit(user, "test.update", { entity: "test", entityId: input.id, summary: `Updated test ${d.name}` });
      revalidatePath("/tests");
      return ok({ id: input.id }, "Test updated");
    }

    const [row] = await db
      .insert(tests)
      .values({
        labId: user.labId,
        name: d.name,
        shortCode: d.shortCode,
        departmentId: d.departmentId || null,
        sampleTypeId: d.sampleTypeId || null,
        price: d.price,
        method: d.method || null,
        unit: d.unit || null,
        resultType: isMulti ? "multi" : d.resultType,
        selectOptions: !isMulti && d.resultType === "select" ? d.selectOptions : null,
        refLow: d.refLow ?? null,
        refHigh: d.refHigh ?? null,
        refRangeText: d.refRangeText || null,
        criticalLow: d.criticalLow ?? null,
        criticalHigh: d.criticalHigh ?? null,
        tatHours: d.tatHours ?? null,
        createdBy: user.id,
      })
      .returning({ id: tests.id });
    await insertParams(row.id, d.parameters);
    await audit(user, "test.create", { entity: "test", entityId: row.id, summary: `Created test ${d.name}` });
    revalidatePath("/tests");
    return ok({ id: row.id }, "Test created");
  });
}

async function insertParams(testId: string, params: TestInput["parameters"]) {
  for (let i = 0; i < params.length; i++) {
    const p = params[i];
    await db.insert(testParameters).values({
      testId,
      name: p.name,
      unit: p.unit || null,
      resultType: p.resultType,
      selectOptions: p.resultType === "select" ? p.selectOptions : null,
      refLow: p.refLow ?? null,
      refHigh: p.refHigh ?? null,
      refRangeText: p.refRangeText || null,
      criticalLow: p.criticalLow ?? null,
      criticalHigh: p.criticalHigh ?? null,
      displayOrder: i,
    });
  }
}

export async function setTestActive(id: string, active: boolean): Promise<ActionResult> {
  return run(async () => {
    const user = await authorize(PERMISSIONS.CATALOG_MANAGE);
    await db.update(tests).set({ isActive: active }).where(and(eq(tests.id, id), eq(tests.labId, user.labId)));
    await audit(user, "test.toggle", { entity: "test", entityId: id, summary: active ? "Activated test" : "Deactivated test" });
    revalidatePath("/tests");
    return ok(undefined, active ? "Test activated" : "Test deactivated");
  });
}

export async function saveGroup(input: GroupInput & { id?: string }): Promise<ActionResult<{ id: string }>> {
  return run(async () => {
    const user = await authorize(PERMISSIONS.CATALOG_MANAGE);
    const parsed = groupSchema.safeParse(input);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Please check the form.", fieldErrors(parsed.error.issues));
    const d = parsed.data;

    let groupId = input.id;
    if (groupId) {
      const existing = (await db.select().from(testGroups).where(and(eq(testGroups.id, groupId), eq(testGroups.labId, user.labId)))).at(0);
      if (!existing) return fail("Group not found.");
      await db.update(testGroups).set({ name: d.name, shortCode: d.shortCode || null, departmentId: d.departmentId || null, pricingMode: d.pricingMode, groupPrice: d.groupPrice, updatedBy: user.id }).where(eq(testGroups.id, groupId));
      await db.delete(testGroupItems).where(eq(testGroupItems.groupId, groupId));
    } else {
      const [row] = await db.insert(testGroups).values({ labId: user.labId, name: d.name, shortCode: d.shortCode || null, departmentId: d.departmentId || null, pricingMode: d.pricingMode, groupPrice: d.groupPrice, createdBy: user.id }).returning({ id: testGroups.id });
      groupId = row.id;
    }
    for (let i = 0; i < d.testIds.length; i++) {
      await db.insert(testGroupItems).values({ groupId, testId: d.testIds[i], displayOrder: i });
    }
    await audit(user, input.id ? "group.update" : "group.create", { entity: "test_group", entityId: groupId, summary: `${input.id ? "Updated" : "Created"} group ${d.name}` });
    revalidatePath("/test-groups");
    return ok({ id: groupId }, input.id ? "Profile updated" : "Profile created");
  });
}

export async function setGroupActive(id: string, active: boolean): Promise<ActionResult> {
  return run(async () => {
    const user = await authorize(PERMISSIONS.CATALOG_MANAGE);
    await db.update(testGroups).set({ isActive: active }).where(and(eq(testGroups.id, id), eq(testGroups.labId, user.labId)));
    revalidatePath("/test-groups");
    return ok(undefined, active ? "Profile activated" : "Profile deactivated");
  });
}

/** Load a test (with parameters) for the edit form. */
export async function loadTestForEdit(id: string): Promise<ActionResult<TestInput & { id: string }>> {
  return run(async () => {
    const user = await authorize(PERMISSIONS.CATALOG_VIEW);
    const test = (await db.select().from(tests).where(and(eq(tests.id, id), eq(tests.labId, user.labId)))).at(0);
    if (!test) return fail("Test not found.");
    const params = await db.select().from(testParameters).where(eq(testParameters.testId, id));
    return ok({
      id: test.id,
      name: test.name,
      shortCode: test.shortCode,
      departmentId: test.departmentId,
      sampleTypeId: test.sampleTypeId,
      price: test.price,
      method: test.method,
      unit: test.unit,
      description: test.description,
      resultType: test.resultType,
      selectOptions: test.selectOptions,
      refLow: test.refLow,
      refHigh: test.refHigh,
      refRangeText: test.refRangeText,
      criticalLow: test.criticalLow,
      criticalHigh: test.criticalHigh,
      tatHours: test.tatHours,
      parameters: params
        .sort((a, b) => a.displayOrder - b.displayOrder)
        .map((p) => ({ id: p.id, name: p.name, unit: p.unit, resultType: p.resultType, selectOptions: p.selectOptions, refLow: p.refLow, refHigh: p.refHigh, refRangeText: p.refRangeText, criticalLow: p.criticalLow, criticalHigh: p.criticalHigh })),
    } as TestInput & { id: string });
  });
}

/** Load a group (with member test ids) for the edit form. */
export async function loadGroupForEdit(id: string): Promise<ActionResult<GroupInput & { id: string }>> {
  return run(async () => {
    const user = await authorize(PERMISSIONS.CATALOG_VIEW);
    const group = (await db.select().from(testGroups).where(and(eq(testGroups.id, id), eq(testGroups.labId, user.labId)))).at(0);
    if (!group) return fail("Profile not found.");
    // Ordered — testIds carries the group's print order, and saveGroup rewrites
    // displayOrder from this array's order. Loading unordered would scramble a
    // group's order every time someone opened and saved it.
    const items = await db
      .select()
      .from(testGroupItems)
      .where(eq(testGroupItems.groupId, id))
      .orderBy(asc(testGroupItems.displayOrder));
    return ok({
      id: group.id,
      name: group.name,
      shortCode: group.shortCode,
      departmentId: group.departmentId,
      pricingMode: group.pricingMode,
      groupPrice: group.groupPrice,
      testIds: items.map((i) => i.testId),
    } as GroupInput & { id: string });
  });
}
