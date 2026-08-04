function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function layout(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} · Town clean-room</title><style> :root{color-scheme:light dark}body{font:16px/1.6 system-ui,-apple-system,sans-serif;max-width:760px;margin:0 auto;padding:48px 24px;color:#202124;background:#faf9f6}main{background:#fff;border:1px solid #e7e3dc;border-radius:20px;padding:32px;box-shadow:0 8px 30px #0000000d}h1{font-size:2rem;line-height:1.15;margin:0 0 8px}h2{font-size:1rem;color:#706b63;font-weight:500;margin:0 0 28px}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f5f3ef;border-radius:12px;padding:18px}dl{display:grid;grid-template-columns:max-content 1fr;gap:8px 20px;color:#706b63}dd{margin:0;color:inherit}@media(prefers-color-scheme:dark){body{color:#eee;background:#171717}main{background:#232323;border-color:#3b3b3b}pre{background:#171717}h2,dl{color:#aaa}}</style></head><body><main>${body}</main></body></html>`;
}

export function contentShareHtml(content: {
  title: string;
  kind: string;
  mimeType: string | null;
  body: string | null;
}): string {
  const body =
    content.body === null ? "No text body" : escapeHtml(content.body);
  return layout(
    content.title,
    `<p>Shared content</p><h1>${escapeHtml(content.title)}</h1><h2>${escapeHtml(content.kind)}${content.mimeType === null ? "" : ` · ${escapeHtml(content.mimeType)}`}</h2><pre>${body}</pre>`,
  );
}

export function routineShareHtml(share: {
  routine: { name: string; cron: string; timezone: string; enabled: boolean };
  version: {
    version: number;
    snapshot: {
      displayName: string;
      instructions: string;
      defaultApprovalMode: string;
      callableRoutineIds: string[];
    };
  };
}): string {
  const snapshot = share.version.snapshot;
  return layout(
    share.routine.name,
    `<p>Shared routine</p><h1>${escapeHtml(share.routine.name)}</h1><h2>Routine Agent · version ${escapeHtml(share.version.version)}</h2><dl><dt>Schedule</dt><dd>${escapeHtml(share.routine.cron)} (${escapeHtml(share.routine.timezone)})</dd><dt>Status</dt><dd>${share.routine.enabled ? "Enabled" : "Disabled"}</dd><dt>Approval</dt><dd>${escapeHtml(snapshot.defaultApprovalMode)}</dd></dl><h2>${escapeHtml(snapshot.displayName)}</h2><pre>${escapeHtml(snapshot.instructions)}</pre><p>This page is read-only. Install the routine from a signed share token in your Town workspace.</p>`,
  );
}

export function acceptsHtml(request: Request): boolean {
  return request.headers.get("accept")?.includes("text/html") ?? false;
}
