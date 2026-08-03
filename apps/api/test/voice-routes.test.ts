import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import type { AuthVariables } from "../src/auth.js";
import {
  createElevenLabsVoiceProvider,
  VoiceProviderError,
} from "../src/elevenlabs-voice.js";
import { registerVoiceRoutes } from "../src/voice-routes.js";

describe("ElevenLabs voice provider", () => {
  it("sends a real TTS request and returns audio bytes", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { "content-type": "audio/mpeg" },
        }),
    );
    const provider = createElevenLabsVoiceProvider({
      apiKey: "key",
      voiceId: "voice/default",
      endpoint: "https://voice.test/v1/text-to-speech",
      fetchImpl,
    });
    await expect(provider.synthesize({ text: "Hello" })).resolves.toMatchObject(
      {
        audio: new Uint8Array([1, 2, 3]),
        contentType: "audio/mpeg",
      },
    );
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://voice.test/v1/text-to-speech/voice%2Fdefault",
      expect.objectContaining({
        headers: expect.objectContaining({ "xi-api-key": "key" }),
        body: JSON.stringify({
          text: "Hello",
          model_id: "eleven_multilingual_v2",
          output_format: "mp3_44100_128",
        }),
      }),
    );
  });

  it("maps provider rejection and serves protected-route audio", async () => {
    const rejected = createElevenLabsVoiceProvider({
      apiKey: "key",
      voiceId: "voice",
      fetchImpl: vi.fn(async () => new Response("bad", { status: 400 })),
    });
    await expect(rejected.synthesize({ text: "Hello" })).rejects.toBeInstanceOf(
      VoiceProviderError,
    );
    const app = new Hono<{ Variables: AuthVariables }>();
    registerVoiceRoutes(app, {
      synthesize: vi.fn(async () => ({
        audio: new Uint8Array([9, 8]),
        contentType: "audio/mpeg",
      })),
    });
    const response = await app.request("http://town.test/v1/voice/synthesize", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "Hello" }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("audio/mpeg");
    await expect(response.arrayBuffer()).resolves.toEqual(
      new Uint8Array([9, 8]).buffer,
    );
  });
});
