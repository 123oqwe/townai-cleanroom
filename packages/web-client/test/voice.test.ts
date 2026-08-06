import { describe, expect, it, vi } from "vitest";

import { TownClient } from "../src/index.js";

type FetchCall = {
  url: string;
  init: RequestInit & { headers: Record<string, string> };
};

function makeClient(
  responses: Response[],
  calls: FetchCall[],
  options: { token?: string } = {},
): TownClient {
  const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({
      url,
      init: { ...init, headers: (init.headers ?? {}) as Record<string, string> },
    });
    const response = responses.shift();
    if (response === undefined) throw new Error("no mock response queued");
    return response;
  }) as unknown as typeof globalThis.fetch;
  return new TownClient({
    baseUrl: "https://api.example.test",
    ...(options.token === undefined ? {} : { token: options.token }),
    fetch: fetchImpl,
  });
}

describe("TownClient voice namespace", () => {
  it("synthesizes audio via POST /v1/voice/synthesize returning a Blob", async () => {
    const calls: FetchCall[] = [];
    const audioData = new Uint8Array([0x49, 0x44, 0x33]);
    const client = makeClient(
      [
        new Response(audioData, {
          status: 200,
          headers: { "content-type": "audio/mpeg" },
        }),
      ],
      calls,
      { token: "t" },
    );

    const blob = await client.voice.synthesize({ text: "Hello world" });

    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBe(3);
    expect(calls[0]?.init.method).toBe("POST");
    expect(calls[0]?.url).toContain("/v1/voice/synthesize");
    const body = JSON.parse(calls[0]?.init.body as string);
    expect(body.text).toBe("Hello world");
  });
});
