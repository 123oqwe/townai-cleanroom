import { z } from "zod";

import {
  createPolicyAwareHarnessTool,
  type HarnessToolBinding,
} from "@town/harness";
import type { GoogleApiClient } from "@town/google";
import type { Id } from "@town/contracts";
import { MAX_OUTPUT_CHARS } from "./shared.js";

const googleAccountId = z.uuidv7();
const gmailSearchArguments = z
  .object({
    accountId: googleAccountId,
    query: z.string().trim().min(1).max(500),
    maxResults: z.number().int().min(1).max(50).default(10),
  })
  .strict();
const gmailMessageArguments = z
  .object({
    accountId: googleAccountId,
    messageId: z.string().trim().min(1).max(500),
  })
  .strict();
const gmailSendArguments = z
  .object({
    accountId: googleAccountId,
    to: z.email(),
    cc: z.array(z.email()).max(20).optional(),
    subject: z.string().trim().min(1).max(500),
    body: z.string().min(1).max(100_000),
  })
  .strict();

export function createGoogleGmailSearchHarnessBinding(
  ownerId: Id<"user">,
  google: GoogleApiClient,
): HarnessToolBinding {
  return {
    definition: {
      name: "google_gmail_search",
      description:
        "Search Gmail on an explicitly selected connected Google account.",
      parameters: {
        type: "object",
        properties: {
          accountId: { type: "string", format: "uuid" },
          query: { type: "string", minLength: 1, maxLength: 500 },
          maxResults: { type: "integer", minimum: 1, maximum: 50 },
        },
        required: ["accountId", "query"],
        additionalProperties: false,
      },
    },
    port: {
      name: "google_gmail_search",
      requiresApproval: false,
      async execute(arguments_) {
        const value = gmailSearchArguments.parse(arguments_);
        const result = await google.gmailSearch({
          ownerId,
          accountId: value.accountId as Id<"connected-account">,
          query: value.query,
          maxResults: value.maxResults,
        });
        return { kind: "result", output: JSON.stringify(result) };
      },
    },
  };
}

/** Read-only Gmail message retrieval through an owner-selected account. */
export function createGoogleGmailGetMessageHarnessBinding(
  ownerId: Id<"user">,
  google: GoogleApiClient,
): HarnessToolBinding {
  return {
    definition: {
      name: "google_gmail_get_message",
      description:
        "Read one Gmail message on an explicitly selected connected Google account.",
      parameters: {
        type: "object",
        properties: {
          accountId: { type: "string", format: "uuid" },
          messageId: { type: "string", minLength: 1, maxLength: 500 },
        },
        required: ["accountId", "messageId"],
        additionalProperties: false,
      },
    },
    port: {
      name: "google_gmail_get_message",
      requiresApproval: false,
      async execute(arguments_) {
        const value = gmailMessageArguments.parse(arguments_);
        const result = await google.gmailGetMessage({
          ownerId,
          accountId: value.accountId as Id<"connected-account">,
          messageId: value.messageId,
        });
        const output = JSON.stringify(result);
        return {
          kind: "result",
          output:
            output.length > MAX_OUTPUT_CHARS
              ? `${output.slice(0, MAX_OUTPUT_CHARS)}… [truncated]`
              : output,
        };
      },
    },
  };
}

/** Sends an external Gmail message only after the Harness approval boundary resumes. */
export function createGoogleGmailSendHarnessBinding(
  ownerId: Id<"user">,
  google: GoogleApiClient,
): HarnessToolBinding {
  return createPolicyAwareHarnessTool({
    definition: {
      name: "google_gmail_send",
      description:
        "Send an email from an explicitly selected connected Google account after approval.",
      parameters: {
        type: "object",
        properties: {
          accountId: { type: "string", format: "uuid" },
          to: { type: "string", format: "email" },
          cc: {
            type: "array",
            items: { type: "string", format: "email" },
            maxItems: 20,
          },
          subject: { type: "string", minLength: 1, maxLength: 500 },
          body: { type: "string", minLength: 1, maxLength: 100000 },
        },
        required: ["accountId", "to", "subject", "body"],
        additionalProperties: false,
      },
    },
    decide: () => "approval_required",
    async execute(arguments_) {
      const value = gmailSendArguments.parse(arguments_);
      const result = await google.gmailSend({
        ownerId,
        accountId: value.accountId as Id<"connected-account">,
        to: value.to,
        ...(value.cc === undefined ? {} : { cc: value.cc }),
        subject: value.subject,
        body: value.body,
      });
      return { kind: "result", output: JSON.stringify(result) };
    },
  });
}

/** Read-only Calendar free/busy lookup through an owner-selected account. */

const calendarFreeBusyArguments = z
  .object({
    accountId: googleAccountId,
    timeMin: z.iso.datetime(),
    timeMax: z.iso.datetime(),
    calendarIds: z
      .array(z.string().trim().min(1).max(500))
      .max(20)
      .default(["primary"]),
  })
  .strict()
  .superRefine((value, context) => {
    if (new Date(value.timeMax).getTime() <= new Date(value.timeMin).getTime())
      context.addIssue({
        code: "custom",
        path: ["timeMax"],
        message: "timeMax must be after timeMin",
      });
  });
const calendarCreateEventArguments = z
  .object({
    accountId: googleAccountId,
    calendarId: z.string().trim().min(1).max(500).default("primary"),
    event: z.record(z.string(), z.json()),
  })
  .strict();

export function createGoogleCalendarFreeBusyHarnessBinding(
  ownerId: Id<"user">,
  google: GoogleApiClient,
): HarnessToolBinding {
  return {
    definition: {
      name: "google_calendar_freebusy",
      description:
        "Read Calendar free/busy data on an explicitly selected connected Google account.",
      parameters: {
        type: "object",
        properties: {
          accountId: { type: "string", format: "uuid" },
          timeMin: { type: "string", format: "date-time" },
          timeMax: { type: "string", format: "date-time" },
          calendarIds: {
            type: "array",
            items: { type: "string", minLength: 1, maxLength: 500 },
            maxItems: 20,
          },
        },
        required: ["accountId", "timeMin", "timeMax"],
        additionalProperties: false,
      },
    },
    port: {
      name: "google_calendar_freebusy",
      requiresApproval: false,
      async execute(arguments_) {
        const value = calendarFreeBusyArguments.parse(arguments_);
        const result = await google.calendarFreeBusy({
          ownerId,
          accountId: value.accountId as Id<"connected-account">,
          timeMin: value.timeMin,
          timeMax: value.timeMax,
          calendarIds: value.calendarIds,
        });
        return { kind: "result", output: JSON.stringify(result) };
      },
    },
  };
}

/** Creates an external Calendar event only after the Harness approval boundary resumes. */
export function createGoogleCalendarCreateEventHarnessBinding(
  ownerId: Id<"user">,
  google: GoogleApiClient,
): HarnessToolBinding {
  return createPolicyAwareHarnessTool({
    definition: {
      name: "google_calendar_create_event",
      description:
        "Create a Calendar event on an explicitly selected connected Google account after approval.",
      parameters: {
        type: "object",
        properties: {
          accountId: { type: "string", format: "uuid" },
          calendarId: { type: "string", minLength: 1, maxLength: 500 },
          event: { type: "object" },
        },
        required: ["accountId", "event"],
        additionalProperties: false,
      },
    },
    decide: () => "approval_required",
    async execute(arguments_) {
      const value = calendarCreateEventArguments.parse(arguments_);
      const result = await google.calendarCreateEvent({
        ownerId,
        accountId: value.accountId as Id<"connected-account">,
        calendarId: value.calendarId,
        event: value.event,
      });
      return { kind: "result", output: JSON.stringify(result) };
    },
  });
}

/** Queues a child Routine only when the immutable parent version allowlists it. */
