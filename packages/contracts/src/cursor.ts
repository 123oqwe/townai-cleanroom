import { z } from "zod";

import { idSchema } from "./id.js";

const cursorSchema = z
  .object({
    version: z.literal(1),
    key: z.string().min(1),
    id: idSchema,
  })
  .strict();

const encodedCursorSchema = z
  .string()
  .min(1)
  .regex(/^[A-Za-z0-9_-]+$/);

export type Cursor = z.infer<typeof cursorSchema>;

export function encodeCursor(value: Cursor): string {
  const cursor = cursorSchema.parse(value);
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeCursor(value: unknown): Cursor {
  const encoded = encodedCursorSchema.parse(value);
  const decoded: unknown = JSON.parse(
    Buffer.from(encoded, "base64url").toString("utf8"),
  );
  return cursorSchema.parse(decoded);
}
