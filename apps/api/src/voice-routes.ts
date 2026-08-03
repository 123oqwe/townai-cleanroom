import type { Hono } from "hono";
import { z } from "zod";
import type { AuthVariables } from "./auth.js";
import {
  VoiceProviderError,
  type VoiceSynthesisProvider,
} from "./elevenlabs-voice.js";

const synthesizeSchema = z
  .object({
    text: z.string().trim().min(1).max(5_000),
    voiceId: z.string().trim().min(1).max(200).optional(),
  })
  .strict();

export function registerVoiceRoutes(
  app: Hono<{ Variables: AuthVariables }>,
  provider: VoiceSynthesisProvider,
): void {
  app.post("/v1/voice/synthesize", async (context) => {
    const input = synthesizeSchema.parse(await context.req.json());
    try {
      const result = await provider.synthesize({
        text: input.text,
        ...(input.voiceId === undefined ? {} : { voiceId: input.voiceId }),
      });
      return new Response(result.audio, {
        status: 200,
        headers: {
          "content-type": result.contentType,
          "cache-control": "no-store",
        },
      });
    } catch (error) {
      if (error instanceof VoiceProviderError)
        return context.json(
          { code: error.code },
          error.code === "VOICE_PROVIDER_UNAVAILABLE" ? 503 : 502,
        );
      throw error;
    }
  });
}
