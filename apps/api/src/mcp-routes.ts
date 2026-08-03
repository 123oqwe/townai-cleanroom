import type { Hono } from "hono";
import { z } from "zod";
import { asId } from "@town/contracts";
import {
  executionModeSchema,
  mcpTransportSchema,
  type McpRepository,
} from "@town/tools";
import type { AuthVariables } from "./auth.js";
export function registerMcpRoutes(
  app: Hono<{ Variables: AuthVariables }>,
  repository: McpRepository,
): void {
  app.get("/v1/mcp-servers/bindings", async (c) => {
    const query = z
      .object({ agentVersionId: z.uuidv7() })
      .strict()
      .parse(c.req.query());
    return c.json({
      bindings: await repository.listForAgentVersion({
        ownerId: c.get("identity").user.id,
        agentVersionId: asId<"agent-version">(query.agentVersionId),
      }),
    });
  });
  app.get("/v1/mcp-servers", async (c) =>
    c.json({ servers: await repository.list(c.get("identity").user.id) }),
  );
  app.post("/v1/mcp-servers", async (c) => {
    const body = z
      .object({
        name: z.string().trim().min(1).max(120),
        url: z
          .url()
          .refine((v) => v.startsWith("http://") || v.startsWith("https://")),
        transport: mcpTransportSchema.default("streamable_http"),
        authRef: z.string().trim().min(1).max(500).nullable().optional(),
      })
      .strict()
      .parse(await c.req.json());
    return c.json(
      {
        server: await repository.create({
          ownerId: c.get("identity").user.id,
          ...body,
        }),
      },
      201,
    );
  });
  app.delete("/v1/mcp-servers/:serverId", async (c) => {
    const q = z
      .object({ expectedRevision: z.coerce.number().int().positive() })
      .strict()
      .parse(c.req.query());
    return c.json({
      server: await repository.disable(
        c.get("identity").user.id,
        asId<"mcp-server">(z.uuidv7().parse(c.req.param("serverId"))),
        q.expectedRevision,
      ),
    });
  });
  app.post("/v1/mcp-servers/:serverId/bindings", async (c) => {
    const body = z
      .object({
        agentVersionId: z.uuidv7(),
        modeOverride: executionModeSchema.nullable().optional(),
        accountScope: z.array(z.string().trim().min(1)).max(100).default([]),
      })
      .strict()
      .parse(await c.req.json());
    return c.json(
      {
        binding: await repository.bind({
          ownerId: c.get("identity").user.id,
          mcpServerId: asId<"mcp-server">(
            z.uuidv7().parse(c.req.param("serverId")),
          ),
          agentVersionId: asId<"agent-version">(body.agentVersionId),
          ...(body.modeOverride === undefined
            ? {}
            : { modeOverride: body.modeOverride }),
          accountScope: body.accountScope,
        }),
      },
      201,
    );
  });
  app.delete("/v1/mcp-server-bindings/:bindingId", async (c) => {
    const query = z
      .object({ expectedRevision: z.coerce.number().int().positive() })
      .strict()
      .parse(c.req.query());
    return c.json({
      binding: await repository.disableBinding(
        c.get("identity").user.id,
        asId<"mcp-server-binding">(z.uuidv7().parse(c.req.param("bindingId"))),
        query.expectedRevision,
      ),
    });
  });
}
