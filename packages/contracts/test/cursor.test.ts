import { describe, expect, it } from "vitest";

import { decodeCursor, encodeCursor } from "../src/cursor.js";
import { newId } from "../src/id.js";

describe("opaque cursors", () => {
  it("round-trips a versioned cursor", () => {
    const cursor = {
      version: 1 as const,
      key: "2026-08-02T12:00:00.000Z",
      id: newId<"session">(),
    };

    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
  });

  it.each(["not-base64url!", Buffer.from("{bad json").toString("base64url")])(
    "rejects malformed cursor %s",
    (value) => {
      expect(() => decodeCursor(value)).toThrow();
    },
  );

  it("rejects unknown cursor versions", () => {
    const encoded = Buffer.from(
      JSON.stringify({ version: 2, key: "next", id: newId<"session">() }),
    ).toString("base64url");

    expect(() => decodeCursor(encoded)).toThrow();
  });
});
