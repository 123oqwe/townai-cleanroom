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

function inspectFlowKey(value) {
  if (!value) return "missing";
  try {
    const decoded = Buffer.from(value, "base64url");
    return decoded.length === 32 ? "configured" : "invalid";
  } catch {
    return "invalid";
  }
}

function inspectJsonObject(name, value) {
  if (!value) return { name, status: "missing" };
  try {
    const parsed = JSON.parse(value);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed))
      return { name, status: "invalid" };
    for (const [entryKey, entryValue] of Object.entries(parsed)) {
      if (typeof entryKey !== "string" || entryKey.length < 1)
        return { name, status: "invalid" };
      if (typeof entryValue !== "string" || entryValue.length < 1)
        return { name, status: "invalid" };
    }
    return { name, status: "configured" };
  } catch {
    return { name, status: "invalid" };
  }
}

function inspectOptionalStorageConfig(environment = process.env) {
  const storageRoot = environment.CONTENT_STORAGE_ROOT;
  const s3Fields = [
    {
      name: "CONTENT_STORAGE_S3_ENDPOINT",
      value: environment.CONTENT_STORAGE_S3_ENDPOINT,
    },
    {
      name: "CONTENT_STORAGE_S3_BUCKET",
      value: environment.CONTENT_STORAGE_S3_BUCKET,
    },
    {
      name: "CONTENT_STORAGE_S3_REGION",
      value: environment.CONTENT_STORAGE_S3_REGION,
    },
    {
      name: "CONTENT_STORAGE_S3_ACCESS_KEY_ID",
      value: environment.CONTENT_STORAGE_S3_ACCESS_KEY_ID,
    },
    {
      name: "CONTENT_STORAGE_S3_SECRET_ACCESS_KEY",
      value: environment.CONTENT_STORAGE_S3_SECRET_ACCESS_KEY,
    },
  ];
  const hasRoot = storageRoot !== undefined;
  const hasAnyS3 = s3Fields.some(({ value }) => value !== undefined);
  const hasAllS3 = s3Fields.every(({ value }) => value !== undefined);

  if (hasRoot && hasAnyS3) {
    return [
      { name: "CONTENT_STORAGE_ROOT", status: "invalid" },
      ...s3Fields.map(({ name, value }) => ({
        name,
        status: value === undefined ? "missing" : "invalid",
      })),
    ];
  }

  if (!hasRoot && hasAnyS3 && !hasAllS3) {
    return [
      { name: "CONTENT_STORAGE_ROOT", status: "missing" },
      ...s3Fields.map(({ name, value }) => ({
        name,
        status: value === undefined ? "missing" : "invalid",
      })),
    ];
  }

  return [
    {
      name: "CONTENT_STORAGE_ROOT",
      status: hasRoot ? "configured" : "missing",
    },
    ...s3Fields.map(({ name, value }) => ({
      name,
      status: value === undefined ? "missing" : "configured",
    })),
  ];
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
    // Phase 01A: production authentication (Google OIDC login).
    inspectEnvVar("AUTH_GOOGLE_CLIENT_ID", environment.AUTH_GOOGLE_CLIENT_ID),
    inspectEnvVar(
      "AUTH_GOOGLE_CLIENT_SECRET",
      environment.AUTH_GOOGLE_CLIENT_SECRET,
    ),
    {
      name: "AUTH_GOOGLE_REDIRECT_URI",
      status: inspectUrl(
        "AUTH_GOOGLE_REDIRECT_URI",
        environment.AUTH_GOOGLE_REDIRECT_URI,
      ).status,
    },
    inspectEnvVar("AUTH_BFF_SHARED_SECRET", environment.AUTH_BFF_SHARED_SECRET),
    {
      name: "AUTH_FLOW_ENCRYPTION_KEY_BASE64URL",
      status: inspectFlowKey(environment.AUTH_FLOW_ENCRYPTION_KEY_BASE64URL),
    },
    inspectEnvVar("AUTH_ALLOWED_ORIGINS", environment.AUTH_ALLOWED_ORIGINS),
    {
      name: "AUTH_SIGNUP_MODE",
      status: environment.AUTH_SIGNUP_MODE ? "configured" : "missing",
    },
    {
      name: "DEV_EMAIL_LOGIN_ENABLED",
      status: environment.DEV_EMAIL_LOGIN_ENABLED ? "configured" : "disabled",
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
    ...inspectOptionalStorageConfig(environment),
  ];
  const missingRequired = checks
    .filter(
      ({ name, status }) => required.includes(name) && status !== "configured",
    )
    .map(({ name }) => name);
  const productionAuthErrors = [];
  if (environment.NODE_ENV === "production") {
    if (environment.DEV_EMAIL_LOGIN_ENABLED === "true") {
      productionAuthErrors.push(
        "DEV_EMAIL_LOGIN_ENABLED=true is forbidden in production",
      );
    }
    for (const name of [
      "AUTH_GOOGLE_CLIENT_ID",
      "AUTH_GOOGLE_CLIENT_SECRET",
      "AUTH_GOOGLE_REDIRECT_URI",
      "AUTH_BFF_SHARED_SECRET",
      "AUTH_FLOW_ENCRYPTION_KEY_BASE64URL",
      "AUTH_ALLOWED_ORIGINS",
    ]) {
      if (!environment[name]) {
        productionAuthErrors.push(
          `Missing required production auth var: ${name}`,
        );
      }
    }
    if (
      environment.AUTH_ALLOWED_ORIGINS &&
      environment.AUTH_ALLOWED_ORIGINS.includes("*")
    ) {
      productionAuthErrors.push("AUTH_ALLOWED_ORIGINS must not be a wildcard");
    }
  }
  return { checks, missingRequired, productionAuthErrors };
}

const isMain =
  process.argv[1] !== undefined &&
  import.meta.url === new URL(process.argv[1], "file://").href;
if (isMain) {
  const result = inspectRuntimeConfig();
  console.log(JSON.stringify(result, null, 2));
  if (
    process.argv.includes("--strict") &&
    (result.missingRequired.length > 0 ||
      (result.productionAuthErrors && result.productionAuthErrors.length > 0))
  ) {
    process.exitCode = 1;
  }
}
