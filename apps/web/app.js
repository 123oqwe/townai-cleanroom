/* global document, fetch, localStorage, location, sessionStorage */

const storageKeys = {
  base: "town.api.base",
  token: "town.api.token",
  intention: "town.focus.intention",
  thread: "town.harness.thread",
  session: "town.harness.session",
};
const state = {
  base: localStorage.getItem(storageKeys.base) || "http://localhost:3000",
  token: sessionStorage.getItem(storageKeys.token) || "",
  connected: false,
};
const $ = (selector) => document.querySelector(selector);

function formatDate(date) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}
function formatTime(date) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}
function setConnection(
  connected,
  label = connected ? "Connected" : "Connect API",
) {
  state.connected = connected;
  $("#connection-label").textContent = label;
  $("#top-status").textContent = connected ? "Live state" : "Local-first";
  $(".sidebar .status-dot").classList.toggle("is-live", connected);
  $(".live-indicator .status-dot").classList.toggle("is-live", connected);
  $("#signal-state").textContent = connected ? "Live" : "Not connected";
  $("#signal-state").classList.toggle("is-live", connected);
}
async function api(path, options = {}) {
  const response = await fetch(`${state.base.replace(/\/$/, "")}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${state.token}`,
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    },
  });
  if (!response.ok) {
    const error = new Error(`API returned ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return response.status === 204 ? null : response.json();
}
async function apiJson(path, body, headers = {}) {
  return api(path, { method: "POST", body: JSON.stringify(body), headers });
}
function renderMetrics(summary) {
  const entries = [
    ["Active work", summary.activeSessions],
    ["Queued runs", summary.queuedRuns],
    ["Needs approval", summary.pendingApprovals],
    ["Deliveries", summary.queuedDeliveries],
  ];
  $("#metrics").innerHTML = entries
    .map(
      ([label, value]) =>
        `<div class="metric-row"><span>${label}</span><strong>${Number(value).toLocaleString()}</strong></div>`,
    )
    .join("");
  $("#signal-foot").textContent =
    summary.failedRuns > 0
      ? `${summary.failedRuns} run${summary.failedRuns === 1 ? "" : "s"} need attention.`
      : "Everything is quiet right now.";
}
function renderTimeline(items) {
  if (!items?.length) {
    $("#timeline").innerHTML =
      '<div class="empty-timeline"><span class="timeline-line"></span><p>No run events yet.</p><small>Your durable work will appear here when the API is connected.</small></div>';
    return;
  }
  $("#timeline").innerHTML = `<span class="timeline-line"></span>${items
    .slice(0, 5)
    .map(
      (item) =>
        `<div class="timeline-event"><strong>${escapeHtml(item.action)}</strong><small>${escapeHtml(item.outcome)} · ${formatTime(new Date(item.createdAt))}</small></div>`,
    )
    .join("")}`;
}
function escapeHtml(value) {
  return String(value).replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;",
      })[character],
  );
}
function setHarnessState(text, tone = "") {
  $("#harness-state-text").textContent = text;
  $("#harness-state-text").classList.toggle("is-error", tone === "error");
}
function renderHarnessTurns(turns) {
  const transcript = $("#harness-transcript");
  if (!turns?.length) {
    transcript.innerHTML =
      '<p class="harness-empty">No turns in this thread yet.</p>';
    return;
  }
  transcript.innerHTML = turns
    .slice(-12)
    .map(
      (turn) =>
        `<div class="harness-message ${turn.role === "user" ? "user" : "assistant"}">${escapeHtml(turn.text)}</div>`,
    )
    .join("");
  transcript.scrollTop = transcript.scrollHeight;
}
function clearHarnessApproval() {
  $("#approval-card").hidden = true;
  $("#approval-card").dataset.approvalId = "";
  $("#approval-card").dataset.sessionId = "";
  $("#approval-card").dataset.runId = "";
}
async function ensureHarnessThread() {
  const savedThread = sessionStorage.getItem(storageKeys.thread);
  if (savedThread) return savedThread;
  let agent;
  try {
    agent = (await api("/v1/agents/personal")).agent;
  } catch (error) {
    if (error.status !== 404) throw error;
    agent = (
      await apiJson("/v1/agents/personal", {
        displayName: "Town personal",
        instructions:
          "Carry out the user's request carefully and explain durable state.",
        defaultApprovalMode: "respect_tool_setting",
        callableRoutineIds: [],
      })
    ).agent;
  }
  if (!agent) throw new Error("Personal agent is not available.");
  const thread = (
    await apiJson("/v1/threads", {
      title: "Town workspace",
      approvalMode: "respect_tool_setting",
    })
  ).thread;
  sessionStorage.setItem(storageKeys.thread, thread.id);
  return thread.id;
}
async function loadHarnessThreads(
  preferredId = sessionStorage.getItem(storageKeys.thread),
) {
  const page = await api("/v1/threads?kind=assistant&status=active&limit=50");
  const threads = page.items || [];
  if (threads.length === 0) {
    const created = await apiJson("/v1/threads", {
      title: "Town workspace",
      approvalMode: "respect_tool_setting",
    });
    threads.push(created.thread);
  }
  const selected =
    threads.find((thread) => thread.id === preferredId) || threads[0];
  sessionStorage.setItem(storageKeys.thread, selected.id);
  const select = $("#thread-select");
  select.innerHTML = threads
    .map(
      (thread) =>
        `<option value="${escapeHtml(thread.id)}">${escapeHtml(thread.title)}</option>`,
    )
    .join("");
  select.value = selected.id;
  return selected.id;
}
async function selectHarnessThread(threadId) {
  sessionStorage.setItem(storageKeys.thread, threadId);
  sessionStorage.removeItem(storageKeys.session);
  clearHarnessApproval();
  renderHarnessTurns(
    (await api(`/v1/threads/${threadId}/turns?limit=50`)).items,
  );
  setHarnessState("Ready for a durable turn.");
}
async function loadHarness() {
  if (!state.token) {
    setHarnessState("Connect the API to begin.");
    return;
  }
  try {
    await ensureHarnessThread();
    const threadId = await loadHarnessThreads();
    renderHarnessTurns(
      (await api(`/v1/threads/${threadId}/turns?limit=50`)).items,
    );
    setHarnessState("Ready for a durable turn.");
    const sessionId = sessionStorage.getItem(storageKeys.session);
    if (sessionId) await refreshHarnessRun(sessionId);
  } catch (error) {
    setHarnessState(
      error instanceof Error ? error.message : "Harness unavailable.",
      "error",
    );
  }
}
async function refreshHarnessRun(sessionId) {
  const [runs, events] = await Promise.all([
    api(`/v1/sessions/${sessionId}/runs?limit=10`),
    api(`/v1/sessions/${sessionId}/events?limit=50`),
  ]);
  const run = runs.items?.[0];
  if (!run) return;
  const event = [...(events.items || [])]
    .reverse()
    .find((item) => item.runId === run.id && item.kind === "run_waiting");
  if (run.state === "waiting_approval" && event?.payload?.approvalId) {
    const card = $("#approval-card");
    card.hidden = false;
    card.dataset.approvalId = event.payload.approvalId;
    card.dataset.sessionId = sessionId;
    card.dataset.runId = run.id;
    $("#approval-reason").textContent =
      event.payload.reason || "Approval is required before Town continues.";
    setHarnessState("Waiting for your approval.");
  } else {
    clearHarnessApproval();
    setHarnessState(`Run ${run.state.replaceAll("_", " ")}.`);
  }
  if (["queued", "running"].includes(run.state)) {
    window.setTimeout(
      () => refreshHarnessRun(sessionId).catch(() => undefined),
      1200,
    );
  }
}
async function sendHarnessMessage() {
  const input = $("#harness-input");
  const text = input.value.trim();
  if (!text || !state.token) return;
  const button = $("#harness-send");
  button.disabled = true;
  setHarnessState("Queueing durable turn…");
  try {
    const threadId = await loadHarnessThreads();
    const submission = await apiJson(
      `/v1/threads/${threadId}/messages`,
      { text, mentions: [] },
      {
        "Idempotency-Key": crypto.randomUUID(),
      },
    );
    sessionStorage.setItem(storageKeys.session, submission.session.id);
    input.value = "";
    renderHarnessTurns(
      (await api(`/v1/threads/${threadId}/turns?limit=50`)).items,
    );
    setHarnessState(`Run ${submission.run.state}.`);
    await refreshHarnessRun(submission.session.id);
    await refresh();
  } catch (error) {
    setHarnessState(
      error instanceof Error ? error.message : "Could not queue turn.",
      "error",
    );
  } finally {
    button.disabled = false;
  }
}
async function resolveHarnessApproval(decision) {
  const card = $("#approval-card");
  const { approvalId, sessionId, runId } = card.dataset;
  if (!approvalId || !sessionId || !runId) return;
  $("#approval-approve").disabled = true;
  $("#approval-reject").disabled = true;
  try {
    await apiJson(`/v1/sessions/${sessionId}/runs/${runId}/approval`, {
      approvalId,
      decision,
    });
    clearHarnessApproval();
    setHarnessState("Approval recorded. Resuming…");
    await refreshHarnessRun(sessionId);
  } catch (error) {
    setHarnessState(
      error instanceof Error ? error.message : "Approval failed.",
      "error",
    );
    $("#approval-approve").disabled = false;
    $("#approval-reject").disabled = false;
  }
}
function renderLibrarySearch(result) {
  const target = $("#library-results");
  if (!result.items?.length) {
    target.innerHTML =
      '<p class="harness-empty">No matching durable context.</p>';
    return;
  }
  target.innerHTML = result.items
    .map(
      (item) =>
        `<article class="library-result"><strong>${escapeHtml(item.title || item.resourceType)}</strong><p>${escapeHtml(item.text)}</p><small>${escapeHtml(item.resourceType)} · ${Math.round(item.score * 100)}% match</small></article>`,
    )
    .join("");
}
function renderLibraryContent(result) {
  const target = $("#library-content-list");
  const items = result.items || [];
  $("#library-count").textContent = `${items.length} saved`;
  if (!items.length) {
    target.innerHTML = '<p class="harness-empty">No saved content yet.</p>';
    return;
  }
  target.innerHTML = items
    .slice(0, 20)
    .map(
      (item) =>
        `<article class="library-content-item"><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.body || `Stored ${item.kind} content`)}</p><small>${escapeHtml(item.kind)} · ${escapeHtml(item.status)}</small></article>`,
    )
    .join("");
}
async function loadLibrary() {
  if (!state.token) {
    $("#library-results").innerHTML =
      '<p class="harness-empty">Connect the API to search your context.</p>';
    return;
  }
  try {
    const content = await api("/v1/content?status=active&limit=20");
    renderLibraryContent(content);
  } catch (error) {
    $("#library-content-list").innerHTML =
      `<p class="harness-empty">${escapeHtml(error instanceof Error ? error.message : "Library unavailable.")}</p>`;
  }
}
async function searchLibrary() {
  const query = $("#library-query").value.trim();
  if (!query || !state.token) return;
  const button = $("#library-search-button");
  button.disabled = true;
  $("#library-results").innerHTML =
    '<p class="harness-empty">Searching durable context…</p>';
  try {
    const params = new URLSearchParams({ q: query, limit: "20" });
    renderLibrarySearch(await api(`/v1/knowledge/search?${params.toString()}`));
  } catch (error) {
    $("#library-results").innerHTML =
      `<p class="harness-empty">${escapeHtml(error instanceof Error ? error.message : "Search unavailable.")}</p>`;
  } finally {
    button.disabled = false;
  }
}
async function refresh() {
  if (!state.token) {
    setConnection(false);
    return;
  }
  $("#signal-foot").textContent = "Reading live state…";
  try {
    const [summary, audit] = await Promise.all([
      api("/v1/operations/summary"),
      api("/v1/operations/audit?limit=5"),
    ]);
    renderMetrics(summary.summary);
    renderTimeline(audit.audit.items);
    setConnection(true);
  } catch (error) {
    setConnection(false, "Connection error");
    $("#signal-state").textContent = "Unavailable";
    $("#signal-foot").textContent =
      error instanceof Error ? error.message : "The API could not be reached.";
  }
}
function openDialog(dialog) {
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
}
function closeDialog(dialog) {
  dialog.close?.();
  dialog.removeAttribute("open");
}
$("#today-date").textContent = formatDate(new Date());
$("#connect-open").addEventListener("click", () => {
  $("#api-base").value = state.base;
  $("#api-token").value = state.token;
  $("#connect-error").hidden = true;
  openDialog($("#connect-dialog"));
});
$("#connect-form").addEventListener("submit", async (event) => {
  if (event.submitter?.value === "cancel") return;
  event.preventDefault();
  state.base = $("#api-base").value.trim().replace(/\/$/, "");
  state.token = $("#api-token").value.trim();
  try {
    await api("/v1/me");
    localStorage.setItem(storageKeys.base, state.base);
    sessionStorage.setItem(storageKeys.token, state.token);
    closeDialog($("#connect-dialog"));
    await refresh();
  } catch {
    $("#connect-error").textContent =
      "Could not authenticate. Check the API URL and token.";
    $("#connect-error").hidden = false;
  }
});
$("#refresh").addEventListener("click", refresh);
$("#intention-button").addEventListener("click", () => {
  $("#focus-empty").hidden = true;
  $("#intention-form").hidden = false;
  $("#intention").focus();
});
$("#intention-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const value = $("#intention").value.trim();
  if (!value) return;
  localStorage.setItem(storageKeys.intention, value);
  $("#intention-form").innerHTML =
    `<div class="focus-empty"><span class="focus-glyph">✦</span><p>${escapeHtml(value)}</p><button class="text-button" id="clear-intention" type="button">Change it <span>→</span></button></div>`;
  $("#clear-intention").addEventListener("click", () => location.reload());
});
$("#command-open").addEventListener("click", () => {
  openDialog($("#harness-dialog"));
  void loadHarness();
});
$("#people-button").addEventListener("click", () => {
  openDialog($("#harness-dialog"));
  void loadHarness();
});
$("#harness-send").addEventListener("click", () => void sendHarnessMessage());
$("#thread-select").addEventListener("change", (event) => {
  void selectHarnessThread(event.target.value);
});
$("#thread-new").addEventListener("click", async () => {
  try {
    const thread = (
      await apiJson("/v1/threads", {
        title: "New Town thread",
        approvalMode: "respect_tool_setting",
      })
    ).thread;
    await loadHarnessThreads(thread.id);
    await selectHarnessThread(thread.id);
  } catch (error) {
    setHarnessState(
      error instanceof Error ? error.message : "Could not create thread.",
      "error",
    );
  }
});
document
  .querySelector('.nav-item[href="#library"]')
  .addEventListener("click", (event) => {
    event.preventDefault();
    openDialog($("#library-dialog"));
    void loadLibrary();
  });
$("#library-search-button").addEventListener(
  "click",
  () => void searchLibrary(),
);
$("#library-query").addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    void searchLibrary();
  }
});
$("#approval-approve").addEventListener(
  "click",
  () => void resolveHarnessApproval("approve"),
);
$("#approval-reject").addEventListener(
  "click",
  () => void resolveHarnessApproval("reject"),
);
$("#harness-input").addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
    event.preventDefault();
    void sendHarnessMessage();
  }
});
const savedIntention = localStorage.getItem(storageKeys.intention);
if (savedIntention) {
  $("#focus-empty").innerHTML =
    `<span class="focus-glyph">✦</span><p>${escapeHtml(savedIntention)}</p><button class="text-button" id="clear-intention" type="button">Change it <span>→</span></button>`;
  $("#clear-intention").addEventListener("click", () => {
    localStorage.removeItem(storageKeys.intention);
    location.reload();
  });
}
setConnection(Boolean(state.token));
refresh();
