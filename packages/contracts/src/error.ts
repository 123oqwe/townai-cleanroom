import { z } from "zod";

export const problemDetailsSchema = z
  .object({
    type: z.url().optional(),
    title: z.string().min(1),
    status: z.number().int().min(400).max(599),
    detail: z.string().min(1).optional(),
    instance: z.string().startsWith("/").optional(),
    code: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
    metadata: z.record(z.string(), z.string()).optional(),
  })
  .strict();

export type ProblemDetails = z.infer<typeof problemDetailsSchema>;
