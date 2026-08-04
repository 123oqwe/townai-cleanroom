import { z } from "zod";

import {
  createPolicyAwareHarnessTool,
  type HarnessToolBinding,
} from "@town/harness";
import type { MemoryRepository } from "@town/knowledge";
import type { VoiceSynthesisProvider } from "../lib/elevenlabs-voice.js";
import type { Id } from "@town/contracts";

const voiceArguments = z
  .object({
    text: z.string().trim().min(1).max(5_000),
    voiceId: z.string().trim().min(1).max(200).optional(),
  })
  .strict();

export function createTownVoiceSpeakHarnessBinding(
  provider: VoiceSynthesisProvider,
): HarnessToolBinding {
  return createPolicyAwareHarnessTool({
    definition: {
      name: "town_voice_speak",
      description:
        "Synthesize spoken audio from text using the configured voice provider.",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string", minLength: 1, maxLength: 5_000 },
          voiceId: { type: "string", minLength: 1, maxLength: 200 },
        },
        required: ["text"],
        additionalProperties: false,
      },
    },
    decide: () => "approval_required",
    async execute(arguments_) {
      const value = voiceArguments.parse(arguments_);
      const result = await provider.synthesize({
        text: value.text,
        ...(value.voiceId === undefined ? {} : { voiceId: value.voiceId }),
      });
      if (result.audio.byteLength > 1_500_000)
        throw new Error("VOICE_AUDIO_OUTPUT_TOO_LARGE");
      return {
        kind: "result",
        output: JSON.stringify({
          contentType: result.contentType,
          byteLength: result.audio.byteLength,
          audioBase64: Buffer.from(result.audio).toString("base64"),
        }),
      };
    },
  });
}

/** Writes a durable Memory only after the Harness approval boundary resumes. */

const memoryArguments = z.discriminatedUnion("scope", [
  z
    .object({
      scope: z.literal("global"),
      content: z.string().trim().min(1).max(10_000),
      confidence: z.number().min(0).max(1).optional(),
      expiresAt: z.iso.datetime().optional(),
    })
    .strict(),
  z
    .object({
      scope: z.literal("routine"),
      routineId: z.uuidv7(),
      content: z.string().trim().min(1).max(10_000),
      confidence: z.number().min(0).max(1).optional(),
      expiresAt: z.iso.datetime().optional(),
    })
    .strict(),
]);

export function createTownMemoryAddHarnessBinding(
  ownerId: Id<"user">,
  memory: MemoryRepository,
  threadId: string,
  ownsSchedule: (
    ownerId: Id<"user">,
    routineScheduleId: Id<"routine-schedule">,
  ) => Promise<boolean>,
): HarnessToolBinding {
  const definition = {
    name: "town_memory_add",
    description: "Save a user-approved fact to Town memory.",
    parameters: {
      type: "object",
      properties: {
        scope: { enum: ["global", "routine"] },
        routineId: {
          type: "string",
          pattern:
            "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-7[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$",
        },
        content: { type: "string", minLength: 1, maxLength: 10_000 },
        confidence: { type: "number", minimum: 0, maximum: 1 },
        expiresAt: { type: "string", format: "date-time" },
      },
      oneOf: [
        {
          required: ["scope", "content"],
          properties: { scope: { const: "global" } },
          not: { required: ["routineId"] },
        },
        {
          required: ["scope", "routineId", "content"],
          properties: { scope: { const: "routine" } },
        },
      ],
      additionalProperties: false,
    },
  } as const;
  return createPolicyAwareHarnessTool({
    definition,
    decide: (arguments_) =>
      memoryArguments.safeParse(arguments_).success
        ? "approval_required"
        : "deny",
    async execute(arguments_) {
      const value = memoryArguments.parse(arguments_);
      if (
        value.scope === "routine" &&
        !(await ownsSchedule(
          ownerId,
          value.routineId as Id<"routine-schedule">,
        ))
      ) {
        throw new Error(
          "HARNESS_MEMORY_ROUTINE_NOT_FOUND: routine is not owned by this user.",
        );
      }
      const common = {
        ownerId,
        content: value.content,
        status: "active" as const,
        ...(value.confidence === undefined
          ? {}
          : { confidence: value.confidence }),
        ...(value.expiresAt === undefined
          ? {}
          : { expiresAt: new Date(value.expiresAt) }),
        observedAt: new Date(),
        authorType: "assistant" as const,
        citations: [
          {
            sourceType: "session" as const,
            sourceRef: `harness:${threadId}:town_memory_add`,
            observedAt: new Date(),
          },
        ],
      };
      const created =
        value.scope === "global"
          ? await memory.create({ ...common, scope: "global" })
          : await memory.create({
              ...common,
              scope: "routine",
              routineId: value.routineId as Id<"routine">,
            });
      return {
        kind: "result" as const,
        output: JSON.stringify({
          memory: {
            id: created.id,
            scope: created.scope,
            routineId: created.routineId,
            status: created.status,
            confidence: created.confidence,
            createdAt: created.createdAt,
          },
        }),
      };
    },
  });
}

/** Read-only Gmail search through an owner-selected connected Google account. */
