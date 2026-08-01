import { z } from "zod";

import { idSchema } from "./id.js";

export const eventEnvelopeSchema = z
  .object({
    eventId: idSchema,
    aggregateType: z.string().min(1),
    aggregateId: idSchema,
    sequence: z.number().int().positive(),
    type: z.string().min(1),
    version: z.number().int().positive(),
    occurredAt: z.iso.datetime({ offset: true }),
    actorId: idSchema.nullable(),
    correlationId: idSchema,
    causationId: idSchema.nullable(),
    data: z.record(z.string(), z.unknown()),
  })
  .strict();

export type EventEnvelope = z.infer<typeof eventEnvelopeSchema>;
