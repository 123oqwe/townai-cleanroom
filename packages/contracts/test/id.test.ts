import { describe, expect, it } from "vitest";
import { validate as validateUuid, version as uuidVersion } from "uuid";
import { ZodError } from "zod";

import { asId, newId } from "../src/id.js";

describe("typed identifiers", () => {
  it("creates UUIDv7 identifiers", () => {
    const id = newId<"user">();

    expect(validateUuid(id)).toBe(true);
    expect(uuidVersion(id)).toBe(7);
  });

  it("accepts a valid UUIDv7 identifier", () => {
    const id = newId<"session">();

    expect(asId<"session">(id)).toBe(id);
  });

  it.each(["not-a-uuid", "550e8400-e29b-41d4-a716-446655440000", null, 42])(
    "rejects invalid or non-v7 value %j",
    (value) => {
      expect(() => asId<"user">(value)).toThrow(ZodError);
    },
  );
});
