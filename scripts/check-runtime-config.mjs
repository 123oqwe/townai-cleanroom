/* global URL */

import { Buffer } from "node:buffer";

const required = [
  "DATABASE_URL",
  "CREDENTIAL_MASTER_KEY_BASE64URL",
  "WEB_ORIGIN",
];

function inspectUrl(name, value) {
  if (!value) return { name, status: "missing" };
  try {
    const url = new URL(value);
    if (
      name === "DATABASE_URL" &&
      !["postgres:", "postgresql:"].includes(url.protocol)
    )
      return { name, status: "invalid" };
    return { name, status: "configured" };
  } catch {
    return { name, status: "invalid" };
  }
}

function inspectCredentialKey(value) {
  if (!value)
    return { name: "CREDENTIAL_MASTER_KEY_BASE64URL", status: "missing" };
  try {
    const decoded = Buffer.from(value, "base64url");
    return {
      name: "CREDENTIAL_MASTER_KEY_BASE64URL",
      status: decoded.length === 32 ? "configured" : "invalid",
    };
  } catch {
    return { name: "CREDENTIAL_MASTER_KEY_BASE64URL", status: "invalid" };
  }
}

function inspectJsonObject(name, value) {
  if (!value) return { name, status: "missing" };
  try {
    const parsed = JSON.parse(value);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed))
      return { name, status: "invalid" };
    for (const [entryKey, entryValue] of Object.entries(parsed)) {
      if (typeof entryKey !== "string" || entryKey.length < 1) return { name, status: "invalid" };
      if (typeof entryValue !== "string" || entryValue.length < 1)
        return { name, status: "invalid" };
    }
    return { name, status: "configured" };
  } catch {
    return { name, status: "invalid" };
  }
}

function inspectEnvVar(name, value) {
  return { name, status: value ? "configured" : "missing" };
}

export function inspectRuntimeConfig(environment = process.env) {
  const checks = [
    inspectUrl("DATABASE_URL", environment.DATABASE_URL),
    inspectCredentialKey(environment.CREDENTIAL_MASTER_KEY_BASE64URL),
    inspectUrl("WEB_ORIGIN", environment.WEB_ORIGIN),
    {
      name: "RESPONSES_API_KEY",
      status: environment.RESPONSES_API_KEY ? "configured" : "missing",
    },
    {
      name: "ACCESS_ALLOWLIST_EMAILS",
      status: environment.ACCESS_ALLOWLIST_EMAILS ? "configured" : "empty",
    },
    {
      name: "ADMIN_ALLOWLIST_EMAILS",
      status: environment.ADMIN_ALLOWLIST_EMAILS ? "configured" : "empty",
    },
    {
      name: "WORKER_SECRET_OR_CRON_SECRET",
      status:
        environment.WORKER_SECRET || environment.CRON_SECRET
          ? "configured"
          : "missing",
    },
    inspectEnvVar("SLACK_SIGNING_SECRET", environment.SLACK_SIGNING_SECRET),
    inspectEnvVar("TWILIO_AUTH_TOKEN", environment.TWILIO_AUTH_TOKEN),
    inspectEnvVar("VAPI_WEBHOOK_SECRET", environment.VAPI_WEBHOOK_SECRET),
    inspectEnvVar("ELEVENLABS_API_KEY", environment.ELEVENLABS_API_KEY),
    inspectEnvVar("ELEVENLABS_VOICE_ID", environment.ELEVENLABS_VOICE_ID),
    inspectEnvVar("GOOGLE_OAUTH_CLIENT_ID", environment.GOOGLE_OAUTH_CLIENT_ID),
    inspectEnvVar(
      "GOOGLE_OAUTH_CLIENT_SECRET",
      environment.GOOGLE_OAUTH_CLIENT_SECRET,
    ),
    {
      name: "GOOGLE_OAUTH_REDIRECT_URI",
      status: inspectUrl(
        "GOOGLE_OAUTH_REDIRECT_URI",
        environment.GOOGLE_OAUTH_REDIRECT_URI,
      ).status,
    },
    inspectJsonObject(
      "CHANNEL_CREDENTIALS_JSON",
      environment.CHANNEL_CREDENTIALS_JSON,
    ),
  ];
  const missingRequired = checks
    .filter(
      ({ name, status }) => required.includes(name) && status !== "configured",
    )
    .map(({ name }) => name);
  return { checks, missingRequired };
}

const isMain =
  process.argv[1] !== undefined &&
  import.meta.url === new URL(process.argv[1], "file://").href;
if (isMain) {
  const result = inspectRuntimeConfig();
  console.log(JSON.stringify(result, null, 2));
  if (process.argv.includes("--strict") && result.missingRequired.length > 0) {
    process.exitCode = 1;
  }
}
