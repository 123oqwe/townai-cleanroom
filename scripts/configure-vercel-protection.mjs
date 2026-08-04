const token = process.env.VERCEL_TOKEN;
const projectId = process.env.VERCEL_PROJECT_ID;
const teamId = process.env.VERCEL_TEAM_ID;

if (!token || !projectId) {
  throw new Error(
    "VERCEL_TOKEN and VERCEL_PROJECT_ID are required; credentials are never read from source files.",
  );
}

const query = teamId ? `?teamId=${encodeURIComponent(teamId)}` : "";
const baseUrl = `https://api.vercel.com/v9/projects/${encodeURIComponent(projectId)}${query}`;

// Attempt "all" first; fall back to "all_except_custom_domains" when the
// team plan does not include production SSO (Pro vs Enterprise).
const protectionLevels = ["all", "all_except_custom_domains"];

let payload;
for (const level of protectionLevels) {
  const response = await globalThis.fetch(baseUrl, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      ssoProtection: { deploymentType: level },
    }),
  });

  payload = await response.json();
  if (response.ok) break;

  const message = payload?.error?.message ?? "unknown error";
  if (level === "all" && (response.status === 400 || response.status === 428)) {
    console.error(`SSO "all" rejected (${message}); falling back.`);
    continue;
  }
  throw new Error(
    `Vercel protection update failed (${response.status}): ${message}`,
  );
}

console.log(
  JSON.stringify(
    {
      projectId: payload.id,
      projectName: payload.name,
      deploymentType: payload.ssoProtection?.deploymentType ?? null,
    },
    null,
    2,
  ),
);
