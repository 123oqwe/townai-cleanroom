import { createHmac, timingSafeEqual } from "node:crypto";
import type { Context, Hono } from "hono";
import { z } from "zod";
import type { Sql } from "postgres";
import { asId } from "@town/contracts";
import type { RoutineRepository } from "@town/routines";
import type { AuthVariables } from "./auth.js";

const telegramUpdateSchema = z
  .object({
    update_id: z.number().int(),
    message: z
      .object({
        message_id: z.number().int(),
        date: z.number().int(),
        chat: z.object({ id: z.union([z.number(), z.string()]) }),
        from: z
          .object({
            id: z.union([z.number(), z.string()]),
            first_name: z.string().optional(),
            username: z.string().optional(),
          })
          .passthrough()
          .optional(),
        text: z.string().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export interface TelegramEventsDependencies {
  sql: Sql;
  repository: RoutineRepository;
  secretToken: string;
}

/**
 * Telegram Bot webhook receiver. Telegram sends a secret token in the
 * `X-Telegram-Bot-Api-Secret-Token` header that must match the value set
 * when the webhook was registered. The routine id is part of the URL so
 * routing ownership is resolved server-side.
 */
export function registerTelegramEventsRoute(
  app: Hono<{ Variables: AuthVariables }>,
  dependencies: TelegramEventsDependencies,
): void {
  const route = async (context: Context<{ Variables: AuthVariables }>) => {
    const token = context.req.header("x-telegram-bot-api-secret-token");
    if (token === undefined || token.length === 0)
      return context.json({ code: "TELEGRAM_TOKEN_MISSING" }, 401);
    const expected = Buffer.from(dependencies.secretToken, "utf8");
    const actual = Buffer.from(token, "utf8");
    if (
      expected.length !== actual.length ||
      !timingSafeEqual(expected, actual)
    )
      return context.json({ code: "TELEGRAM_TOKEN_INVALID" }, 401);

    const rawBody = await context.req.raw.text();
    if (Buffer.byteLength(rawBody, "utf8") > 256 * 1024)
      return context.json({ code: "PAYLOAD_TOO_LARGE" }, 413);
    let update: z.infer<typeof telegramUpdateSchema>;
    try {
      update = telegramUpdateSchema.parse(JSON.parse(rawBody));
    } catch {
      return context.json({ code: "INVALID_JSON" }, 400);
    }
    if (update.message === undefined || update.message.text === undefined)
      return context.json({ accepted: false, reason: "IGNORED_UPDATE" });

    const routineId = asId<"routine-schedule">(
      context.req.param("routineId"),
    );
    const [owner] = await dependencies.sql<{ owner_id: string }[]>`
      select owner_id from routine_schedules
      where id=${routineId} and enabled=true
      limit 1
    `;
    if (owner === undefined)
      return context.json({ code: "ROUTINE_NOT_FOUND" }, 404);

    const run = await dependencies.repository.queueTrigger(
      asId<"user">(owner.owner_id),
      routineId,
      "telegram_message",
      {
        updateId: update.update_id,
        message: update.message,
      },
      `telegram:${update.update_id}`,
    );
    return context.json({ accepted: true, run }, 202);
  };

  app.post("/v1/integrations/telegram/events/:routineId", route);
  app.post("/integrations/telegram/events/:routineId", route);
}

