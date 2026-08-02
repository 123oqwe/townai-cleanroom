const token = process.env.VERCEL_TOKEN;
const projectId = process.env.VERCEL_PROJECT_ID;
const teamId = process.env.VERCEL_TEAM_ID;

if (!token || !projectId) {
  throw new Error(
    "VERCEL_TOKEN and VERCEL_PROJECT_ID are required; credentials are never read from source files.",
  );
}

const query = teamId ? `?teamId=${encodeURIComponent(teamId)}` : "";
const response = await globalThis.fetch(
  `https://api.vercel.com/v9/projects/${encodeURIComponent(projectId)}${query}`,
  {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      ssoProtection: { deploymentType: "all" },
    }),
  },
);

const payload = await response.json();
if (!response.ok) {
  throw new Error(
    `Vercel protection update failed (${response.status}): ${payload?.error?.message ?? "unknown error"}`,
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
