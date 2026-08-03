export interface VoiceSynthesisProvider {
  synthesize(input: {
    text: string;
    voiceId?: string;
  }): Promise<{ audio: Uint8Array; contentType: string }>;
}

export interface ElevenLabsVoiceProviderOptions {
  apiKey: string;
  voiceId: string;
  modelId?: string;
  endpoint?: string;
  fetchImpl?: typeof fetch;
}

export class VoiceProviderError extends Error {
  constructor(
    readonly code: "VOICE_PROVIDER_UNAVAILABLE" | "VOICE_PROVIDER_REJECTED",
    message: string,
  ) {
    super(message);
    this.name = "VoiceProviderError";
  }
}

/** Minimal ElevenLabs text-to-speech client; it never fabricates audio. */
export function createElevenLabsVoiceProvider(
  options: ElevenLabsVoiceProviderOptions,
): VoiceSynthesisProvider {
  const fetchImpl = options.fetchImpl ?? fetch;
  const endpoint =
    options.endpoint ?? "https://api.elevenlabs.io/v1/text-to-speech";
  const modelId = options.modelId ?? "eleven_multilingual_v2";
  return {
    async synthesize(input) {
      const response = await fetchImpl(
        `${endpoint}/${encodeURIComponent(input.voiceId ?? options.voiceId)}`,
        {
          method: "POST",
          headers: {
            accept: "audio/mpeg",
            "content-type": "application/json",
            "xi-api-key": options.apiKey,
          },
          body: JSON.stringify({
            text: input.text,
            model_id: modelId,
            output_format: "mp3_44100_128",
          }),
        },
      ).catch(() => {
        throw new VoiceProviderError(
          "VOICE_PROVIDER_UNAVAILABLE",
          "The voice provider could not be reached.",
        );
      });
      if (!response.ok) {
        throw new VoiceProviderError(
          response.status >= 500
            ? "VOICE_PROVIDER_UNAVAILABLE"
            : "VOICE_PROVIDER_REJECTED",
          "The voice provider rejected the synthesis request.",
        );
      }
      return {
        audio: new Uint8Array(await response.arrayBuffer()),
        contentType: response.headers.get("content-type") ?? "audio/mpeg",
      };
    },
  };
}
