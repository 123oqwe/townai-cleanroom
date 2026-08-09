import { z } from "zod";

export const environmentSchema = z.object({
  DATABASE_URL: z.string().url(),
  CREDENTIAL_MASTER_KEY_BASE64URL: z.string().min(1),
  ACCESS_ALLOWLIST_EMAILS: z.string().default(""),
  ADMIN_ALLOWLIST_EMAILS: z.string().default(""),
  RESPONSES_API_ENDPOINT: z
    .string()
    .url()
    .default("https://api.openai.com/v1/responses"),
  RESPONSES_MODEL: z.string().min(1).default("gpt-5"),
  RESPONSES_API_KEY: z.string().min(1).optional(),
  RESPONSES_FALLBACKS_JSON: z.string().default("[]"),
  CODEX_EXEC_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  CODEX_MODEL: z.string().min(1).optional(),
  CODEX_CLI_PATH: z.string().min(1).optional(),
  CODEX_SANDBOX_MODE: z
    .enum(["read-only", "workspace-write", "danger-full-access"])
    .default("read-only"),
  WEB_ORIGIN: z.string().url().default("http://localhost:4173"),
  CHANNEL_CREDENTIALS_JSON: z.string().default("{}"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3_000),
  WORKER_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  WORKER_BATCH_SIZE: z.coerce.number().int().min(1).max(100).default(10),
  WORKER_RETRY_MAX_ATTEMPTS: z.coerce.number().int().min(2).max(10).optional(),
  WORKER_RETRY_BASE_DELAY_MS: z.coerce
    .number()
    .int()
    .min(0)
    .max(3_600_000)
    .optional(),
  WORKER_SECRET: z.string().min(1).optional(),
  CRON_SECRET: z.string().min(1).optional(),
  SLACK_SIGNING_SECRET: z.string().min(1).optional(),
  TWILIO_AUTH_TOKEN: z.string().min(1).optional(),
  ELEVENLABS_API_KEY: z.string().min(1).optional(),
  ELEVENLABS_VOICE_ID: z.string().min(1).optional(),
  ELEVENLABS_MODEL_ID: z.string().min(1).default("eleven_multilingual_v2"),
  VAPI_WEBHOOK_SECRET: z.string().min(1).optional(),
  GOOGLE_OAUTH_CLIENT_ID: z.string().min(1).optional(),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().min(1).optional(),
  GOOGLE_OAUTH_REDIRECT_URI: z.string().url().optional(),
  GOOGLE_PUBSUB_TOPIC: z.string().min(1).optional(),
  GOOGLE_PUBSUB_VERIFICATION_TOKEN: z.string().min(1).optional(),
  MICROSOFT_OAUTH_CLIENT_ID: z.string().min(1).optional(),
  MICROSOFT_OAUTH_CLIENT_SECRET: z.string().min(1).optional(),
  MICROSOFT_OAUTH_REDIRECT_URI: z.string().url().optional(),
  TELEGRAM_SECRET_TOKEN: z.string().min(1).optional(),
  WHATSAPP_APP_SECRET: z.string().min(1).optional(),
  WHATSAPP_VERIFY_TOKEN: z.string().min(1).optional(),
  E2B_API_KEY: z.string().min(1).optional(),
  PIPEDREAM_API_URL: z
    .string()
    .url()
    .default("https://api.pipedream.com/v1/apps"),
  PIPEDREAM_API_KEY: z.string().min(1).optional(),
  WEB_SEARCH_ENDPOINT: z.string().url().optional(),
  WEB_SEARCH_API_KEY: z.string().min(1).optional(),
  BROWSER_AUTOMATION_ENDPOINT: z.string().url().optional(),
  BROWSER_AUTOMATION_API_KEY: z.string().min(1).optional(),
  CONTENT_STORAGE_ROOT: z.string().min(1).optional(),
  CONTENT_STORAGE_S3_ENDPOINT: z.string().url().optional(),
  CONTENT_STORAGE_S3_BUCKET: z.string().min(1).optional(),
  CONTENT_STORAGE_S3_REGION: z.string().min(1).optional(),
  CONTENT_STORAGE_S3_ACCESS_KEY_ID: z.string().min(1).optional(),
  CONTENT_STORAGE_S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  CODE_RUNNER_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  WORKSPACE_ROOT: z.string().min(1).optional(),
  RATE_LIMIT_WINDOW_MS: z.coerce
    .number()
    .int()
    .min(1_000)
    .max(3_600_000)
    .default(60_000),
  RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(10_000).default(60),
  RATE_LIMIT_BACKEND: z
    .enum(["memory", "db"])
    .default("memory")
    .transform((value) => value),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional(),
  // Phase 01A: production authentication (Google OIDC login).
  AUTH_GOOGLE_CLIENT_ID: z.string().min(1).optional(),
  AUTH_GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
  AUTH_GOOGLE_REDIRECT_URI: z.string().url().optional(),
  AUTH_BFF_SHARED_SECRET: z.string().min(1).optional(),
  AUTH_FLOW_ENCRYPTION_KEY_BASE64URL: z.string().min(1).optional(),
  AUTH_ALLOWED_ORIGINS: z.string().min(1).optional(),
  AUTH_SIGNUP_MODE: z.enum(["allowlist", "open"]).default("allowlist"),
  DEV_EMAIL_LOGIN_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  INTERNAL_API_BASE_URL: z.string().url().optional(),
  AUTH_SESSION_IDLE_TTL_MS: z.coerce
    .number()
    .int()
    .min(60_000)
    .default(15 * 60 * 1_000),
  AUTH_SESSION_ABSOLUTE_TTL_MS: z.coerce
    .number()
    .int()
    .min(3_600_000)
    .default(7 * 24 * 60 * 60 * 1_000),
});

export type Environment = z.infer<typeof environmentSchema>;

export const environment = environmentSchema.parse(process.env);
