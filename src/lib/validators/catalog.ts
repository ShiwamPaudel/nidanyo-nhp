import { z } from "zod";

const numOpt = z.coerce.number().optional().nullable();

/**
 * Dropdown choices for a `select` result type (e.g. Colour → Pale yellow /
 * Yellow / Amber). Blank entries are dropped and an empty list becomes null, so
 * a parameter can never be left as a dropdown with nothing to pick.
 */
const selectOptionsOpt = z
  .array(z.string())
  .optional()
  .nullable()
  .transform((v) => {
    if (!v) return null;
    const cleaned = v.map((o) => o.trim()).filter(Boolean);
    return cleaned.length ? cleaned : null;
  });

export const testParameterSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1, "Parameter name required"),
  unit: z.string().trim().optional().nullable(),
  resultType: z.enum(["numeric", "text", "select", "pos_neg"]).default("numeric"),
  selectOptions: selectOptionsOpt,
  refLow: numOpt,
  refHigh: numOpt,
  refRangeText: z.string().trim().optional().nullable(),
  criticalLow: numOpt,
  criticalHigh: numOpt,
});

export const testSchema = z.object({
  name: z.string().trim().min(2, "Test name is required").max(160),
  shortCode: z.string().trim().min(1, "Short code is required").max(40),
  departmentId: z.string().optional().nullable(),
  sampleTypeId: z.string().optional().nullable(),
  price: z.coerce.number().min(0, "Price cannot be negative"),
  method: z.string().trim().optional().nullable(),
  unit: z.string().trim().optional().nullable(),
  description: z.string().trim().max(5000).optional().nullable(),
  resultType: z.enum(["numeric", "text", "select", "pos_neg", "multi"]).default("numeric"),
  selectOptions: selectOptionsOpt,
  refLow: numOpt,
  refHigh: numOpt,
  refRangeText: z.string().trim().optional().nullable(),
  criticalLow: numOpt,
  criticalHigh: numOpt,
  tatHours: z.coerce.number().int().min(0).optional().nullable(),
  parameters: z.array(testParameterSchema).default([]),
});
export type TestInput = z.infer<typeof testSchema>;

export const groupSchema = z.object({
  name: z.string().trim().min(2, "Group name is required").max(160),
  shortCode: z.string().trim().optional().nullable(),
  departmentId: z.string().optional().nullable(),
  pricingMode: z.enum(["fixed", "sum"]).default("fixed"),
  groupPrice: z.coerce.number().min(0).default(0),
  testIds: z.array(z.string()).min(1, "Select at least one test"),
});
export type GroupInput = z.infer<typeof groupSchema>;
