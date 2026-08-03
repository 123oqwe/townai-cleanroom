import type { Hono } from "hono";
import { z } from "zod";

import {
  channelKindSchema,
  deliveryStatusSchema,
  type ChannelRepository,
} from "@town/channels";
import { asId } from "@town/contracts";
import type { OperationsRepository } from "@town/operations";
import type { AuthVariables } from "./auth.js";

export interface ChannelDependencies {
  repository: ChannelRepository;
  audit?: OperationsRepository;
}

const createSchema = z
  .object({
    kind: channelKindSchema,
    address: z.string().trim().min(1).max(2_000),
    config: z.record(z.string(), z.json()).default({}),
  })
  .strict();
const enqueueSchema = z
  .object({
    channelId: z.uuidv7(),
    eventType: z.string().trim().min(1).max(200),
    idempotencyKey: z.string().trim().min(1).max(500),
    payload: z.record(z.string(), z.json()),
  })
  .strict();

export function registerChannelRoutes(
  app: Hono<{ Variables: AuthVariables }>,
  dependencies: ChannelDependencies,
): void {
  app.get("/v1/channels", async (context) => {
    const ownerId = context.get("identity").user.id;
    return context.json({
      channels: await dependencies.repository.list(ownerId),
    });
  });
  app.post("/v1/channels", async (context) => {
    const ownerId = context.get("identity").user.id;
    return context.json(
      {
        channel: await dependencies.repository.create({
          ownerId,
          ...createSchema.parse(await context.req.json()),
        }),
      },
      201,
    );
  });
  app.delete("/v1/channels/:channelId", async (context) => {
    const ownerId = context.get("identity").user.id;
    return context.json({
      channel: await dependencies.repository.disable(
        ownerId,
        asId<"notification-channel">(context.req.param("channelId")),
      ),
    });
  });
  app.post("/v1/notification-deliveries", async (context) => {
    const ownerId = context.get("identity").user.id;
    const value = enqueueSchema.parse(await context.req.json());
    return context.json(
      {
        delivery: await dependencies.repository.enqueue({
          ownerId,
          ...value,
          channelId: asId<"notification-channel">(value.channelId),
        }),
      },
      201,
    );
  });
  app.get("/v1/notification-deliveries", async (context) => {
    const ownerId = context.get("identity").user.id;
    const query = context.req.query();
    const status =
      query["status"] === undefined
        ? undefined
        : deliveryStatusSchema.parse(query["status"]);
    const limit =
      query["limit"] === undefined
        ? undefined
        : z.coerce.number().parse(query["limit"]);
    return context.json({
      deliveries: await dependencies.repository.listDeliveries(ownerId, {
        ...(status === undefined ? {} : { status }),
        ...(limit === undefined ? {} : { limit }),
      }),
    });
  });
  app.get("/v1/notification-timeline", async (context) => {
    if (dependencies.audit === undefined)
      return context.json({ code: "AUDIT_NOT_CONFIGURED" }, 503);
    const ownerId = context.get("identity").user.id;
    const limit = z.coerce
      .number()
      .int()
      .min(1)
      .max(100)
      .parse(context.req.query("limit") ?? "50");
    const cursor = context.req.query("cursor");
    return context.json(
      await dependencies.audit.timeline({
        ownerId,
        limit,
        ...(cursor === undefined ? {} : { cursor }),
      }),
    );
  });
}
