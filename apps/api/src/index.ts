import { serve } from "@hono/node-server";
import { z } from "zod";

import { createApp } from "./app.js";

const environmentSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65_535).default(3_000),
});

const environment = environmentSchema.parse(process.env);

serve({
  fetch: createApp().fetch,
  port: environment.PORT,
});
