/* global URLSearchParams, crypto, document, fetch, localStorage, location, navigator, sessionStorage, window */

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
  profileRevision: null,
  agentRevision: null,
  agentVersionId: null,
  agentCallableRoutineIds: [],
  operationsCursor: null,
  suggestionsCursor: null,
  scheduleItems: [],
  scheduleCalendars: new Map(),
  scheduleCalendarErrors: [],
  scheduleCalendarVisibility: new Map(),
  selectedSquareId: null,
  people: [],
  selectedPersonId: null,
  squarePolicyRevision: null,
  libraryContent: [],
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
function renderSchedule(result) {
  state.scheduleItems = result.items || [];
  const calendars = new Map(
    state.scheduleItems
      .filter((item) => item.kind === "calendar" && item.calendarId)
      .map((item) => [item.calendarId, item.calendarName || item.calendarId]),
  );
  for (const calendarId of calendars.keys()) {
    if (!state.scheduleCalendarVisibility.has(calendarId))
      state.scheduleCalendarVisibility.set(calendarId, true);
  }
  state.scheduleCalendars = calendars;
  state.scheduleCalendarErrors = result.calendarErrors || [];
  renderScheduleItems();
}
function renderScheduleItems(
  calendarErrors = state.scheduleCalendarErrors,
  calendars = state.scheduleCalendars,
) {
  const target = $("#schedule-list");
  const items = state.scheduleItems.filter(
    (item) =>
      item.kind !== "calendar" ||
      item.calendarId === undefined ||
      state.scheduleCalendarVisibility.get(item.calendarId) !== false,
  );
  const filters = calendars.size
    ? `<div class="schedule-filters" role="group" aria-label="Calendars">${[
        ...calendars,
      ]
        .map(
          ([id, name]) =>
            `<button class="schedule-filter ${state.scheduleCalendarVisibility.get(id) ? "is-active" : ""}" data-calendar-id="${escapeHtml(id)}" type="button" aria-pressed="${state.scheduleCalendarVisibility.get(id) ? "true" : "false"}">${escapeHtml(name)}</button>`,
        )
        .join("")}</div>`
    : "";
  target.innerHTML =
    filters +
    (items.length
      ? items
          .map(
            (item) =>
              `<div class="schedule-row"><div><span class="schedule-kind">${escapeHtml(item.kind)}</span><strong>${escapeHtml(item.title)}</strong></div><time>${escapeHtml(formatDate(new Date(item.startAt)))} · ${escapeHtml(formatTime(new Date(item.startAt)))}</time></div>`,
          )
          .join("")
      : '<p class="harness-empty">Nothing scheduled for the selected calendars.</p>');
  if (calendarErrors.length > 0) {
    target.insertAdjacentHTML(
      "beforeend",
      '<p class="schedule-note">Some connected calendars could not be read.</p>',
    );
  }
}
async function loadSchedule() {
  if (!state.token) {
    state.scheduleItems = [];
    state.scheduleCalendars = new Map();
    state.scheduleCalendarErrors = [];
    state.scheduleCalendarVisibility.clear();
    $("#schedule-list").innerHTML =
      '<p class="harness-empty">Connect the API to see your schedule.</p>';
    return;
  }
  try {
    renderSchedule(await api("/v1/schedule?limit=12"));
  } catch (error) {
    state.scheduleItems = [];
    state.scheduleCalendars = new Map();
    state.scheduleCalendarErrors = [];
    state.scheduleCalendarVisibility.clear();
    $("#schedule-list").innerHTML =
      `<p class="harness-empty">${escapeHtml(error instanceof Error ? error.message : "Schedule unavailable.")}</p>`;
  }
}
function renderOperations(items, append = false) {
  const target = $("#operations-list");
  const html = (items || [])
    .map(
      (item) =>
        `<article class="operations-event"><div><strong>${escapeHtml(item.action)}</strong><small>${escapeHtml(item.resourceType)}${item.resourceId ? ` · ${escapeHtml(item.resourceId.slice(0, 8))}` : ""} · ${formatTime(new Date(item.createdAt))}</small></div><span class="operations-outcome ${item.outcome === "failed" ? "is-failed" : ""}">${escapeHtml(item.outcome)}</span></article>`,
    )
    .join("");
  if (!append) target.innerHTML = "";
  if (html) target.insertAdjacentHTML("beforeend", html);
  if (!items?.length && !append)
    target.innerHTML =
      '<p class="harness-empty">No audit events recorded yet.</p>';
}
async function loadOperations(append = false) {
  if (!state.token) {
    $("#operations-list").innerHTML =
      '<p class="harness-empty">Connect the API to load the audit trail.</p>';
    return;
  }
  const error = $("#operations-error");
  error.hidden = true;
  const params = new URLSearchParams({ limit: "30" });
  const outcome = $("#operations-outcome").value;
  if (outcome) params.set("outcome", outcome);
  if (append && state.operationsCursor)
    params.set("cursor", state.operationsCursor);
  try {
    const result = await api(`/v1/operations/audit?${params.toString()}`);
    renderOperations(result.audit.items, append);
    state.operationsCursor = result.audit.nextCursor;
    $("#operations-more").hidden = !state.operationsCursor;
  } catch (cause) {
    error.textContent =
      cause instanceof Error ? cause.message : "Audit trail unavailable.";
    error.hidden = false;
  }
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
function renderKnowledgeConflicts(result) {
  const conflicts = result.conflicts || [];
  $("#knowledge-conflict-count").textContent = `${conflicts.length}`;
  $("#knowledge-conflicts").hidden = !conflicts.length;
  $("#knowledge-conflict-list").innerHTML = conflicts.length
    ? conflicts
        .map(
          (conflict) =>
            `<article class="knowledge-conflict-card" data-conflict-id="${escapeHtml(conflict.id)}" data-revision="${escapeHtml(conflict.currentRevision)}"><div><strong>${escapeHtml(conflict.resourceType)} · ${escapeHtml(conflict.resourceId.slice(0, 8))}</strong><small>base ${escapeHtml(conflict.baseRevision)} → current ${escapeHtml(conflict.currentRevision)} · ${escapeHtml(conflict.proposedAuthorType)}</small><pre>${escapeHtml(JSON.stringify(conflict.proposedSnapshot, null, 2))}</pre></div><div class="knowledge-conflict-actions"><button class="quiet-button knowledge-conflict-reject" type="button">Reject</button><button class="primary-button knowledge-conflict-accept" type="button">Accept</button></div></article>`,
        )
        .join("")
    : '<p class="harness-empty">No pending conflicts.</p>';
}
async function resolveKnowledgeConflict(card, resolution) {
  try {
    await api(`/v1/knowledge/conflicts/${card.dataset.conflictId}/resolve`, {
      method: "POST",
      body: JSON.stringify({
        expectedRevision: Number(card.dataset.revision),
        resolution,
      }),
    });
    await loadLibrary();
  } catch (cause) {
    const error = $("#knowledge-conflict-error");
    error.textContent =
      cause instanceof Error ? cause.message : "Could not resolve conflict.";
    error.hidden = false;
  }
}
function renderLibraryContent(result, append = false) {
  const target = $("#library-content-list");
  const items = result.items || [];
  state.libraryContent = append
    ? [...(state.libraryContent || []), ...items]
    : items;
  const existing = append
    ? target.querySelectorAll(".library-content-item").length
    : 0;
  $("#library-count").textContent = `${existing + items.length} saved`;
  if (!items.length && !append) {
    target.innerHTML = '<p class="harness-empty">No saved content yet.</p>';
    return;
  }
  const html = items
    .slice(0, 20)
    .map(
      (item) =>
        `<article class="library-content-item" data-content-id="${escapeHtml(item.id)}"><div><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.body || `Stored ${item.kind} content`)}</p><small>${escapeHtml(item.kind)} · ${escapeHtml(item.status)}</small></div><div class="content-actions"><button class="quiet-button content-edit-button" type="button">Edit</button><button class="quiet-button content-history-button" type="button">History</button><button class="quiet-button content-share-button" type="button">Share</button><button class="quiet-button content-archive-button" type="button">Archive</button></div></article>`,
    )
    .join("");
  if (append) target.insertAdjacentHTML("beforeend", html);
  else target.innerHTML = html;
}
async function editContent(card) {
  if (!card || card.querySelector(".content-edit-form")) return;
  try {
    const result = await api(`/v1/content/${card.dataset.contentId}`);
    const content = result.content;
    card._contentDetail = content;
    const form = document.createElement("div");
    form.className = "content-edit-form";
    form.innerHTML = `<input class="content-edit-title" maxlength="500" value="${escapeHtml(content.title)}"/><textarea class="content-edit-body" rows="4" maxlength="200000">${escapeHtml(content.body || "")}</textarea><button class="quiet-button content-edit-save" type="button">Save edit</button>`;
    card.append(form);
  } catch (cause) {
    const error = document.createElement("p");
    error.className = "harness-empty";
    error.textContent =
      cause instanceof Error ? cause.message : "Could not load content.";
    card.append(error);
  }
}
async function saveContentEdit(card) {
  const content = card?._contentDetail;
  if (!card || !content) return;
  const title = card.querySelector(".content-edit-title").value.trim();
  const body = card.querySelector(".content-edit-body").value;
  await api(`/v1/content/${content.id}`, {
    method: "PATCH",
    body: JSON.stringify({
      expectedRevision: content.currentRevision,
      title,
      mimeType: content.mimeType,
      storageKey: content.storageKey,
      body,
      metadata: content.metadata,
    }),
  });
  await loadLibrary();
}
async function archiveContent(card) {
  if (!card?.dataset.contentId) return;
  const button = card.querySelector(".content-archive-button");
  button.disabled = true;
  try {
    await api(`/v1/content/${card.dataset.contentId}/archive`, {
      method: "POST",
    });
    await loadLibrary();
  } catch (cause) {
    const error = document.createElement("p");
    error.className = "harness-empty content-archive-error";
    error.textContent =
      cause instanceof Error ? cause.message : "Could not archive content.";
    card.append(error);
    button.disabled = false;
  }
}
async function loadContentHistory(card) {
  const contentId = card.dataset.contentId;
  if (!contentId || !state.token) return;
  const existing = card.querySelector(".content-history");
  if (existing) {
    existing.remove();
    return;
  }
  try {
    const result = await api(`/v1/content/${contentId}/revisions`);
    const history = document.createElement("div");
    history.className = "content-history";
    history.innerHTML = (result.revisions || [])
      .map(
        (revision) =>
          `<div><strong>Revision ${escapeHtml(revision.revision)}</strong><small>${escapeHtml(new Date(revision.createdAt).toLocaleString())}</small><p>${escapeHtml(revision.body || revision.storageKey || "No inline body")}</p></div>`,
      )
      .join("");
    card.append(history);
  } catch (cause) {
    const error = document.createElement("p");
    error.className = "harness-empty content-history-error";
    error.textContent =
      cause instanceof Error ? cause.message : "History unavailable.";
    card.append(error);
  }
}
async function saveContent() {
  const title = $("#content-title").value.trim();
  const error = $("#content-error");
  if (!title || !state.token) {
    error.textContent = "Title is required.";
    error.hidden = false;
    return;
  }
  try {
    await apiJson("/v1/content", {
      kind: $("#content-kind").value,
      title,
      body: $("#content-body").value || null,
      mimeType: $("#content-mime-type").value.trim() || null,
      storageKey: $("#content-storage-key").value.trim() || null,
      metadata: {},
    });
    $("#content-title").value = "";
    $("#content-body").value = "";
    $("#content-mime-type").value = "";
    $("#content-storage-key").value = "";
    $("#content-add-form").hidden = true;
    error.hidden = true;
    await loadLibrary();
  } catch (cause) {
    error.textContent =
      cause instanceof Error ? cause.message : "Could not save content.";
    error.hidden = false;
  }
}
let libraryContentCursor = null;
async function loadMoreLibraryContent() {
  if (!state.token || !libraryContentCursor) return;
  const button = $("#library-content-more");
  button.disabled = true;
  try {
    const result = await api(
      `/v1/content?status=active&limit=20&cursor=${encodeURIComponent(libraryContentCursor)}`,
    );
    renderLibraryContent(result, true);
    libraryContentCursor = result.nextCursor;
    button.hidden = !libraryContentCursor;
  } finally {
    button.disabled = false;
  }
}
async function createContentShare(contentId, card) {
  if (!contentId || !state.token) return;
  const button = card.querySelector(".content-share-button");
  button.disabled = true;
  try {
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const result = await apiJson(`/v1/content/${contentId}/shares`, {
      expiresAt,
    });
    const url = `${state.base.replace(/\/$/, "")}/v1/content-shares/${result.token}`;
    $("#content-share-url").value = url;
    $("#content-share-status").dataset.shareId = result.share.id;
    $("#content-share-status").hidden = false;
    $("#content-share-copy").textContent = "Copy";
  } catch (cause) {
    $("#library-content-list").insertAdjacentHTML(
      "afterbegin",
      `<p class="harness-empty content-share-error">${escapeHtml(cause instanceof Error ? cause.message : "Could not create share link.")}</p>`,
    );
  } finally {
    button.disabled = false;
  }
}
function renderMemories(result) {
  const target = $("#memory-list");
  const memories = (result.memories || []).filter(
    (memory) => memory.status === "active",
  );
  $("#memory-count").textContent = `${memories.length} active`;
  if (!memories.length) {
    target.innerHTML = '<p class="harness-empty">No active memories yet.</p>';
    return;
  }
  target.innerHTML = memories
    .slice(0, 20)
    .map(
      (memory) =>
        `<article class="memory-card" data-memory-id="${escapeHtml(memory.id)}" data-revision="${escapeHtml(memory.currentRevision)}" data-scope="${escapeHtml(memory.scope)}" data-routine-id="${escapeHtml(memory.routineId || "")}"><p class="memory-copy">${escapeHtml(memory.content)}</p><small>${escapeHtml(memory.scope)} · ${memory.confidence === null ? "confidence not set" : `confidence ${Math.round(memory.confidence * 100)}%`}</small><div class="memory-actions"><button class="quiet-button memory-edit" type="button">Edit</button><button class="quiet-button memory-retire" type="button">Retire</button></div><div class="memory-edit-form" hidden><textarea class="memory-edit-content" rows="3" maxlength="50000">${escapeHtml(memory.content)}</textarea><input class="memory-edit-confidence" type="number" min="0" max="1" step="0.05" value="${memory.confidence ?? ""}" placeholder="Confidence"/><button class="quiet-button memory-edit-save" type="button">Save</button></div></article>`,
    )
    .join("");
}
async function loadMemories() {
  if (!state.token) {
    $("#memory-list").innerHTML =
      '<p class="harness-empty">Connect the API to load memory.</p>';
    $("#memory-count").textContent = "—";
    return;
  }
  try {
    renderMemories(await api("/v1/memories"));
  } catch (cause) {
    $("#memory-list").innerHTML =
      `<p class="harness-empty">${escapeHtml(cause instanceof Error ? cause.message : "Memory unavailable.")}</p>`;
  }
}
async function saveMemoryEdit(card) {
  const body = {
    content: card.querySelector(".memory-edit-content").value.trim(),
    scope: card.dataset.scope,
    status: "active",
    expectedRevision: Number(card.dataset.revision),
  };
  if (card.dataset.routineId) body.routineId = card.dataset.routineId;
  const confidence = card.querySelector(".memory-edit-confidence").value.trim();
  if (confidence) body.confidence = Number(confidence);
  await api(`/v1/memories/${card.dataset.memoryId}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
  await loadMemories();
}
async function retireMemory(card) {
  await api(
    `/v1/memories/${card.dataset.memoryId}?expectedRevision=${card.dataset.revision}`,
    { method: "DELETE" },
  );
  await loadMemories();
}
function renderWiki(result) {
  const target = $("#wiki-list");
  const documents = result.documents || [];
  $("#wiki-count").textContent = `${documents.length} pages`;
  if (!documents.length) {
    target.innerHTML = '<p class="harness-empty">No Wiki pages yet.</p>';
    return;
  }
  target.innerHTML = documents
    .slice(0, 20)
    .map(
      (document) =>
        `<article class="wiki-card" data-wiki-id="${escapeHtml(document.id)}"><div><span class="wiki-kind">${escapeHtml(document.kind)}</span><strong>${escapeHtml(document.title)}</strong><p>${escapeHtml(document.body)}</p><small>${escapeHtml(document.slug)} · revision ${escapeHtml(document.currentRevision)}</small></div><button class="quiet-button wiki-edit" type="button">Edit</button></article>`,
    )
    .join("");
}
async function saveWiki() {
  const error = $("#wiki-error");
  const kind = $("#wiki-kind").value;
  const slug = $("#wiki-slug").value.trim();
  const title = $("#wiki-title").value.trim();
  const body = $("#wiki-body").value;
  if (!slug || !title) {
    error.textContent = "Slug and title are required.";
    error.hidden = false;
    return;
  }
  try {
    await apiJson("/v1/wiki", { kind, slug, title, body });
    $("#wiki-slug").value = "";
    $("#wiki-title").value = "";
    $("#wiki-body").value = "";
    $("#wiki-add-form").hidden = true;
    error.hidden = true;
    await loadLibrary();
  } catch (cause) {
    error.textContent =
      cause instanceof Error ? cause.message : "Could not save Wiki page.";
    error.hidden = false;
  }
}
async function editWiki(card) {
  if (!card || card.querySelector(".wiki-edit-form")) return;
  try {
    const result = await api(`/v1/wiki/${card.dataset.wikiId}`);
    const wikiDoc = result.document;
    card._wiki = wikiDoc;
    const form = document.createElement("div");
    form.className = "wiki-edit-form";
    form.innerHTML = `<input class="wiki-edit-slug" maxlength="200" value="${escapeHtml(wikiDoc.slug)}"/><input class="wiki-edit-title" maxlength="500" value="${escapeHtml(wikiDoc.title)}"/><textarea class="wiki-edit-body" rows="5" maxlength="200000">${escapeHtml(wikiDoc.body)}</textarea><button class="quiet-button wiki-edit-save" type="button">Save edit</button>`;
    card.append(form);
  } catch (cause) {
    const error = document.createElement("small");
    error.textContent =
      cause instanceof Error ? cause.message : "Could not load Wiki page.";
    card.append(error);
  }
}
async function saveWikiEdit(card) {
  const document = card?._wiki;
  if (!document) return;
  await api(`/v1/wiki/${document.id}`, {
    method: "PUT",
    body: JSON.stringify({
      kind: document.kind,
      slug: card.querySelector(".wiki-edit-slug").value.trim(),
      title: card.querySelector(".wiki-edit-title").value.trim(),
      body: card.querySelector(".wiki-edit-body").value,
      expectedRevision: document.currentRevision,
    }),
  });
  await loadLibrary();
}
function renderCollections(result) {
  const collections = result.collections || [];
  $("#collection-count").textContent = `${collections.length}`;
  $("#collection-list").innerHTML = collections.length
    ? collections
        .map(
          (collection) =>
            `<article class="collection-card"><div><strong>${escapeHtml(collection.name)}</strong><small>${escapeHtml(collection.description || "No description")}</small></div><button class="quiet-button collection-open" data-collection-id="${escapeHtml(collection.id)}" type="button">Open</button></article>`,
        )
        .join("")
    : '<p class="harness-empty">No collections yet.</p>';
}
async function loadCollections() {
  try {
    renderCollections(await api("/v1/content/collections"));
  } catch (cause) {
    $("#collection-list").innerHTML =
      `<p class="harness-empty">${escapeHtml(cause instanceof Error ? cause.message : "Collections unavailable.")}</p>`;
  }
}
async function saveCollection() {
  const name = $("#collection-name").value.trim();
  const error = $("#collection-error");
  if (!name) {
    error.textContent = "Name is required.";
    error.hidden = false;
    return;
  }
  try {
    await apiJson("/v1/content/collections", {
      name,
      description: $("#collection-description").value,
    });
    $("#collection-name").value = "";
    $("#collection-description").value = "";
    $("#collection-add-form").hidden = true;
    error.hidden = true;
    await loadCollections();
  } catch (cause) {
    error.textContent =
      cause instanceof Error ? cause.message : "Could not save collection.";
    error.hidden = false;
  }
}
async function openCollection(button) {
  const card = button.closest(".collection-card");
  const existing = card.querySelector(".collection-items");
  if (existing) {
    existing.remove();
    return;
  }
  try {
    const result = await api(
      `/v1/content/collections/${button.dataset.collectionId}`,
    );
    const items = document.createElement("div");
    items.className = "collection-items";
    items.innerHTML = (result.items || []).length
      ? result.items
          .map(
            (item) =>
              `<small>${escapeHtml(item.title)} · ${escapeHtml(item.kind)}</small>`,
          )
          .join("")
      : "<small>No content in this collection.</small>";
    const available = (state.libraryContent || []).filter(
      (item) => !(result.items || []).some((current) => current.id === item.id),
    );
    items.insertAdjacentHTML(
      "beforeend",
      available.length
        ? `<select class="collection-content-select">${available.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.title)}</option>`).join("")}</select><button class="quiet-button collection-content-add" data-collection-id="${escapeHtml(button.dataset.collectionId)}" type="button">Add selected content</button>`
        : "",
    );
    card.append(items);
  } catch (cause) {
    const error = document.createElement("small");
    error.textContent =
      cause instanceof Error ? cause.message : "Collection unavailable.";
    card.append(error);
  }
}
async function addContentToCollection(button) {
  const card = button.closest(".collection-card");
  const select = card?.querySelector(".collection-content-select");
  if (!select) return;
  try {
    await apiJson(
      `/v1/content/collections/${button.dataset.collectionId}/items`,
      { contentId: select.value },
    );
    button.closest(".collection-items")?.remove();
    const open = card.querySelector(".collection-open");
    if (open) await openCollection(open);
  } catch (cause) {
    const error = document.createElement("small");
    error.textContent =
      cause instanceof Error ? cause.message : "Could not add content.";
    card.append(error);
  }
}
async function loadLibrary() {
  if (!state.token) {
    $("#library-results").innerHTML =
      '<p class="harness-empty">Connect the API to search your context.</p>';
    return;
  }
  try {
    const [content, memories, wiki, collections, conflicts] = await Promise.all(
      [
        api("/v1/content?status=active&limit=20"),
        api("/v1/memories"),
        api("/v1/wiki"),
        api("/v1/content/collections"),
        api("/v1/knowledge/conflicts"),
      ],
    );
    renderLibraryContent(content);
    libraryContentCursor = content.nextCursor;
    $("#library-content-more").hidden = !libraryContentCursor;
    renderMemories(memories);
    renderWiki(wiki);
    renderCollections(collections);
    renderKnowledgeConflicts(conflicts);
  } catch (error) {
    $("#library-content-list").innerHTML =
      `<p class="harness-empty">${escapeHtml(error instanceof Error ? error.message : "Library unavailable.")}</p>`;
    $("#memory-list").innerHTML =
      '<p class="harness-empty">Memory unavailable.</p>';
    $("#wiki-list").innerHTML =
      '<p class="harness-empty">Wiki unavailable.</p>';
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
function renderPeople(result) {
  const target = $("#people-list");
  const people = result.people || [];
  state.people = people;
  if (!people.length) {
    target.innerHTML =
      '<p class="harness-empty">No people saved yet. Add the first one when you are ready.</p>';
    return;
  }
  target.innerHTML = people
    .filter((person) => person.status === "active")
    .map((person) => {
      const initials = person.displayName
        .split(/\s+/)
        .map((part) => part[0])
        .join("")
        .slice(0, 2)
        .toUpperCase();
      const detail =
        person.primaryEmail ||
        person.organization ||
        person.role ||
        "No details yet";
      return `<article class="person-card" data-person-id="${escapeHtml(person.id)}"><span class="person-avatar">${escapeHtml(initials)}</span><div><strong>${escapeHtml(person.displayName)}</strong><small>${escapeHtml(detail)}</small></div><span class="person-category">${escapeHtml(person.category)}</span><div class="person-card-actions"><button class="quiet-button person-edit" type="button">Edit</button><button class="quiet-button person-relationships" type="button">Relationships</button></div></article>`;
    })
    .join("");
}
async function editPerson(card) {
  if (!card || card.querySelector(".person-edit-form")) return;
  try {
    const result = await api(`/v1/people/${card.dataset.personId}`);
    const person = result.person;
    card._person = person;
    const form = document.createElement("div");
    form.className = "person-edit-form";
    form.innerHTML = `<input class="person-edit-name" maxlength="200" value="${escapeHtml(person.displayName)}"/><input class="person-edit-email" type="email" maxlength="320" value="${escapeHtml(person.primaryEmail || "")}"/><select class="person-edit-category"><option value="uncategorized">Uncategorized</option><option value="coworker">Coworker</option><option value="family">Family</option><option value="personal">Personal</option></select><textarea class="person-edit-notes" rows="2" maxlength="10000">${escapeHtml(person.notes || "")}</textarea><button class="quiet-button person-edit-save" type="button">Save</button>`;
    form.querySelector(".person-edit-category").value = person.category;
    card.append(form);
  } catch (cause) {
    const error = document.createElement("small");
    error.textContent =
      cause instanceof Error ? cause.message : "Could not load person.";
    card.append(error);
  }
}
async function savePersonEdit(card) {
  const person = card?._person;
  if (!person) return;
  await api(`/v1/people/${person.id}`, {
    method: "PUT",
    body: JSON.stringify({
      displayName: card.querySelector(".person-edit-name").value.trim(),
      primaryEmail:
        card.querySelector(".person-edit-email").value.trim() || undefined,
      category: card.querySelector(".person-edit-category").value,
      organization: person.organization || undefined,
      role: person.role || undefined,
      notes: card.querySelector(".person-edit-notes").value,
      expectedRevision: person.currentRevision,
    }),
  });
  await loadPeople();
}
async function loadRelationships(personId) {
  state.selectedPersonId = personId;
  const section = $("#people-relationships");
  section.hidden = false;
  const person = state.people.find((item) => item.id === personId);
  $("#relationship-list").innerHTML =
    '<p class="harness-empty">Reading relationships…</p>';
  const related = state.people.filter(
    (item) => item.status === "active" && item.id !== personId,
  );
  $("#relationship-related-person").innerHTML = related.length
    ? related
        .map(
          (item) =>
            `<option value="${escapeHtml(item.id)}">${escapeHtml(item.displayName)}</option>`,
        )
        .join("")
    : '<option value="">Add another person first</option>';
  try {
    const result = await api(`/v1/people/${personId}/relationships`);
    const relationships = result.relationships || [];
    $("#relationship-list").innerHTML = relationships.length
      ? relationships
          .map((relationship) => {
            const target = state.people.find(
              (item) => item.id === relationship.relatedPersonId,
            );
            return `<div class="relationship-row"><div><strong>${escapeHtml(target?.displayName || relationship.relatedPersonId.slice(0, 8))}</strong><small>${escapeHtml(relationship.relationshipType)}${relationship.notes ? ` · ${escapeHtml(relationship.notes)}` : ""}</small></div><button class="quiet-button relationship-retire" data-relationship-id="${escapeHtml(relationship.id)}" data-revision="${relationship.revision}" type="button">Archive</button></div>`;
          })
          .join("")
      : '<p class="harness-empty">No relationships recorded yet.</p>';
    if (person)
      $("#relationship-type").placeholder =
        `How is ${person.displayName} connected?`;
  } catch (cause) {
    $("#relationship-list").innerHTML =
      `<p class="harness-empty">${escapeHtml(cause instanceof Error ? cause.message : "Relationships unavailable.")}</p>`;
  }
}
async function saveRelationship() {
  const error = $("#relationship-error");
  const relatedPersonId = $("#relationship-related-person").value;
  const relationshipType = $("#relationship-type").value.trim();
  if (!state.selectedPersonId || !relatedPersonId || !relationshipType) {
    error.textContent = "Choose a person and relationship type.";
    error.hidden = false;
    return;
  }
  try {
    await apiJson(`/v1/people/${state.selectedPersonId}/relationships`, {
      relatedPersonId,
      relationshipType,
      notes: $("#relationship-notes").value,
    });
    $("#relationship-type").value = "";
    $("#relationship-notes").value = "";
    error.hidden = true;
    await loadRelationships(state.selectedPersonId);
  } catch (cause) {
    error.textContent =
      cause instanceof Error ? cause.message : "Could not add relationship.";
    error.hidden = false;
  }
}
async function retireRelationship(button) {
  if (!button || !state.selectedPersonId) return;
  try {
    await api(
      `/v1/people/relationships/${button.dataset.relationshipId}?expectedRevision=${button.dataset.revision}`,
      { method: "DELETE" },
    );
    await loadRelationships(state.selectedPersonId);
  } catch (cause) {
    const error = $("#relationship-error");
    error.textContent =
      cause instanceof Error
        ? cause.message
        : "Could not archive relationship.";
    error.hidden = false;
  }
}
async function loadPeople() {
  if (!state.token) {
    $("#people-list").innerHTML =
      '<p class="harness-empty">Connect the API to load people.</p>';
    return;
  }
  try {
    renderPeople(await api("/v1/people"));
  } catch (error) {
    $("#people-list").innerHTML =
      `<p class="harness-empty">${escapeHtml(error instanceof Error ? error.message : "People unavailable.")}</p>`;
  }
}
async function savePerson() {
  const name = $("#person-name").value.trim();
  if (!name || !state.token) return;
  const button = $("#person-save");
  const error = $("#people-error");
  button.disabled = true;
  error.hidden = true;
  try {
    await apiJson("/v1/people", {
      displayName: name,
      primaryEmail: $("#person-email").value.trim() || undefined,
      category: $("#person-category").value,
      notes: $("#person-notes").value,
    });
    $("#person-name").value = "";
    $("#person-email").value = "";
    $("#person-notes").value = "";
    $("#people-add-form").hidden = true;
    await loadPeople();
  } catch (cause) {
    error.textContent =
      cause instanceof Error ? cause.message : "Could not save person.";
    error.hidden = false;
  } finally {
    button.disabled = false;
  }
}
async function loadProfile() {
  if (!state.token) {
    $("#profile-revision").textContent = "Connect the API first";
    return;
  }
  try {
    const result = await api("/v1/profile");
    state.profileRevision = result.profile.currentRevision;
    $("#profile-content").value = JSON.stringify(
      result.profile.content,
      null,
      2,
    );
    $("#profile-revision").textContent = `Revision ${state.profileRevision}`;
  } catch (error) {
    if (error.status === 404) {
      state.profileRevision = null;
      $("#profile-content").value = "{}";
      $("#profile-revision").textContent = "New profile";
      return;
    }
    $("#profile-error").textContent =
      error instanceof Error ? error.message : "Profile unavailable.";
    $("#profile-error").hidden = false;
  }
  await loadAgentSettings();
}
async function loadAgentSettings() {
  if (!state.token) return;
  try {
    const result = await api("/v1/agents/personal");
    const agent = result.agent;
    state.agentRevision = agent.revision;
    state.agentVersionId = agent.activeVersion.id;
    state.agentCallableRoutineIds =
      agent.activeVersion.snapshot.callableRoutineIds || [];
    $("#agent-display-name").value = agent.activeVersion.snapshot.displayName;
    $("#agent-instructions").value = agent.activeVersion.snapshot.instructions;
    $("#agent-approval-mode").value =
      agent.activeVersion.snapshot.defaultApprovalMode;
    $("#agent-revision").textContent =
      `Revision ${state.agentRevision} · version ${agent.activeVersion.version}`;
    const routines = (await api("/v1/routines")).routines || [];
    $("#agent-routine-options").innerHTML = routines.length
      ? routines
          .map(
            (routine) =>
              `<label class="agent-routine-option"><input type="checkbox" value="${escapeHtml(routine.id)}" ${state.agentCallableRoutineIds.includes(routine.id) ? "checked" : ""} /> ${escapeHtml(routine.activeVersion.snapshot.displayName)}</label>`,
          )
          .join("")
      : '<p class="harness-empty">No routine agents available.</p>';
    const versions =
      (await api("/v1/agents/personal/versions?limit=20")).items || [];
    $("#agent-history-list").innerHTML = versions.length
      ? versions
          .map(
            (version) =>
              `<article class="agent-history-item"><div><strong>Version ${escapeHtml(String(version.version))}</strong><small>${escapeHtml(version.createdBy)} · ${escapeHtml(new Date(version.createdAt).toLocaleString())}</small></div><span>${escapeHtml(version.snapshot.defaultApprovalMode)}</span></article>`,
          )
          .join("")
      : '<p class="harness-empty">No previous versions returned.</p>';
  } catch (error) {
    $("#agent-error").textContent =
      error instanceof Error ? error.message : "Agent unavailable.";
    $("#agent-error").hidden = false;
  }
}
async function saveAgentSettings() {
  const error = $("#agent-error");
  error.hidden = true;
  if (!Number.isInteger(state.agentRevision)) return;
  const button = $("#agent-save");
  button.disabled = true;
  try {
    state.agentCallableRoutineIds = Array.from(
      document.querySelectorAll("#agent-routine-options input:checked"),
    ).map((input) => input.value);
    const result = await api("/v1/agents/personal", {
      method: "PUT",
      body: JSON.stringify({
        expectedRevision: state.agentRevision,
        displayName: $("#agent-display-name").value.trim(),
        instructions: $("#agent-instructions").value,
        defaultApprovalMode: $("#agent-approval-mode").value,
        callableRoutineIds: state.agentCallableRoutineIds,
      }),
    });
    state.agentRevision = result.agent.revision;
    $("#agent-revision").textContent =
      `Revision ${state.agentRevision} · version ${result.agent.activeVersion.version}`;
    setConnection(true, "Agent saved");
  } catch (cause) {
    error.textContent =
      cause instanceof Error ? cause.message : "Could not save Agent.";
    error.hidden = false;
  } finally {
    button.disabled = false;
  }
}
async function saveProfile() {
  const error = $("#profile-error");
  error.hidden = true;
  let content;
  try {
    content = JSON.parse($("#profile-content").value);
  } catch {
    error.textContent = "Profile must be valid JSON.";
    error.hidden = false;
    return;
  }
  if (
    content === null ||
    Array.isArray(content) ||
    typeof content !== "object"
  ) {
    error.textContent = "Profile JSON must be an object.";
    error.hidden = false;
    return;
  }
  const button = $("#profile-save");
  button.disabled = true;
  try {
    const result =
      state.profileRevision === null
        ? await apiJson("/v1/profile", { content })
        : await api("/v1/profile", {
            method: "PUT",
            body: JSON.stringify({
              content,
              expectedRevision: state.profileRevision,
            }),
          });
    if (result.kind === "conflict") {
      throw new Error("Profile changed elsewhere. Reload before saving again.");
    }
    const profile = result.profile;
    state.profileRevision = profile.currentRevision;
    $("#profile-content").value = JSON.stringify(profile.content, null, 2);
    $("#profile-revision").textContent = `Revision ${state.profileRevision}`;
  } catch (cause) {
    error.textContent =
      cause instanceof Error ? cause.message : "Could not save profile.";
    error.hidden = false;
  } finally {
    button.disabled = false;
  }
}
async function saveMemory() {
  const content = $("#memory-content").value.trim();
  const error = $("#memory-error");
  if (!content || !state.token) return;
  error.hidden = true;
  const confidenceText = $("#memory-confidence").value.trim();
  const confidence = confidenceText === "" ? undefined : Number(confidenceText);
  if (
    confidence !== undefined &&
    (!Number.isFinite(confidence) || confidence < 0 || confidence > 1)
  ) {
    error.textContent = "Confidence must be between 0 and 1.";
    error.hidden = false;
    return;
  }
  const button = $("#memory-save");
  button.disabled = true;
  try {
    await apiJson("/v1/memories", {
      scope: "global",
      content,
      ...(confidence === undefined ? {} : { confidence }),
    });
    $("#memory-content").value = "";
    $("#memory-confidence").value = "";
    $("#memory-add-form").hidden = true;
    await loadLibrary();
  } catch (cause) {
    error.textContent =
      cause instanceof Error ? cause.message : "Could not save memory.";
    error.hidden = false;
  } finally {
    button.disabled = false;
  }
}
function renderTasks(result) {
  const target = $("#task-list");
  const tasks = result.tasks || [];
  if (!tasks.length) {
    target.innerHTML = '<p class="harness-empty">No open tasks yet.</p>';
    return;
  }
  target.innerHTML = tasks
    .filter((task) => task.status !== "deleted")
    .map(
      (task) =>
        `<article class="task-card" data-task-id="${escapeHtml(task.id)}" data-revision="${escapeHtml(task.currentRevision)}"><strong>${escapeHtml(task.title)}</strong><p>${escapeHtml(task.description || "No description")}</p><small>${escapeHtml(task.status)} · ${task.unread ? "unread" : "read"}</small><div class="task-card-actions"><button class="quiet-button task-edit" type="button">Edit</button>${task.unread ? '<button class="quiet-button task-mark-read" type="button">Mark read</button>' : ""}<button class="quiet-button task-delete" type="button">Delete</button></div></article>`,
    )
    .join("");
}
async function editTask(card) {
  if (!card || card.querySelector(".task-edit-form")) return;
  try {
    const task = await api(`/v1/tasks/${card.dataset.taskId}`);
    card._task = task;
    const form = document.createElement("div");
    form.className = "task-edit-form";
    form.innerHTML = `<input class="task-edit-title" maxlength="500" value="${escapeHtml(task.title)}"/><textarea class="task-edit-description" rows="3" maxlength="20000">${escapeHtml(task.description || "")}</textarea><select class="task-edit-status"><option value="open">Open</option><option value="completed">Completed</option></select><button class="quiet-button task-edit-save" type="button">Save</button>`;
    form.querySelector(".task-edit-status").value = task.status;
    card.append(form);
  } catch (cause) {
    const error = document.createElement("small");
    error.textContent =
      cause instanceof Error ? cause.message : "Could not load task.";
    card.append(error);
  }
}
async function saveTaskEdit(card) {
  const task = card?._task;
  if (!task) return;
  await api(`/v1/tasks/${task.id}`, {
    method: "PATCH",
    body: JSON.stringify({
      expectedRevision: task.currentRevision,
      title: card.querySelector(".task-edit-title").value.trim(),
      description: card.querySelector(".task-edit-description").value,
      status: card.querySelector(".task-edit-status").value,
      scheduledFor: task.scheduledFor || null,
    }),
  });
  await loadTasks();
}
async function markTaskRead(card) {
  await apiJson(`/v1/tasks/${card.dataset.taskId}/mark-read`, {});
  await loadTasks();
}
async function deleteTask(card) {
  await api(
    `/v1/tasks/${card.dataset.taskId}?expectedRevision=${card.dataset.revision}`,
    { method: "DELETE" },
  );
  await loadTasks();
}
async function loadTasks() {
  if (!state.token) {
    $("#task-list").innerHTML =
      '<p class="harness-empty">Connect the API to load tasks.</p>';
    return;
  }
  try {
    renderTasks(await api("/v1/tasks?status=open&limit=50"));
  } catch (error) {
    $("#task-list").innerHTML =
      `<p class="harness-empty">${escapeHtml(error instanceof Error ? error.message : "Tasks unavailable.")}</p>`;
  }
}
async function saveTask() {
  const title = $("#task-title").value.trim();
  const error = $("#task-error");
  if (!title || !state.token) return;
  error.hidden = true;
  const button = $("#task-save");
  button.disabled = true;
  try {
    await apiJson("/v1/tasks", {
      title,
      description: $("#task-description").value,
      approvalMode: "respect_tool_setting",
      sourceThreads: [],
    });
    $("#task-title").value = "";
    $("#task-description").value = "";
    $("#task-add-form").hidden = true;
    await loadTasks();
    await refresh();
  } catch (cause) {
    error.textContent =
      cause instanceof Error ? cause.message : "Could not create task.";
    error.hidden = false;
  } finally {
    button.disabled = false;
  }
}
let selectedRoutineId = null;
let selectedRoutineTemplate = null;
let selectedRoutine = null;
function showRoutineEditor(routine) {
  selectedRoutine = routine;
  $("#routine-edit-form").hidden = false;
  $("#routine-edit-name").value = routine.name;
  $("#routine-edit-cron").value = routine.cron;
  $("#routine-edit-timezone").value = routine.timezone;
  $("#routine-edit-next-run").value = new Date(routine.nextRunAt)
    .toISOString()
    .slice(0, 16);
  $("#routine-edit-enabled").checked = routine.enabled;
}
function renderRoutines(result) {
  const target = $("#routine-list");
  const routines = result.routines || [];
  if (!routines.length) {
    target.innerHTML =
      '<p class="harness-empty">No routines configured yet.</p>';
    $("#routine-trigger").hidden = true;
    return;
  }
  target.innerHTML = routines
    .map(
      (routine) =>
        `<article class="routine-card ${routine.id === selectedRoutineId ? "is-selected" : ""}"><div><strong>${escapeHtml(routine.name)}</strong><small>${escapeHtml(routine.cron)} · ${escapeHtml(routine.timezone)} · ${routine.enabled ? `next ${formatTime(new Date(routine.nextRunAt))}` : "disabled"}</small></div><button class="quiet-button routine-select" data-routine-id="${escapeHtml(routine.id)}" type="button">${routine.id === selectedRoutineId ? "Selected" : "Select"}</button></article>`,
    )
    .join("");
  target.querySelectorAll(".routine-select").forEach((button) => {
    button.addEventListener("click", () => {
      selectedRoutineId = button.dataset.routineId;
      selectedRoutine =
        (result.routines || []).find(
          (routine) => routine.id === selectedRoutineId,
        ) || null;
      if (selectedRoutine) showRoutineEditor(selectedRoutine);
      $("#routine-share").hidden = false;
      $("#routine-trigger").hidden = false;
      $("#routine-history").hidden = false;
      void loadRoutineWebhook();
      void loadRoutineRuns();
      void loadRoutineVersions();
      void loadRoutineTriggers();
      void loadRoutineEmailAccounts();
      renderRoutines(result);
      $("#routine-input").focus();
    });
  });
}
let routineShareId = null;
async function createRoutineShare() {
  if (!selectedRoutineId) return;
  const error = $("#routine-share-error");
  try {
    const result = await apiJson(`/v1/routines/${selectedRoutineId}/shares`, {
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
    });
    routineShareId = result.share.id;
    $("#routine-share-url").value =
      `${state.base.replace(/\/$/, "")}/v1/routine-shares/${result.token}`;
    $("#routine-share-secret").hidden = false;
    error.hidden = true;
  } catch (cause) {
    error.textContent =
      cause instanceof Error ? cause.message : "Could not create share link.";
    error.hidden = false;
  }
}
async function revokeRoutineShare() {
  if (!routineShareId) return;
  const error = $("#routine-share-error");
  try {
    await api(`/v1/routines/shares/${routineShareId}`, { method: "DELETE" });
    routineShareId = null;
    $("#routine-share-secret").hidden = true;
    error.hidden = true;
  } catch (cause) {
    error.textContent =
      cause instanceof Error ? cause.message : "Could not revoke share link.";
    error.hidden = false;
  }
}
async function installSharedRoutine() {
  const error = $("#routine-install-error");
  const token = $("#routine-share-token").value.trim();
  const nextRun = $("#routine-install-next-run").value;
  if (!token || !nextRun) {
    error.textContent = "Share token and first run are required.";
    error.hidden = false;
    return;
  }
  try {
    await apiJson("/v1/routines/install", {
      token,
      name: $("#routine-install-name").value.trim() || undefined,
      nextRunAt: new Date(nextRun).toISOString(),
      enabled: true,
    });
    $("#routine-share-token").value = "";
    $("#routine-install-name").value = "";
    error.hidden = true;
    await loadRoutines();
  } catch (cause) {
    error.textContent =
      cause instanceof Error
        ? cause.message
        : "Could not install shared routine.";
    error.hidden = false;
  }
}
async function saveRoutineEdit() {
  if (!selectedRoutine) return;
  const error = $("#routine-edit-error");
  try {
    await api(`/v1/routines/${selectedRoutine.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        agentId: selectedRoutine.agentId,
        agentVersionId: selectedRoutine.agentVersionId,
        name: $("#routine-edit-name").value.trim(),
        cron: $("#routine-edit-cron").value.trim(),
        timezone: $("#routine-edit-timezone").value.trim(),
        nextRunAt: new Date($("#routine-edit-next-run").value).toISOString(),
        enabled: $("#routine-edit-enabled").checked,
        expectedRevision: selectedRoutine.revision,
      }),
    });
    error.hidden = true;
    await loadRoutines();
  } catch (cause) {
    error.textContent =
      cause instanceof Error ? cause.message : "Could not save routine.";
    error.hidden = false;
  }
}
async function deleteRoutine() {
  if (!selectedRoutine) return;
  const error = $("#routine-edit-error");
  try {
    await api(
      `/v1/routines/${selectedRoutine.id}?expectedRevision=${selectedRoutine.revision}`,
      { method: "DELETE" },
    );
    selectedRoutine = null;
    selectedRoutineId = null;
    $("#routine-edit-form").hidden = true;
    error.hidden = true;
    await loadRoutines();
  } catch (cause) {
    error.textContent =
      cause instanceof Error ? cause.message : "Could not delete routine.";
    error.hidden = false;
  }
}
async function loadRoutineTriggers() {
  if (!selectedRoutineId || !state.token) return;
  const target = $("#routine-trigger-list");
  target.innerHTML = '<p class="harness-empty">Reading routine triggers…</p>';
  try {
    const triggers =
      (await api(`/v1/routines/${selectedRoutineId}/triggers`)).triggers || [];
    target.innerHTML = triggers.length
      ? `<p class="eyebrow">Triggers</p>${triggers.map((trigger) => `<div class="routine-trigger-row" data-trigger-id="${escapeHtml(trigger.id)}" data-revision="${escapeHtml(trigger.revision)}"><div><strong>${escapeHtml(trigger.kind)}</strong><small>${escapeHtml(JSON.stringify(trigger.config || {}))}</small></div><div class="routine-trigger-actions"><button class="quiet-button routine-trigger-toggle" type="button">${trigger.enabled ? "Disable" : "Enable"}</button><button class="quiet-button routine-trigger-delete" type="button">Remove</button></div></div>`).join("")}`
      : '<p class="harness-empty">No triggers configured.</p>';
  } catch (cause) {
    target.innerHTML = `<p class="harness-empty">${escapeHtml(cause instanceof Error ? cause.message : "Triggers unavailable.")}</p>`;
  }
}
async function toggleRoutineTrigger(row) {
  if (!row) return;
  const current =
    row.querySelector(".routine-trigger-toggle").textContent.trim() ===
    "Disable";
  try {
    await api(`/v1/routine-triggers/${row.dataset.triggerId}`, {
      method: "PATCH",
      body: JSON.stringify({
        expectedRevision: Number(row.dataset.revision),
        config: {},
        enabled: !current,
      }),
    });
    await loadRoutineTriggers();
  } catch (cause) {
    $("#routine-history-error").textContent =
      cause instanceof Error ? cause.message : "Could not update trigger.";
    $("#routine-history-error").hidden = false;
  }
}
async function deleteRoutineTrigger(row) {
  if (!row) return;
  try {
    await api(
      `/v1/routine-triggers/${row.dataset.triggerId}?expectedRevision=${row.dataset.revision}`,
      { method: "DELETE" },
    );
    await loadRoutineTriggers();
  } catch (cause) {
    $("#routine-history-error").textContent =
      cause instanceof Error ? cause.message : "Could not remove trigger.";
    $("#routine-history-error").hidden = false;
  }
}
async function addRoutineTrigger() {
  if (!selectedRoutineId) return;
  const error = $("#routine-trigger-add-error");
  let config;
  try {
    config = JSON.parse($("#routine-trigger-config").value || "{}");
  } catch {
    error.textContent = "Config must be valid JSON.";
    error.hidden = false;
    return;
  }
  if (!config || Array.isArray(config) || typeof config !== "object") {
    error.textContent = "Config must be a JSON object.";
    error.hidden = false;
    return;
  }
  try {
    await apiJson(`/v1/routines/${selectedRoutineId}/triggers`, {
      kind: $("#routine-trigger-kind").value,
      config,
      enabled: true,
    });
    $("#routine-trigger-config").value = "{}";
    error.hidden = true;
    await loadRoutineTriggers();
  } catch (cause) {
    error.textContent =
      cause instanceof Error ? cause.message : "Could not add trigger.";
    error.hidden = false;
  }
}
async function loadRoutineEmailAccounts() {
  const select = $("#routine-email-account");
  if (!state.token || !select) return;
  try {
    const accounts = (await api("/v1/accounts")).accounts || [];
    const google = accounts.filter(
      (account) =>
        account.provider === "google" && account.status !== "revoked",
    );
    select.innerHTML = google.length
      ? google
          .map(
            (account) =>
              `<option value="${escapeHtml(account.id)}">${escapeHtml(account.displayName || account.providerAccountId || account.id.slice(0, 8))}</option>`,
          )
          .join("")
      : '<option value="">No connected Google account</option>';
  } catch (cause) {
    select.innerHTML = `<option value="">${escapeHtml(cause instanceof Error ? cause.message : "Accounts unavailable.")}</option>`;
  }
}
async function ingestRoutineEmail() {
  if (!selectedRoutineId) return;
  const error = $("#routine-email-error");
  const accountId = $("#routine-email-account").value;
  if (!accountId) {
    error.textContent = "Connect and select a Google account first.";
    error.hidden = false;
    return;
  }
  try {
    const result = await apiJson(
      `/v1/routines/${selectedRoutineId}/ingest/email`,
      {
        accountId,
        query: $("#routine-email-query").value.trim() || undefined,
        maxResults: Number($("#routine-email-max").value) || 10,
      },
    );
    error.textContent = `Queued ${result.runs?.length || 0} message(s).`;
    error.hidden = false;
    await loadRoutineRuns();
  } catch (cause) {
    error.textContent =
      cause instanceof Error ? cause.message : "Could not ingest email.";
    error.hidden = false;
  }
}
async function loadRoutineVersions() {
  if (!selectedRoutineId || !state.token) return;
  const target = $("#routine-version-list");
  target.innerHTML = '<p class="harness-empty">Reading immutable versions…</p>';
  try {
    const versions =
      (await api(`/v1/routines/${selectedRoutineId}/versions?limit=20`))
        .items || [];
    target.innerHTML = versions.length
      ? versions
          .map(
            (version) =>
              `<article class="agent-history-item"><div><strong>Version ${escapeHtml(String(version.version))}</strong><small>${escapeHtml(version.createdBy)} · ${escapeHtml(new Date(version.createdAt).toLocaleString())}</small></div><span>${escapeHtml(version.snapshot.defaultApprovalMode)}</span></article>`,
          )
          .join("")
      : '<p class="harness-empty">No versions returned.</p>';
  } catch {
    target.innerHTML =
      '<p class="harness-empty">Routine versions unavailable.</p>';
  }
}
function renderRoutineRuns(items) {
  const target = $("#routine-run-list");
  if (!items?.length) {
    target.innerHTML = '<p class="harness-empty">No runs recorded yet.</p>';
    return;
  }
  target.innerHTML = items
    .slice(0, 8)
    .map((item) => {
      const result = item.result;
      const status = result?.status || item.run.status;
      const subject = result?.subject || item.run.triggerType || "Routine run";
      const terminal = ["succeeded", "failed", "blocked"].includes(
        item.run.status,
      );
      return `<article class="routine-run-card"><div class="routine-run-main"><span class="routine-run-status routine-run-status-${escapeHtml(status)}"></span><div><strong>${escapeHtml(subject)}</strong><small>${escapeHtml(item.run.triggerType)} · ${formatTime(new Date(item.run.createdAt))}</small></div></div><div class="routine-run-actions"><span class="routine-run-state">${escapeHtml(status)}</span>${terminal ? `<button class="quiet-button routine-replay" data-run-id="${escapeHtml(item.run.id)}" type="button">Replay</button>` : ""}</div></article>`;
    })
    .join("");
}
async function loadRoutineRuns() {
  if (!selectedRoutineId || !state.token) return;
  const target = $("#routine-run-list");
  const error = $("#routine-history-error");
  error.hidden = true;
  target.innerHTML =
    '<p class="harness-empty">Reading durable run history…</p>';
  try {
    const runs =
      (await api(`/v1/routines/${selectedRoutineId}/runs?limit=8`)).runs || [];
    const details = await Promise.all(
      runs.map(async (run) => {
        try {
          return await api(`/v1/routine-runs/${run.id}`);
        } catch {
          return { run, result: null };
        }
      }),
    );
    renderRoutineRuns(details);
  } catch (cause) {
    target.innerHTML = '<p class="harness-empty">Run history unavailable.</p>';
    error.textContent =
      cause instanceof Error ? cause.message : "Run history unavailable.";
    error.hidden = false;
  }
}
async function replayRoutineRun(runId, button) {
  button.disabled = true;
  try {
    await apiJson(
      `/v1/routine-runs/${runId}/replay`,
      {},
      {
        "Idempotency-Key": crypto.randomUUID(),
      },
    );
    await loadRoutineRuns();
    await refresh();
  } catch (cause) {
    const error = $("#routine-history-error");
    error.textContent =
      cause instanceof Error ? cause.message : "Could not replay run.";
    error.hidden = false;
  } finally {
    button.disabled = false;
  }
}
async function loadRoutineWebhook() {
  const panel = $("#routine-webhook");
  if (!selectedRoutineId || !state.token) {
    panel.hidden = true;
    return;
  }
  panel.hidden = false;
  $("#routine-webhook-secret").hidden = true;
  try {
    const result = await api(`/v1/routines/${selectedRoutineId}/webhook`);
    const webhook = result.webhook;
    $("#routine-webhook-state").textContent = webhook.enabled
      ? "Enabled"
      : "Disabled";
    $("#routine-webhook-toggle").hidden = false;
    $("#routine-webhook-toggle").textContent = webhook.enabled
      ? "Disable"
      : "Enable";
    $("#routine-webhook-toggle").dataset.enabled = String(webhook.enabled);
  } catch (error) {
    if (error.status === 404) {
      $("#routine-webhook-state").textContent = "Not configured";
      $("#routine-webhook-toggle").hidden = true;
      return;
    }
    $("#routine-webhook-error").textContent =
      error instanceof Error ? error.message : "Webhook unavailable.";
    $("#routine-webhook-error").hidden = false;
  }
}
async function createRoutineWebhook() {
  if (!selectedRoutineId || !state.token) return;
  const error = $("#routine-webhook-error");
  error.hidden = true;
  const button = $("#routine-webhook-create");
  button.disabled = true;
  try {
    const result = await apiJson(
      `/v1/routines/${selectedRoutineId}/webhook`,
      {},
    );
    $("#routine-webhook-state").textContent = "Enabled";
    $("#routine-webhook-toggle").hidden = false;
    $("#routine-webhook-toggle").textContent = "Disable";
    $("#routine-webhook-toggle").dataset.enabled = "true";
    $("#routine-webhook-url").value =
      `${state.base.replace(/\/$/, "")}/v1/routine-webhooks/${selectedRoutineId}`;
    $("#routine-webhook-token").value = result.secret;
    $("#routine-webhook-secret").hidden = false;
  } catch (cause) {
    error.textContent =
      cause instanceof Error ? cause.message : "Could not create webhook.";
    error.hidden = false;
  } finally {
    button.disabled = false;
  }
}
async function toggleRoutineWebhook() {
  if (!selectedRoutineId || !state.token) return;
  const button = $("#routine-webhook-toggle");
  const enabled = button.dataset.enabled === "true";
  button.disabled = true;
  try {
    const result = await api(`/v1/routines/${selectedRoutineId}/webhook`, {
      method: "PATCH",
      body: JSON.stringify({ enabled: !enabled }),
    });
    button.dataset.enabled = String(result.webhook.enabled);
    button.textContent = result.webhook.enabled ? "Disable" : "Enable";
    $("#routine-webhook-state").textContent = result.webhook.enabled
      ? "Enabled"
      : "Disabled";
  } catch (cause) {
    $("#routine-webhook-error").textContent =
      cause instanceof Error ? cause.message : "Could not update webhook.";
    $("#routine-webhook-error").hidden = false;
  } finally {
    button.disabled = false;
  }
}
async function loadRoutines() {
  if (!state.token) {
    $("#routine-list").innerHTML =
      '<p class="harness-empty">Connect the API to load routines.</p>';
    return;
  }
  try {
    const [routines, templates] = await Promise.all([
      api("/v1/routines"),
      api("/v1/routine-templates"),
    ]);
    renderRoutines(routines);
    renderRoutineTemplates(templates);
  } catch (error) {
    $("#routine-list").innerHTML =
      `<p class="harness-empty">${escapeHtml(error instanceof Error ? error.message : "Routines unavailable.")}</p>`;
  }
}
function renderRoutineTemplates(result) {
  const target = $("#routine-template-list");
  const templates = result.templates || [];
  if (!templates.length) {
    target.innerHTML =
      '<p class="harness-empty">No stock templates available.</p>';
    return;
  }
  target.innerHTML = templates
    .map(
      (template) =>
        `<article class="routine-template-card"><div><strong>${escapeHtml(template.name)}</strong><small>${escapeHtml(template.summary)}</small></div><button class="quiet-button routine-template-select" data-template-id="${escapeHtml(template.id)}" type="button">Use</button></article>`,
    )
    .join("");
  target.querySelectorAll(".routine-template-select").forEach((button) => {
    button.addEventListener("click", () => {
      selectedRoutineTemplate =
        templates.find((item) => item.id === button.dataset.templateId) || null;
      if (!selectedRoutineTemplate) return;
      $("#routine-template-name").textContent = selectedRoutineTemplate.name;
      $("#routine-template-summary").textContent =
        selectedRoutineTemplate.summary;
      $("#routine-template-error").hidden = true;
      $("#routine-template-form").hidden = false;
      const next = new Date(Date.now() + 60 * 60 * 1000);
      next.setSeconds(0, 0);
      $("#routine-template-next-run").value = next.toISOString().slice(0, 16);
      $("#routine-template-cron").focus();
    });
  });
}
async function installRoutineTemplate() {
  if (!selectedRoutineTemplate || !state.token) return;
  const error = $("#routine-template-error");
  error.hidden = true;
  const button = $("#routine-template-install");
  button.disabled = true;
  try {
    const nextRunAt = new Date($("#routine-template-next-run").value);
    if (Number.isNaN(nextRunAt.getTime()))
      throw new Error("Choose a valid first run time.");
    await apiJson(
      `/v1/routine-templates/${selectedRoutineTemplate.id}/install`,
      {
        cron: $("#routine-template-cron").value.trim(),
        timezone: $("#routine-template-timezone").value.trim() || "UTC",
        nextRunAt: nextRunAt.toISOString(),
      },
    );
    selectedRoutineTemplate = null;
    $("#routine-template-form").hidden = true;
    await loadRoutines();
    setConnection(true, "Template installed");
  } catch (cause) {
    error.textContent =
      cause instanceof Error ? cause.message : "Could not install template.";
    error.hidden = false;
  } finally {
    button.disabled = false;
  }
}
async function runSelectedRoutine() {
  const error = $("#routine-error");
  const input = $("#routine-input").value.trim();
  if (!selectedRoutineId || !input || !state.token) return;
  error.hidden = true;
  const button = $("#routine-run");
  button.disabled = true;
  try {
    const result = await apiJson(
      `/v1/routines/${selectedRoutineId}/run`,
      { input },
      {
        "Idempotency-Key": crypto.randomUUID(),
      },
    );
    $("#routine-input").value = "";
    $("#routine-trigger").hidden = true;
    await loadRoutineRuns();
    setConnection(true, `Queued ${result.run.state}`);
    await refresh();
  } catch (cause) {
    error.textContent =
      cause instanceof Error ? cause.message : "Could not queue routine.";
    error.hidden = false;
  } finally {
    button.disabled = false;
  }
}
function renderAccounts(result) {
  const target = $("#account-list");
  const accounts = result.accounts || [];
  if (!accounts.length) {
    target.innerHTML =
      '<p class="harness-empty">No connected accounts yet.</p>';
    return;
  }
  target.innerHTML = accounts
    .map(
      (account) =>
        `<article class="account-card" data-account-id="${escapeHtml(account.id)}"><span class="account-mark">${escapeHtml(account.provider)}</span><div><strong>${escapeHtml(account.email)}</strong><small>${
          Object.keys(account.capabilities || {})
            .filter((key) => account.capabilities[key])
            .map(escapeHtml)
            .join(" · ") || "No capabilities reported"
        }</small></div><div class="account-card-actions"><span class="account-status ${account.needsReauth ? "needs-reauth" : ""}">${account.needsReauth ? "reauth" : account.isActive ? "active" : "inactive"}</span>${account.provider === "google" ? '<button class="quiet-button account-refresh" type="button">Refresh</button>' : ""}<button class="quiet-button account-remove" type="button">Remove</button></div></article>`,
    )
    .join("");
}
async function refreshAccount(card) {
  try {
    await api(`/v1/accounts/${card.dataset.accountId}/refresh`, {
      method: "POST",
    });
    await loadAccounts();
  } catch (cause) {
    const error = $("#accounts-error");
    error.textContent =
      cause instanceof Error ? cause.message : "Could not refresh account.";
    error.hidden = false;
  }
}
async function removeAccount(card) {
  try {
    await api(`/v1/accounts/${card.dataset.accountId}`, { method: "DELETE" });
    await loadAccounts();
  } catch (cause) {
    const error = $("#accounts-error");
    error.textContent =
      cause instanceof Error ? cause.message : "Could not remove account.";
    error.hidden = false;
  }
}
async function loadAccounts() {
  if (!state.token) {
    $("#account-list").innerHTML =
      '<p class="harness-empty">Connect the API to load accounts.</p>';
    return;
  }
  try {
    renderAccounts(await api("/v1/accounts"));
  } catch (error) {
    $("#account-list").innerHTML =
      `<p class="harness-empty">${escapeHtml(error instanceof Error ? error.message : "Accounts unavailable.")}</p>`;
  }
}
function renderTools(result) {
  const target = $("#tool-catalog-list");
  const tools = result.tools || [];
  $("#tool-catalog-count").textContent = `${tools.length} enabled`;
  if (!tools.length) {
    target.innerHTML =
      '<p class="harness-empty">No enabled tools returned.</p>';
    return;
  }
  target.innerHTML = tools
    .map(
      (tool) =>
        `<article class="tool-catalog-card"><div><strong>${escapeHtml(tool.name)}</strong><p>${escapeHtml(tool.description)}</p></div><small>v${escapeHtml(String(tool.version))} · ${escapeHtml(tool.sideEffect)} · ${escapeHtml(tool.dataSensitivity)} · account ${escapeHtml(tool.accountBinding)}</small></article>`,
    )
    .join("");
}
async function loadTools() {
  if (!state.token) {
    $("#tool-catalog-list").innerHTML =
      '<p class="harness-empty">Connect the API to load tools.</p>';
    $("#tool-catalog-count").textContent = "—";
    return;
  }
  try {
    renderTools(await api("/v1/tools"));
  } catch (error) {
    $("#tool-catalog-list").innerHTML =
      `<p class="harness-empty">${escapeHtml(error instanceof Error ? error.message : "Tools unavailable.")}</p>`;
  }
}
function renderMcpServers(result, bindingResult = { bindings: [] }) {
  const target = $("#mcp-catalog-list");
  const servers = result.servers || [];
  const bindings = new Map(
    (bindingResult.bindings || []).map((binding) => [
      binding.mcpServerId,
      binding,
    ]),
  );
  $("#mcp-catalog-count").textContent = `${servers.length} configured`;
  if (!servers.length) {
    target.innerHTML =
      '<p class="harness-empty">No MCP servers configured.</p>';
    return;
  }
  target.innerHTML = servers
    .map(
      (server) =>
        `<article class="tool-catalog-card" data-mcp-server-id="${escapeHtml(server.id)}"><div><strong>${escapeHtml(server.name)}</strong><p>${escapeHtml(server.url)}</p></div><small>${escapeHtml(server.transport)} · ${escapeHtml(server.status)} · auth ${server.authRef ? "configured" : "not configured"} · ${bindings.has(server.id) ? `bound (${escapeHtml(bindings.get(server.id).modeOverride || "default")})` : "not bound to Personal Agent"}</small>${server.status === "active" && state.agentVersionId ? `<button class="quiet-button mcp-binding-action" data-binding-id="${escapeHtml(bindings.get(server.id)?.id || "")}" data-binding-revision="${escapeHtml(String(bindings.get(server.id)?.revision || ""))}" type="button">${bindings.has(server.id) ? "Unbind" : "Bind to Personal Agent"}</button>` : ""}</article>`,
    )
    .join("");
}
async function loadMcpServers() {
  if (!state.token) {
    $("#mcp-catalog-list").innerHTML =
      '<p class="harness-empty">Connect the API to load MCP servers.</p>';
    $("#mcp-catalog-count").textContent = "—";
    return;
  }
  try {
    const servers = await api("/v1/mcp-servers");
    let bindingResult = { bindings: [] };
    try {
      const personal = await api("/v1/agents/personal");
      state.agentVersionId = personal.agent.activeVersion.id;
      bindingResult = await api(
        `/v1/mcp-servers/bindings?agentVersionId=${encodeURIComponent(personal.agent.activeVersion.id)}`,
      );
    } catch {
      // A missing Personal Agent is a valid unbound state.
    }
    renderMcpServers(servers, bindingResult);
  } catch (error) {
    $("#mcp-catalog-list").innerHTML =
      `<p class="harness-empty">${escapeHtml(error instanceof Error ? error.message : "MCP servers unavailable.")}</p>`;
  }
}
async function toggleMcpBinding(button) {
  if (!state.agentVersionId) return;
  const card = button.closest(".tool-catalog-card");
  const serverId = card?.dataset.mcpServerId;
  if (!serverId) return;
  button.disabled = true;
  try {
    if (button.dataset.bindingId) {
      await api(
        `/v1/mcp-server-bindings/${button.dataset.bindingId}?expectedRevision=${encodeURIComponent(button.dataset.bindingRevision)}`,
        { method: "DELETE" },
      );
    } else {
      await apiJson(`/v1/mcp-servers/${serverId}/bindings`, {
        agentVersionId: state.agentVersionId,
        modeOverride: null,
        accountScope: [],
      });
    }
    await loadMcpServers();
    setConnection(true, "MCP binding saved");
  } catch (error) {
    button.disabled = false;
    setConnection(
      false,
      error instanceof Error ? error.message : "MCP binding failed",
    );
  }
}
function renderApprovals(result) {
  const target = $("#approval-inbox-list");
  const approvals = result.approvals || [];
  $("#approval-inbox-count").textContent = `${approvals.length} pending`;
  if (!approvals.length) {
    target.innerHTML = '<p class="harness-empty">No pending approvals.</p>';
    return;
  }
  target.innerHTML = approvals
    .map(
      (approval) =>
        `<article class="approval-inbox-card" data-approval-id="${escapeHtml(approval.id)}" data-tool-call-id="${escapeHtml(approval.toolCallId)}" data-approval-revision="${escapeHtml(String(approval.revision))}"><div><strong>Tool call ${escapeHtml(approval.toolCallId.slice(0, 8))}</strong><p>${escapeHtml(JSON.stringify(approval.arguments))}</p><small>${approval.expiresAt ? `expires ${escapeHtml(new Date(approval.expiresAt).toLocaleString())}` : "no expiry"}</small></div><div class="approval-inbox-actions"><button class="quiet-button approval-inbox-inspect" type="button">Inspect</button><button class="quiet-button approval-inbox-reject" type="button">Reject</button><button class="primary-button approval-inbox-approve" type="button">Approve</button></div></article>`,
    )
    .join("");
}
async function inspectInboxApproval(card) {
  const existing = card.querySelector(".approval-inbox-detail");
  if (existing) {
    existing.remove();
    return;
  }
  try {
    const result = await api(`/v1/tool-calls/${card.dataset.toolCallId}`);
    const call = result.toolCall;
    card.insertAdjacentHTML(
      "beforeend",
      `<pre class="approval-inbox-detail">${escapeHtml(JSON.stringify({ name: call.name, status: call.status, sideEffect: call.sideEffect, dataSensitivity: call.dataSensitivity, accountBinding: call.accountBinding, arguments: call.arguments }, null, 2))}</pre>`,
    );
  } catch (cause) {
    card.insertAdjacentHTML(
      "beforeend",
      `<small class="approval-inbox-detail-error">${escapeHtml(cause instanceof Error ? cause.message : "Tool call unavailable.")}</small>`,
    );
  }
}
async function loadApprovals() {
  if (!state.token) {
    $("#approval-inbox-list").innerHTML =
      '<p class="harness-empty">Connect the API to load approvals.</p>';
    $("#approval-inbox-count").textContent = "—";
    return;
  }
  try {
    renderApprovals(await api("/v1/approvals"));
  } catch (error) {
    $("#approval-inbox-list").innerHTML =
      `<p class="harness-empty">${escapeHtml(error instanceof Error ? error.message : "Approvals unavailable.")}</p>`;
  }
}
function renderInputRequests(result) {
  const target = $("#input-inbox-list");
  const requests = result.inputRequests || [];
  $("#input-inbox-count").textContent = `${requests.length} waiting`;
  if (!requests.length) {
    target.innerHTML = '<p class="harness-empty">No unanswered questions.</p>';
    return;
  }
  target.innerHTML = requests
    .map(
      (request) =>
        `<article class="input-inbox-card" data-request-id="${escapeHtml(request.id)}" data-task-id="${escapeHtml(request.taskId)}"><strong>${escapeHtml(request.prompt)}</strong><textarea class="input-inbox-response" rows="2" maxlength="50000" placeholder="Write an answer…"></textarea><button class="primary-button input-inbox-send" type="button">Answer <span>→</span></button></article>`,
    )
    .join("");
}
async function loadInputRequests() {
  if (!state.token) {
    $("#input-inbox-list").innerHTML =
      '<p class="harness-empty">Connect the API to load questions.</p>';
    $("#input-inbox-count").textContent = "—";
    return;
  }
  try {
    renderInputRequests(await api("/v1/input-requests"));
  } catch (error) {
    $("#input-inbox-list").innerHTML =
      `<p class="harness-empty">${escapeHtml(error instanceof Error ? error.message : "Questions unavailable.")}</p>`;
  }
}
async function answerInputRequest(card) {
  const requestId = card.dataset.requestId;
  const taskId = card.dataset.taskId;
  const response = card.querySelector(".input-inbox-response").value.trim();
  if (!requestId || !taskId || !response) return;
  card.querySelectorAll("button").forEach((button) => (button.disabled = true));
  try {
    await apiJson(`/v1/tasks/${taskId}/input-requests/${requestId}/respond`, {
      response,
    });
    await loadInputRequests();
    await refresh();
  } catch (error) {
    card.insertAdjacentHTML(
      "beforeend",
      `<p class="dialog-error">${escapeHtml(error instanceof Error ? error.message : "Could not answer question.")}</p>`,
    );
    card
      .querySelectorAll("button")
      .forEach((button) => (button.disabled = false));
  }
}
function renderRuntimeInputs(result) {
  const target = $("#runtime-input-inbox-list");
  const runs = result.runs || [];
  $("#runtime-input-inbox-count").textContent = `${runs.length} waiting`;
  if (!runs.length) {
    target.innerHTML =
      '<p class="harness-empty">No Harness runs are waiting.</p>';
    return;
  }
  target.innerHTML = runs
    .map(
      ({ sessionId, run }) =>
        `<article class="input-inbox-card" data-session-id="${escapeHtml(sessionId)}" data-run-id="${escapeHtml(run.id)}"><strong>${escapeHtml(run.waitReason || "The Harness needs input.")}</strong><textarea class="input-inbox-response" rows="2" maxlength="50000" placeholder="Continue this run…"></textarea><button class="primary-button runtime-input-send" type="button">Continue <span>→</span></button></article>`,
    )
    .join("");
}
async function loadRuntimeInputs() {
  if (!state.token) {
    $("#runtime-input-inbox-list").innerHTML =
      '<p class="harness-empty">Connect the API to load waiting runs.</p>';
    $("#runtime-input-inbox-count").textContent = "—";
    return;
  }
  try {
    renderRuntimeInputs(await api("/v1/runtime-input-requests"));
  } catch (error) {
    $("#runtime-input-inbox-list").innerHTML =
      `<p class="harness-empty">${escapeHtml(error instanceof Error ? error.message : "Waiting runs unavailable.")}</p>`;
  }
}
async function answerRuntimeInput(card) {
  const sessionId = card.dataset.sessionId;
  const runId = card.dataset.runId;
  const response = card.querySelector(".input-inbox-response").value.trim();
  if (!sessionId || !runId || !response) return;
  card.querySelectorAll("button").forEach((button) => (button.disabled = true));
  try {
    await apiJson(`/v1/sessions/${sessionId}/runs/${runId}/input`, {
      response,
    });
    await loadRuntimeInputs();
    await refresh();
  } catch (error) {
    card.insertAdjacentHTML(
      "beforeend",
      `<p class="dialog-error">${escapeHtml(error instanceof Error ? error.message : "Could not continue run.")}</p>`,
    );
    card
      .querySelectorAll("button")
      .forEach((button) => (button.disabled = false));
  }
}
async function decideInboxApproval(card, decision) {
  const approvalId = card.dataset.approvalId;
  const expectedRevision = Number(card.dataset.approvalRevision);
  if (!approvalId || !Number.isInteger(expectedRevision)) return;
  card.querySelectorAll("button").forEach((button) => (button.disabled = true));
  try {
    await apiJson(`/v1/approvals/${approvalId}/decision`, {
      expectedRevision,
      decision,
    });
    await loadApprovals();
    await refresh();
  } catch (error) {
    card
      .querySelector(".approval-inbox-actions")
      .insertAdjacentHTML(
        "beforebegin",
        `<p class="dialog-error">${escapeHtml(error instanceof Error ? error.message : "Could not resolve approval.")}</p>`,
      );
    card
      .querySelectorAll("button")
      .forEach((button) => (button.disabled = false));
  }
}
async function previewPolicy() {
  const target = $("#policy-preview-result");
  if (!state.token) {
    target.textContent = "Connect the API to preview a decision.";
    return;
  }
  target.textContent = "Evaluating…";
  try {
    const result = await apiJson("/v1/tools/policy/evaluate", {
      sessionMode: $("#policy-session-mode").value,
      routineMode: "approval_required",
      perToolOverride: null,
      sideEffect: $("#policy-side-effect").value,
      dataSensitivity: $("#policy-data-sensitivity").value,
      inputTrust: $("#policy-input-trust").value,
      targetIsSelf: true,
      targetIsTrusted: true,
      accountBound: $("#policy-account-bound").checked,
    });
    const policy = result.policy;
    target.innerHTML = `<strong>${escapeHtml(policy.decision)}</strong><br />${escapeHtml(policy.rationale)}${policy.riskFlags.length ? `<br /><small>${escapeHtml(policy.riskFlags.join(" · "))}</small>` : ""}`;
  } catch (error) {
    target.textContent =
      error instanceof Error ? error.message : "Policy preview unavailable.";
  }
}
async function startGoogleOAuth() {
  const error = $("#accounts-error");
  error.hidden = true;
  if (!state.token) return;
  try {
    const response = await fetch(
      `${state.base.replace(/\/$/, "")}/v1/accounts/google/oauth/start`,
      {
        headers: {
          Authorization: `Bearer ${state.token}`,
          Accept: "application/json",
        },
        redirect: "manual",
      },
    );
    if (response.status === 302) {
      const locationHeader = response.headers.get("Location");
      if (locationHeader) window.location.assign(locationHeader);
      return;
    }
    const body = await response.json().catch(() => ({}));
    throw new Error(body.code || `OAuth unavailable (${response.status}).`);
  } catch (cause) {
    error.textContent =
      cause instanceof Error ? cause.message : "Google OAuth unavailable.";
    error.hidden = false;
  }
}
function renderChannels(result) {
  const target = $("#channel-list");
  const channels = result.channels || [];
  if (!channels.length) {
    target.innerHTML =
      '<p class="harness-empty">No notification channels configured.</p>';
    return;
  }
  target.innerHTML = channels
    .map(
      (channel) =>
        `<article class="channel-card" data-channel-id="${escapeHtml(channel.id)}"><div><strong>${escapeHtml(channel.kind)}</strong><small>${escapeHtml(channel.address)}</small></div><div class="channel-card-actions"><span class="channel-status ${channel.status === "disabled" ? "disabled" : ""}">${escapeHtml(channel.status)}</span>${channel.status === "active" ? '<button class="quiet-button channel-disable" type="button">Disable</button>' : ""}</div></article>`,
    )
    .join("");
}
async function disableChannel(card) {
  if (!card?.dataset.channelId) return;
  try {
    await api(`/v1/channels/${card.dataset.channelId}`, { method: "DELETE" });
    await loadChannels();
  } catch (cause) {
    const error = $("#channel-error");
    error.textContent =
      cause instanceof Error ? cause.message : "Could not disable channel.";
    error.hidden = false;
  }
}
function renderChannelTimeline(result) {
  const target = $("#channel-timeline-list");
  const items = result.items || [];
  if (!items.length && !result.append) {
    target.innerHTML = '<p class="harness-empty">No delivery events yet.</p>';
    return;
  }
  const markup = items
    .map((item) => {
      const data = item.data || {};
      const label =
        item.kind === "delivery"
          ? `${data.eventType || "delivery"} · ${data.status || "unknown"}`
          : `${data.action || "audit event"} · ${data.outcome || "unknown"}`;
      const detail =
        data.lastError || data.attempts
          ? `attempts ${data.attempts || 0}${data.lastError ? ` · ${data.lastError}` : ""}`
          : item.kind;
      return `<article class="channel-timeline-item"><div><strong>${escapeHtml(label)}</strong><small>${escapeHtml(detail)}</small></div><time>${escapeHtml(formatTime(new Date(item.createdAt)))}</time></article>`;
    })
    .join("");
  if (result.append) target.insertAdjacentHTML("beforeend", markup);
  else target.innerHTML = markup;
  const more = $("#channel-timeline-more");
  more.hidden = !result.nextCursor;
  more.dataset.cursor = result.nextCursor || "";
}
function renderChannelDeliveries(result) {
  const target = $("#channel-delivery-list");
  const deliveries = result.deliveries || [];
  target.innerHTML = deliveries.length
    ? deliveries
        .map(
          (delivery) =>
            `<article class="channel-delivery-item"><div><strong>${escapeHtml(delivery.eventType)}</strong><small>${escapeHtml(delivery.status)} · ${escapeHtml(delivery.channelId.slice(0, 8))} · attempts ${escapeHtml(String(delivery.attempts))}</small></div><time>${escapeHtml(formatTime(new Date(delivery.createdAt)))}</time>${delivery.lastError ? `<p>${escapeHtml(delivery.lastError)}</p>` : ""}</article>`,
        )
        .join("")
    : '<p class="harness-empty">No delivery records match this filter.</p>';
}
async function loadChannelDeliveries() {
  if (!state.token) return;
  const status = $("#channel-delivery-status").value;
  const query = new URLSearchParams({ limit: "20" });
  if (status) query.set("status", status);
  try {
    renderChannelDeliveries(
      await api(`/v1/notification-deliveries?${query.toString()}`),
    );
  } catch (cause) {
    $("#channel-delivery-list").innerHTML =
      `<p class="harness-empty">${escapeHtml(cause instanceof Error ? cause.message : "Delivery records unavailable.")}</p>`;
  }
}
let channelTimelineCursor = "";
async function loadChannelTimeline(append = false) {
  const query =
    append && channelTimelineCursor
      ? `?limit=12&cursor=${encodeURIComponent(channelTimelineCursor)}`
      : "?limit=12";
  const result = await api(`/v1/notification-timeline${query}`);
  channelTimelineCursor = result.nextCursor || "";
  renderChannelTimeline({ ...result, append });
}
async function loadChannels() {
  if (!state.token) {
    $("#channel-list").innerHTML =
      '<p class="harness-empty">Connect the API to load channels.</p>';
    $("#channel-timeline-list").innerHTML =
      '<p class="harness-empty">Connect the API to load delivery history.</p>';
    $("#channel-timeline-more").hidden = true;
    return;
  }
  channelTimelineCursor = "";
  const [channelsResult, timelineResult] = await Promise.allSettled([
    api("/v1/channels"),
    loadChannelTimeline(),
  ]);
  void loadChannelDeliveries();
  if (channelsResult.status === "fulfilled") {
    renderChannels(channelsResult.value);
  } else {
    const error = channelsResult.reason;
    $("#channel-list").innerHTML =
      `<p class="harness-empty">${escapeHtml(error instanceof Error ? error.message : "Channels unavailable.")}</p>`;
  }
  if (timelineResult.status === "rejected") {
    $("#channel-timeline-list").innerHTML =
      '<p class="harness-empty">Delivery timeline unavailable.</p>';
    $("#channel-timeline-more").hidden = true;
  }
}
async function saveChannel() {
  const address = $("#channel-address").value.trim();
  const kind = $("#channel-kind").value;
  const error = $("#channel-error");
  if (!address || !state.token) return;
  error.hidden = true;
  const button = $("#channel-save");
  button.disabled = true;
  try {
    const config = {};
    const credentialRef = $("#channel-credential-ref").value.trim();
    const accountId = $("#channel-account-id").value.trim();
    const phoneNumberId = $("#channel-phone-id").value.trim();
    if (credentialRef) config.credentialRef = credentialRef;
    if (accountId) config.accountId = accountId;
    if (phoneNumberId) config.phoneNumberId = phoneNumberId;
    await apiJson("/v1/channels", {
      kind,
      address,
      config,
    });
    $("#channel-address").value = "";
    $("#channel-credential-ref").value = "";
    $("#channel-account-id").value = "";
    $("#channel-phone-id").value = "";
    $("#channel-add-form").hidden = true;
    await loadChannels();
  } catch (cause) {
    error.textContent =
      cause instanceof Error ? cause.message : "Could not save channel.";
    error.hidden = false;
  } finally {
    button.disabled = false;
  }
}
function updateChannelConfigFields() {
  const kind = $("#channel-kind").value;
  const credential =
    kind === "telegram" || kind === "whatsapp" || kind === "slack";
  const account = kind === "email";
  const phone = kind === "whatsapp";
  $("#channel-credential-label").hidden = !credential;
  $("#channel-credential-ref").hidden = !credential;
  $("#channel-account-label").hidden = !account;
  $("#channel-account-id").hidden = !account;
  $("#channel-phone-label").hidden = !phone;
  $("#channel-phone-id").hidden = !phone;
}
function renderBilling(result) {
  const state = $("#billing-state");
  const usage = $("#usage-list");
  if (result.status === "not_configured") {
    state.innerHTML =
      '<p class="harness-empty">Billing is not configured for this workspace.</p>';
    usage.innerHTML = "";
    return;
  }
  const billing = result.billing;
  state.innerHTML = `<strong>${escapeHtml(billing.planName)}</strong><small>${escapeHtml(billing.creditBand)} · ${billing.isBlocked ? "blocked" : "available"} · period ${escapeHtml(new Date(result.period.start).toLocaleDateString())}–${escapeHtml(new Date(result.period.end).toLocaleDateString())}</small>`;
  usage.innerHTML = (result.usage || []).length
    ? result.usage
        .map(
          (item) =>
            `<div class="usage-row"><span>${escapeHtml(item.category)}</span><strong>${escapeHtml(item.quantity)} ${escapeHtml(item.unit)}</strong></div>`,
        )
        .join("")
    : '<p class="harness-empty">No usage recorded for this period.</p>';
}
async function loadBilling() {
  if (!state.token) {
    $("#billing-state").innerHTML =
      '<p class="harness-empty">Connect the API to load billing state.</p>';
    return;
  }
  try {
    renderBilling(await api("/v1/billing"));
  } catch (error) {
    $("#billing-state").innerHTML =
      `<p class="harness-empty">${escapeHtml(error instanceof Error ? error.message : "Billing unavailable.")}</p>`;
  }
}
function renderSuggestions(result, append = false) {
  const target = $("#suggestion-list");
  const suggestions = result.suggestions || [];
  if (!suggestions.length && !append) {
    target.innerHTML =
      '<p class="harness-empty">Nothing needs your attention right now.</p>';
    state.suggestionsCursor = null;
    $("#suggestions-more").hidden = true;
    return;
  }
  const html = suggestions
    .map(
      (suggestion) =>
        `<article class="suggestion-card" data-suggestion-id="${escapeHtml(suggestion.id)}" data-suggestion-revision="${escapeHtml(suggestion.revision)}"><div class="suggestion-copy"><span class="suggestion-kind">${escapeHtml(suggestion.kind)} · ${escapeHtml(suggestion.sourceType)}</span><strong>${escapeHtml(suggestion.title)}</strong><p>${escapeHtml(suggestion.body)}</p><small>${escapeHtml(suggestion.sourceRef)}</small></div><div class="suggestion-actions"><button class="quiet-button suggestion-dismiss" type="button">Dismiss</button><button class="primary-button suggestion-convert" type="button">Make task <span>→</span></button></div></article>`,
    )
    .join("");
  if (append) target.insertAdjacentHTML("beforeend", html);
  else target.innerHTML = html;
  state.suggestionsCursor = result.nextCursor || null;
  $("#suggestions-more").hidden = !state.suggestionsCursor;
}
async function loadSuggestions(loadMore = false) {
  if (!state.token) {
    state.suggestionsCursor = null;
    $("#suggestions-more").hidden = true;
    $("#suggestion-list").innerHTML =
      '<p class="harness-empty">Connect the API to load suggestions.</p>';
    return;
  }
  try {
    if (!loadMore) await apiJson("/v1/suggestions/refresh", {});
    const cursor = loadMore ? state.suggestionsCursor : null;
    const query = new URLSearchParams({ status: "open", limit: "20" });
    if (cursor) query.set("cursor", cursor);
    renderSuggestions(
      await api("/v1/suggestions?" + query.toString()),
      loadMore,
    );
  } catch (error) {
    state.suggestionsCursor = null;
    $("#suggestions-more").hidden = true;
    $("#suggestion-list").innerHTML =
      `<p class="harness-empty">${escapeHtml(error instanceof Error ? error.message : "Suggestions unavailable.")}</p>`;
  }
}
async function transitionSuggestion(card, status) {
  const id = card.dataset.suggestionId;
  const revision = Number(card.dataset.suggestionRevision);
  if (!id || !Number.isInteger(revision)) return;
  const error = $("#suggestions-error");
  error.hidden = true;
  card.querySelectorAll("button").forEach((button) => (button.disabled = true));
  try {
    const result = await api(`/v1/suggestions/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ expectedRevision: revision, status }),
    });
    if (status === "converted") {
      setConnection(true, "Task created");
      await refresh();
      await loadTasks();
    }
    card.remove();
    if (!$("#suggestion-list").querySelector(".suggestion-card"))
      $("#suggestion-list").innerHTML =
        '<p class="harness-empty">Nothing needs your attention right now.</p>';
    return result;
  } catch (cause) {
    error.textContent =
      cause instanceof Error ? cause.message : "Could not update suggestion.";
    error.hidden = false;
    card
      .querySelectorAll("button")
      .forEach((button) => (button.disabled = false));
  }
}
function renderSquares(result) {
  const target = $("#square-list");
  const squares = result.squares || [];
  if (!squares.length) {
    target.innerHTML = '<p class="harness-empty">No active Squares yet.</p>';
    return;
  }
  target.innerHTML = squares
    .map(
      (square) =>
        `<article class="square-card" data-square-id="${escapeHtml(square.id)}"><div><strong>${escapeHtml(square.name)}</strong><p>${escapeHtml(square.description || "No description")}</p><small>${escapeHtml(square.slug)} · ${escapeHtml(square.membership.role)} · ${escapeHtml(square.membership.status)}</small></div><div class="square-card-actions"><span class="square-status">${escapeHtml(square.status)}</span><button class="quiet-button square-inspect" type="button">Inspect</button></div></article>`,
    )
    .join("");
}
function renderSquareAccounts(result, accounts) {
  const shares = result.accounts || [];
  const target = $("#square-account-shares");
  target.innerHTML = shares.length
    ? shares
        .map(
          (share) =>
            `<div class="square-account-share"><div><strong>${escapeHtml(share.provider)} · ${escapeHtml(share.email)}</strong><small>${escapeHtml(share.capabilities.join(", ") || "No capabilities")}</small></div><button class="quiet-button square-account-revoke" data-share-id="${escapeHtml(share.id)}" type="button">Revoke</button></div>`,
        )
        .join("")
    : '<p class="harness-empty">No connected accounts are shared with this Square.</p>';
  const select = $("#square-account-select");
  const activeAccounts = (accounts.accounts || []).filter(
    (account) => account.isActive,
  );
  select.innerHTML = activeAccounts.length
    ? activeAccounts
        .map(
          (account) =>
            `<option value="${escapeHtml(account.id)}" data-owner-id="${escapeHtml(account.ownerId)}">${escapeHtml(account.provider)} · ${escapeHtml(account.email)}</option>`,
        )
        .join("")
    : '<option value="">No active accounts available</option>';
  $("#square-account-grant").hidden = !activeAccounts.length;
  renderSquareCapabilities(activeAccounts[0]);
}
function renderSquareMembers(members) {
  const items = members.members || [];
  $("#square-members").innerHTML = items.length
    ? items
        .map(
          (member) =>
            `<div class="square-member" data-user-id="${escapeHtml(member.userId)}"><span class="square-member-id">${escapeHtml(member.userId.slice(0, 8))}</span><select class="square-member-role"><option value="owner" ${member.role === "owner" ? "selected" : ""}>Owner</option><option value="admin" ${member.role === "admin" ? "selected" : ""}>Admin</option><option value="member" ${member.role === "member" ? "selected" : ""}>Member</option></select><select class="square-member-status"><option value="active" ${member.status === "active" ? "selected" : ""}>Active</option><option value="invited" ${member.status === "invited" ? "selected" : ""}>Invited</option><option value="suspended" ${member.status === "suspended" ? "selected" : ""}>Suspended</option></select><button class="quiet-button square-member-save" type="button">Save</button></div>`,
        )
        .join("")
    : '<p class="harness-empty">No active members returned.</p>';
}
async function updateSquareMember(row) {
  if (!state.selectedSquareId || !row) return;
  const error = $("#square-member-error");
  try {
    await api(
      `/v1/squares/${state.selectedSquareId}/members/${row.dataset.userId}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          role: row.querySelector(".square-member-role").value,
          status: row.querySelector(".square-member-status").value,
        }),
      },
    );
    const members = await api(`/v1/squares/${state.selectedSquareId}/members`);
    renderSquareMembers(members);
  } catch (cause) {
    error.textContent =
      cause instanceof Error ? cause.message : "Could not update member.";
    error.hidden = false;
  }
}
async function addSquareMember() {
  if (!state.selectedSquareId) return;
  const userId = $("#square-member-user-id").value.trim();
  const error = $("#square-member-error");
  if (!userId) {
    error.textContent = "Enter a user UUID.";
    error.hidden = false;
    return;
  }
  try {
    await apiJson(`/v1/squares/${state.selectedSquareId}/members`, {
      userId,
      role: $("#square-member-role").value,
      status: "active",
    });
    $("#square-member-user-id").value = "";
    const members = await api(`/v1/squares/${state.selectedSquareId}/members`);
    renderSquareMembers(members);
    error.hidden = true;
  } catch (cause) {
    error.textContent =
      cause instanceof Error ? cause.message : "Could not add member.";
    error.hidden = false;
  }
}
function renderSquareCapabilities(account) {
  const target = $("#square-account-capabilities");
  const capabilities = account
    ? Object.entries(account.capabilities || {})
        .filter(([, value]) => value === true)
        .map(([key]) => key)
    : [];
  target.innerHTML = capabilities.length
    ? capabilities
        .map(
          (capability) =>
            `<label><input type="checkbox" value="${escapeHtml(capability)}" checked /> ${escapeHtml(capability)}</label>`,
        )
        .join("")
    : '<small class="form-hint">This account has no enabled capabilities to share.</small>';
}
async function loadSquareAccounts(squareId) {
  const target = $("#square-account-shares");
  target.innerHTML = '<p class="harness-empty">Reading shared accounts…</p>';
  try {
    const [shares, accounts] = await Promise.all([
      api(`/v1/squares/${squareId}/accounts`),
      api("/v1/accounts"),
    ]);
    renderSquareAccounts(shares, accounts);
  } catch (error) {
    target.innerHTML = `<p class="harness-empty">${escapeHtml(error instanceof Error ? error.message : "Shared accounts unavailable.")}</p>`;
    $("#square-account-grant").hidden = true;
  }
}
async function grantSquareAccount() {
  const squareId = state.selectedSquareId;
  const select = $("#square-account-select");
  const option = select.selectedOptions[0];
  const accountId = select.value;
  const capabilities = [
    ...document.querySelectorAll("#square-account-capabilities input:checked"),
  ].map((input) => input.value);
  const error = $("#square-account-error");
  if (!squareId || !accountId || !option || !capabilities.length) {
    error.textContent = "Choose an account and at least one capability.";
    error.hidden = false;
    return;
  }
  error.hidden = true;
  const button = $("#square-account-grant-button");
  button.disabled = true;
  try {
    await apiJson(`/v1/squares/${squareId}/accounts`, {
      accountId,
      accountOwnerId: option.dataset.ownerId,
      capabilities,
    });
    await loadSquareAccounts(squareId);
  } catch (cause) {
    error.textContent =
      cause instanceof Error ? cause.message : "Could not share account.";
    error.hidden = false;
  } finally {
    button.disabled = false;
  }
}
async function revokeSquareAccount(shareId) {
  if (!state.selectedSquareId || !shareId) return;
  try {
    await api(`/v1/square-account-shares/${shareId}`, { method: "DELETE" });
    await loadSquareAccounts(state.selectedSquareId);
  } catch (cause) {
    const error = $("#square-account-error");
    error.textContent =
      cause instanceof Error ? cause.message : "Could not revoke account.";
    error.hidden = false;
  }
}
async function inspectSquare(squareId, card) {
  if (!squareId || !state.token) return;
  const detail = $("#square-detail");
  state.selectedSquareId = squareId;
  detail.hidden = false;
  $("#square-detail-name").textContent = "Loading…";
  $("#square-detail-mode").textContent = "—";
  $("#square-members").innerHTML =
    '<p class="harness-empty">Reading members and policy…</p>';
  try {
    const [square, members, policy] = await Promise.all([
      api(`/v1/squares/${squareId}`),
      api(`/v1/squares/${squareId}/members`),
      api(`/v1/squares/${squareId}/policy`),
    ]);
    $("#square-detail-name").textContent = square.square.name;
    $("#square-detail-mode").textContent = policy.policy.defaultMode;
    state.squarePolicyRevision = policy.policy.revision;
    $("#square-policy-mode").value = policy.policy.defaultMode;
    $("#square-policy-domains").value = policy.policy.allowedDomains.join("\n");
    $("#square-policy-tools").value = policy.policy.allowedToolNames.join("\n");
    renderSquareMembers(members);
    $("#square-policy").textContent =
      `Tools: ${policy.policy.allowedToolNames.length || "none"} allowed · Domains: ${policy.policy.allowedDomains.length || "none"} allowed · policy revision ${policy.policy.revision}`;
    await loadSquareAccounts(squareId);
    document.querySelectorAll(".square-card").forEach((item) => {
      item.classList.toggle("is-selected", item === card);
    });
  } catch (error) {
    $("#square-members").innerHTML =
      `<p class="harness-empty">${escapeHtml(error instanceof Error ? error.message : "Square details unavailable.")}</p>`;
  }
}
async function saveSquarePolicy() {
  if (!state.selectedSquareId || !state.squarePolicyRevision) return;
  const error = $("#square-policy-error");
  const domains = $("#square-policy-domains")
    .value.split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean);
  const tools = $("#square-policy-tools")
    .value.split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean);
  try {
    const result = await api(`/v1/squares/${state.selectedSquareId}/policy`, {
      method: "PATCH",
      body: JSON.stringify({
        expectedRevision: state.squarePolicyRevision,
        defaultMode: $("#square-policy-mode").value,
        allowedDomains: domains,
        allowedToolNames: tools,
        settings: {},
      }),
    });
    state.squarePolicyRevision = result.policy.revision;
    $("#square-detail-mode").textContent = result.policy.defaultMode;
    $("#square-policy").textContent =
      `Tools: ${result.policy.allowedToolNames.length || "none"} allowed · Domains: ${result.policy.allowedDomains.length || "none"} allowed · policy revision ${result.policy.revision}`;
    error.hidden = true;
  } catch (cause) {
    error.textContent =
      cause instanceof Error ? cause.message : "Could not save Square policy.";
    error.hidden = false;
  }
}
async function loadSquares() {
  if (!state.token) {
    $("#square-list").innerHTML =
      '<p class="harness-empty">Connect the API to load Squares.</p>';
    return;
  }
  try {
    renderSquares(await api("/v1/squares"));
  } catch (error) {
    $("#square-list").innerHTML =
      `<p class="harness-empty">${escapeHtml(error instanceof Error ? error.message : "Squares unavailable.")}</p>`;
  }
}
async function saveSquare() {
  const name = $("#square-name").value.trim();
  const slug = $("#square-slug").value.trim();
  const error = $("#square-error");
  if (!name || !slug || !state.token) return;
  error.hidden = true;
  const button = $("#square-save");
  button.disabled = true;
  try {
    await apiJson("/v1/squares", {
      name,
      slug,
      description: $("#square-description").value.trim(),
      settings: {},
    });
    $("#square-name").value = "";
    $("#square-slug").value = "";
    $("#square-description").value = "";
    $("#square-add-form").hidden = true;
    await loadSquares();
  } catch (cause) {
    error.textContent =
      cause instanceof Error ? cause.message : "Could not create Square.";
    error.hidden = false;
  } finally {
    button.disabled = false;
  }
}
function renderA2A(result) {
  const target = $("#a2a-list");
  const requests = result.requests || [];
  if (!requests.length) {
    target.innerHTML = '<p class="harness-empty">No agent requests yet.</p>';
    return;
  }
  target.innerHTML = requests
    .map((request) => {
      const expiry = request.expiresAt
        ? `expires ${new Date(request.expiresAt).toLocaleString()}`
        : "no expiry";
      const actionable = request.status === "pending";
      const revocable = request.consentStatus === "granted";
      const consent = `${request.consentStatus || "pending"}${request.consentScope?.length ? ` · ${request.consentScope.join(", ")}` : ""}`;
      const lifecycle =
        request.status === "accepted"
          ? '<button class="primary-button a2a-complete" type="button">Mark completed</button>'
          : request.status === "pending"
            ? '<button class="quiet-button a2a-cancel" type="button">Cancel request</button>'
            : "";
      return `<article class="a2a-card" data-a2a-id="${escapeHtml(request.id)}" data-a2a-revision="${escapeHtml(request.revision)}"><div class="a2a-copy"><span class="a2a-meta">${escapeHtml(request.status)} · ${escapeHtml(consent)} · revision ${escapeHtml(request.revision)}</span><strong>${escapeHtml(request.capability)}</strong><p>${escapeHtml(JSON.stringify(request.request))}</p><small>${escapeHtml(request.requesterId.slice(0, 8))} → ${escapeHtml(request.recipientId.slice(0, 8))} · ${escapeHtml(expiry)}</small></div>${actionable ? `<div class="a2a-actions"><button class="quiet-button a2a-decline" type="button">Decline</button><button class="primary-button a2a-accept" type="button">Grant this capability <span>→</span></button>${lifecycle}</div>` : revocable ? `<div class="a2a-actions"><button class="quiet-button a2a-revoke" type="button">Revoke consent</button>${lifecycle}</div>` : lifecycle ? `<div class="a2a-actions">${lifecycle}</div>` : ""}</article>`;
    })
    .join("");
}
async function loadA2A() {
  if (!state.token) {
    $("#a2a-list").innerHTML =
      '<p class="harness-empty">Connect the API to load requests.</p>';
    return;
  }
  try {
    renderA2A(await api("/v1/a2a/requests"));
  } catch (error) {
    $("#a2a-list").innerHTML =
      `<p class="harness-empty">${escapeHtml(error instanceof Error ? error.message : "Agent requests unavailable.")}</p>`;
  }
}
async function saveA2A() {
  const recipientId = $("#a2a-recipient").value.trim();
  const capability = $("#a2a-capability").value.trim();
  const error = $("#a2a-error");
  if (!recipientId || !capability || !state.token) return;
  error.hidden = true;
  let request;
  try {
    request = JSON.parse($("#a2a-request").value);
  } catch {
    error.textContent = "Request must be valid JSON.";
    error.hidden = false;
    return;
  }
  if (
    request === null ||
    Array.isArray(request) ||
    typeof request !== "object"
  ) {
    error.textContent = "Request JSON must be an object.";
    error.hidden = false;
    return;
  }
  const button = $("#a2a-save");
  button.disabled = true;
  try {
    await apiJson("/v1/a2a/requests", { recipientId, capability, request });
    $("#a2a-recipient").value = "";
    $("#a2a-capability").value = "";
    $("#a2a-request").value = "{}";
    $("#a2a-add-form").hidden = true;
    await loadA2A();
  } catch (cause) {
    error.textContent =
      cause instanceof Error ? cause.message : "Could not send request.";
    error.hidden = false;
  } finally {
    button.disabled = false;
  }
}
async function transitionA2A(card, decision) {
  const id = card.dataset.a2aId;
  const revision = Number(card.dataset.a2aRevision);
  if (!id || !Number.isInteger(revision)) return;
  const error = $("#a2a-transition-error");
  error.hidden = true;
  card.querySelectorAll("button").forEach((button) => (button.disabled = true));
  try {
    await api(`/v1/a2a/requests/${id}/consent`, {
      method: "POST",
      body: JSON.stringify({
        decision,
        expectedRevision: revision,
        scope:
          decision === "grant"
            ? [card.querySelector(".a2a-copy strong").textContent]
            : [],
      }),
    });
    await loadA2A();
  } catch (cause) {
    error.textContent =
      cause instanceof Error ? cause.message : "Could not update request.";
    error.hidden = false;
    card
      .querySelectorAll("button")
      .forEach((button) => (button.disabled = false));
  }
}
async function transitionA2ALifecycle(card, status) {
  if (!card) return;
  const error = $("#a2a-transition-error");
  try {
    await api(`/v1/a2a/requests/${card.dataset.a2aId}`, {
      method: "PATCH",
      body: JSON.stringify({
        status,
        expectedRevision: Number(card.dataset.a2aRevision),
      }),
    });
    await loadA2A();
  } catch (cause) {
    error.textContent =
      cause instanceof Error ? cause.message : "Could not transition request.";
    error.hidden = false;
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
    await loadSchedule();
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
  $("#api-revoke").hidden = !state.token;
  $("#connect-error").hidden = true;
  openDialog($("#connect-dialog"));
});
$("#api-revoke").addEventListener("click", async () => {
  if (!state.token) return;
  const error = $("#connect-error");
  try {
    await api("/v1/me/session", { method: "DELETE" });
    state.token = "";
    sessionStorage.removeItem(storageKeys.token);
    setConnection(false);
    closeDialog($("#connect-dialog"));
  } catch (cause) {
    error.textContent =
      cause instanceof Error ? cause.message : "Could not revoke session.";
    error.hidden = false;
  }
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
$("#operations-open").addEventListener("click", () => {
  state.operationsCursor = null;
  $("#operations-error").hidden = true;
  openDialog($("#operations-dialog"));
  void loadOperations();
});
$("#operations-outcome").addEventListener("change", () => {
  state.operationsCursor = null;
  void loadOperations();
});
$("#operations-more").addEventListener(
  "click",
  () => void loadOperations(true),
);
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
  openDialog($("#people-dialog"));
  void loadPeople();
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
$("#library-content-list").addEventListener("click", (event) => {
  const button = event.target.closest(".content-share-button");
  const card = event.target.closest(".library-content-item");
  if (!card) return;
  if (event.target.closest(".content-history-button")) {
    void loadContentHistory(card);
    return;
  }
  if (event.target.closest(".content-edit-button")) {
    void editContent(card);
    return;
  }
  if (event.target.closest(".content-edit-save")) {
    void saveContentEdit(card);
    return;
  }
  if (event.target.closest(".content-archive-button")) {
    void archiveContent(card);
    return;
  }
  if (!button) return;
  void createContentShare(card.dataset.contentId, card);
});
$("#content-add-toggle").addEventListener("click", () => {
  $("#content-add-form").hidden = !$("#content-add-form").hidden;
  if (!$("#content-add-form").hidden) $("#content-title").focus();
});
$("#content-save").addEventListener("click", () => void saveContent());
$("#collection-add-toggle").addEventListener("click", () => {
  $("#collection-add-form").hidden = !$("#collection-add-form").hidden;
  if (!$("#collection-add-form").hidden) $("#collection-name").focus();
});
$("#collection-save").addEventListener("click", () => void saveCollection());
$("#collection-list").addEventListener("click", (event) => {
  const button = event.target.closest(".collection-open");
  if (button) void openCollection(button);
  const add = event.target.closest(".collection-content-add");
  if (add) void addContentToCollection(add);
});
$("#wiki-add-toggle").addEventListener("click", () => {
  $("#wiki-add-form").hidden = !$("#wiki-add-form").hidden;
  if (!$("#wiki-add-form").hidden) $("#wiki-title").focus();
});
$("#wiki-save").addEventListener("click", () => void saveWiki());
$("#wiki-list").addEventListener("click", (event) => {
  const card = event.target.closest(".wiki-card");
  if (!card) return;
  if (event.target.closest(".wiki-edit")) void editWiki(card);
  if (event.target.closest(".wiki-edit-save"))
    void saveWikiEdit(card).catch((cause) => {
      const error = $("#wiki-error");
      error.textContent =
        cause instanceof Error ? cause.message : "Could not edit Wiki page.";
      error.hidden = false;
    });
});
$("#knowledge-conflict-list").addEventListener("click", (event) => {
  const card = event.target.closest(".knowledge-conflict-card");
  if (!card) return;
  if (event.target.closest(".knowledge-conflict-accept"))
    void resolveKnowledgeConflict(card, "accept");
  if (event.target.closest(".knowledge-conflict-reject"))
    void resolveKnowledgeConflict(card, "reject");
});
$("#library-content-more").addEventListener(
  "click",
  () => void loadMoreLibraryContent(),
);
$("#content-share-copy").addEventListener("click", async () => {
  const url = $("#content-share-url").value;
  if (!url) return;
  try {
    await navigator.clipboard.writeText(url);
    $("#content-share-copy").textContent = "Copied";
  } catch {
    $("#content-share-url").select();
  }
});
$("#content-share-revoke").addEventListener("click", async () => {
  const status = $("#content-share-status");
  const shareId = status.dataset.shareId;
  if (!shareId) return;
  const button = $("#content-share-revoke");
  button.disabled = true;
  try {
    await api(`/v1/content/shares/${shareId}`, { method: "DELETE" });
    status.hidden = true;
    $("#content-share-url").value = "";
    delete status.dataset.shareId;
  } catch (cause) {
    button.textContent =
      cause instanceof Error ? cause.message : "Could not revoke link.";
  } finally {
    button.disabled = false;
  }
});
$("#memory-add-toggle").addEventListener("click", () => {
  $("#memory-add-form").hidden = !$("#memory-add-form").hidden;
  if (!$("#memory-add-form").hidden) $("#memory-content").focus();
});
$("#memory-save").addEventListener("click", () => void saveMemory());
$("#memory-list").addEventListener("click", (event) => {
  const card = event.target.closest(".memory-card");
  if (!card) return;
  if (event.target.closest(".memory-edit"))
    card.querySelector(".memory-edit-form").hidden = false;
  if (event.target.closest(".memory-edit-save"))
    void saveMemoryEdit(card).catch((cause) => {
      const error = $("#memory-error");
      error.textContent =
        cause instanceof Error ? cause.message : "Could not edit memory.";
      error.hidden = false;
    });
  if (event.target.closest(".memory-retire"))
    void retireMemory(card).catch((cause) => {
      const error = $("#memory-error");
      error.textContent =
        cause instanceof Error ? cause.message : "Could not retire memory.";
      error.hidden = false;
    });
});
$("#people-add-toggle").addEventListener("click", () => {
  $("#people-add-form").hidden = !$("#people-add-form").hidden;
  if (!$("#people-add-form").hidden) $("#person-name").focus();
});
$("#person-save").addEventListener("click", () => void savePerson());
$("#people-list").addEventListener("click", (event) => {
  const edit = event.target.closest(".person-edit");
  const save = event.target.closest(".person-edit-save");
  const button = event.target.closest(".person-relationships");
  const card = event.target.closest(".person-card");
  if (edit && card) {
    void editPerson(card);
    return;
  }
  if (save && card) {
    void savePersonEdit(card).catch((cause) => {
      const error = $("#people-error");
      error.textContent =
        cause instanceof Error ? cause.message : "Could not edit person.";
      error.hidden = false;
    });
    return;
  }
  if (button && card) void loadRelationships(card.dataset.personId);
});
$("#relationship-save").addEventListener(
  "click",
  () => void saveRelationship(),
);
$("#relationship-list").addEventListener("click", (event) => {
  const button = event.target.closest(".relationship-retire");
  if (button) void retireRelationship(button);
});
document.querySelector(".profile-chip").addEventListener("click", (event) => {
  event.preventDefault();
  $("#profile-error").hidden = true;
  openDialog($("#profile-dialog"));
  void loadProfile();
  void loadAgentSettings();
});
$("#profile-save").addEventListener("click", () => void saveProfile());
$("#agent-save").addEventListener("click", () => void saveAgentSettings());
$("#mcp-catalog-list").addEventListener("click", (event) => {
  const button = event.target.closest(".mcp-binding-action");
  if (button) void toggleMcpBinding(button);
});
$("#tasks-open").addEventListener("click", () => {
  openDialog($("#tasks-dialog"));
  void loadTasks();
});
$("#task-add-toggle").addEventListener("click", () => {
  $("#task-add-form").hidden = !$("#task-add-form").hidden;
  if (!$("#task-add-form").hidden) $("#task-title").focus();
});
$("#task-save").addEventListener("click", () => void saveTask());
$("#task-list").addEventListener("click", (event) => {
  const card = event.target.closest(".task-card");
  if (!card) return;
  if (event.target.closest(".task-edit")) void editTask(card);
  if (event.target.closest(".task-edit-save"))
    void saveTaskEdit(card).catch((cause) => {
      const error = $("#task-error");
      error.textContent =
        cause instanceof Error ? cause.message : "Could not edit task.";
      error.hidden = false;
    });
  if (event.target.closest(".task-mark-read"))
    void markTaskRead(card).catch((cause) => {
      const error = $("#task-error");
      error.textContent =
        cause instanceof Error ? cause.message : "Could not mark task read.";
      error.hidden = false;
    });
  if (event.target.closest(".task-delete"))
    void deleteTask(card).catch((cause) => {
      const error = $("#task-error");
      error.textContent =
        cause instanceof Error ? cause.message : "Could not delete task.";
      error.hidden = false;
    });
});
$("#routines-open").addEventListener("click", () => {
  selectedRoutineId = null;
  $("#routine-trigger").hidden = true;
  $("#routine-history").hidden = true;
  openDialog($("#routines-dialog"));
  void loadRoutines();
});
$("#routine-run").addEventListener("click", () => void runSelectedRoutine());
$("#routine-edit-save").addEventListener("click", () => void saveRoutineEdit());
$("#routine-edit-delete").addEventListener("click", () => void deleteRoutine());
$("#routine-share-create").addEventListener(
  "click",
  () => void createRoutineShare(),
);
$("#routine-share-revoke").addEventListener(
  "click",
  () => void revokeRoutineShare(),
);
$("#routine-share-copy").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText($("#routine-share-url").value);
    $("#routine-share-copy").textContent = "Copied";
  } catch {
    $("#routine-share-url").select();
  }
});
$("#routine-install-button").addEventListener(
  "click",
  () => void installSharedRoutine(),
);
$("#routine-trigger-list").addEventListener("click", (event) => {
  const button = event.target.closest(".routine-trigger-toggle");
  const row =
    button?.closest(".routine-trigger-row") ||
    event.target.closest(".routine-trigger-row");
  if (button) void toggleRoutineTrigger(row);
  if (event.target.closest(".routine-trigger-delete"))
    void deleteRoutineTrigger(row);
});
$("#routine-trigger-add-button").addEventListener(
  "click",
  () => void addRoutineTrigger(),
);
$("#routine-email-ingest-button").addEventListener(
  "click",
  () => void ingestRoutineEmail(),
);
$("#routine-template-install").addEventListener(
  "click",
  () => void installRoutineTemplate(),
);
$("#routine-run-list").addEventListener("click", (event) => {
  const button = event.target.closest(".routine-replay");
  if (button) void replayRoutineRun(button.dataset.runId, button);
});
$("#routine-webhook-create").addEventListener(
  "click",
  () => void createRoutineWebhook(),
);
$("#routine-webhook-toggle").addEventListener(
  "click",
  () => void toggleRoutineWebhook(),
);
$("#routine-webhook-copy").addEventListener("click", async () => {
  const token = $("#routine-webhook-token").value;
  if (!token) return;
  try {
    await navigator.clipboard.writeText(token);
    $("#routine-webhook-copy").textContent = "Copied";
  } catch {
    $("#routine-webhook-token").select();
  }
});
$("#account-open").addEventListener("click", () => {
  $("#accounts-error").hidden = true;
  openDialog($("#accounts-dialog"));
  void loadAccounts();
  void loadTools();
  void loadMcpServers();
  void loadApprovals();
  void loadInputRequests();
  void loadRuntimeInputs();
});
$("#account-list").addEventListener("click", (event) => {
  const card = event.target.closest(".account-card");
  if (!card) return;
  if (event.target.closest(".account-refresh")) void refreshAccount(card);
  if (event.target.closest(".account-remove")) void removeAccount(card);
});
$("#policy-preview-run").addEventListener("click", () => void previewPolicy());
$("#approval-inbox-list").addEventListener("click", (event) => {
  const button = event.target.closest("button");
  const card = event.target.closest(".approval-inbox-card");
  if (!button || !card) return;
  if (button.classList.contains("approval-inbox-inspect")) {
    void inspectInboxApproval(card);
    return;
  }
  void decideInboxApproval(
    card,
    button.classList.contains("approval-inbox-approve") ? "approve" : "reject",
  );
});
$("#input-inbox-list").addEventListener("click", (event) => {
  const button = event.target.closest(".input-inbox-send");
  const card = event.target.closest(".input-inbox-card");
  if (button && card) void answerInputRequest(card);
});
$("#runtime-input-inbox-list").addEventListener("click", (event) => {
  const button = event.target.closest(".runtime-input-send");
  const card = event.target.closest(".input-inbox-card");
  if (button && card) void answerRuntimeInput(card);
});
$("#google-connect").addEventListener("click", () => void startGoogleOAuth());
$("#channels-open").addEventListener("click", () => {
  openDialog($("#channels-dialog"));
  void loadChannels();
});
$("#channel-timeline-more").addEventListener("click", () => {
  void loadChannelTimeline(true).catch(() => undefined);
});
$("#channel-delivery-status").addEventListener(
  "change",
  () => void loadChannelDeliveries(),
);
$("#channel-add-toggle").addEventListener("click", () => {
  $("#channel-add-form").hidden = !$("#channel-add-form").hidden;
  if (!$("#channel-add-form").hidden) $("#channel-address").focus();
});
$("#channel-save").addEventListener("click", () => void saveChannel());
$("#channel-list").addEventListener("click", (event) => {
  const button = event.target.closest(".channel-disable");
  const card = event.target.closest(".channel-card");
  if (button && card) void disableChannel(card);
});
$("#channel-kind").addEventListener("change", updateChannelConfigFields);
updateChannelConfigFields();
$("#billing-open").addEventListener("click", () => {
  openDialog($("#billing-dialog"));
  void loadBilling();
});
$("#suggestions-open").addEventListener("click", () => {
  $("#suggestions-error").hidden = true;
  state.suggestionsCursor = null;
  $("#suggestions-more").hidden = true;
  openDialog($("#suggestions-dialog"));
  void loadSuggestions();
});
$("#suggestions-more").addEventListener("click", () => {
  void loadSuggestions(true).catch(() => undefined);
});
$("#schedule-list").addEventListener("click", (event) => {
  const button = event.target.closest(".schedule-filter");
  if (!button) return;
  const calendarId = button.dataset.calendarId;
  if (!calendarId) return;
  state.scheduleCalendarVisibility.set(
    calendarId,
    state.scheduleCalendarVisibility.get(calendarId) === false,
  );
  renderScheduleItems();
});
$("#suggestion-list").addEventListener("click", (event) => {
  const button = event.target.closest("button");
  const card = event.target.closest(".suggestion-card");
  if (!button || !card) return;
  void transitionSuggestion(
    card,
    button.classList.contains("suggestion-convert") ? "converted" : "dismissed",
  );
});
$("#squares-open").addEventListener("click", () => {
  openDialog($("#squares-dialog"));
  void loadSquares();
});
$("#square-add-toggle").addEventListener("click", () => {
  $("#square-add-form").hidden = !$("#square-add-form").hidden;
  if (!$("#square-add-form").hidden) $("#square-name").focus();
});
$("#square-save").addEventListener("click", () => void saveSquare());
$("#square-policy-save").addEventListener(
  "click",
  () => void saveSquarePolicy(),
);
$("#square-list").addEventListener("click", (event) => {
  const button = event.target.closest(".square-inspect");
  const card = event.target.closest(".square-card");
  if (!button || !card) return;
  void inspectSquare(card.dataset.squareId, card);
});
$("#square-account-select").addEventListener("change", () => {
  const accountId = $("#square-account-select").value;
  void api("/v1/accounts").then((result) =>
    renderSquareCapabilities(
      (result.accounts || []).find((account) => account.id === accountId),
    ),
  );
});
$("#square-account-grant-button").addEventListener(
  "click",
  () => void grantSquareAccount(),
);
$("#square-account-shares").addEventListener("click", (event) => {
  const button = event.target.closest(".square-account-revoke");
  if (button) void revokeSquareAccount(button.dataset.shareId);
});
$("#square-member-add-button").addEventListener(
  "click",
  () => void addSquareMember(),
);
$("#square-members").addEventListener("click", (event) => {
  const button = event.target.closest(".square-member-save");
  if (button) void updateSquareMember(button.closest(".square-member"));
});
$("#a2a-open").addEventListener("click", () => {
  $("#a2a-transition-error").hidden = true;
  openDialog($("#a2a-dialog"));
  void loadA2A();
});
$("#a2a-add-toggle").addEventListener("click", () => {
  $("#a2a-add-form").hidden = !$("#a2a-add-form").hidden;
  if (!$("#a2a-add-form").hidden) $("#a2a-recipient").focus();
});
$("#a2a-save").addEventListener("click", () => void saveA2A());
$("#a2a-list").addEventListener("click", (event) => {
  const button = event.target.closest("button");
  const card = event.target.closest(".a2a-card");
  if (!button || !card) return;
  if (button.classList.contains("a2a-complete")) {
    void transitionA2ALifecycle(card, "completed");
    return;
  }
  if (button.classList.contains("a2a-cancel")) {
    void transitionA2ALifecycle(card, "cancelled");
    return;
  }
  void transitionA2A(
    card,
    button.classList.contains("a2a-accept")
      ? "grant"
      : button.classList.contains("a2a-revoke")
        ? "revoke"
        : "deny",
  );
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
