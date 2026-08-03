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
  operationsCursor: null,
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
        `<article class="library-content-item" data-content-id="${escapeHtml(item.id)}"><div><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.body || `Stored ${item.kind} content`)}</p><small>${escapeHtml(item.kind)} · ${escapeHtml(item.status)}</small></div><button class="quiet-button content-share-button" type="button">Share</button></article>`,
    )
    .join("");
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
        `<article class="memory-card"><p>${escapeHtml(memory.content)}</p><small>${escapeHtml(memory.scope)} · ${memory.confidence === null ? "confidence not set" : `confidence ${Math.round(memory.confidence * 100)}%`}</small></article>`,
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
    const [content, memories] = await Promise.all([
      api("/v1/content?status=active&limit=20"),
      api("/v1/memories"),
    ]);
    renderLibraryContent(content);
    renderMemories(memories);
  } catch (error) {
    $("#library-content-list").innerHTML =
      `<p class="harness-empty">${escapeHtml(error instanceof Error ? error.message : "Library unavailable.")}</p>`;
    $("#memory-list").innerHTML =
      '<p class="harness-empty">Memory unavailable.</p>';
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
      return `<article class="person-card"><span class="person-avatar">${escapeHtml(initials)}</span><div><strong>${escapeHtml(person.displayName)}</strong><small>${escapeHtml(detail)}</small></div><span class="person-category">${escapeHtml(person.category)}</span></article>`;
    })
    .join("");
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
        `<article class="task-card"><strong>${escapeHtml(task.title)}</strong><p>${escapeHtml(task.description || "No description")}</p><small>${escapeHtml(task.status)} · ${task.unread ? "unread" : "read"}</small></article>`,
    )
    .join("");
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
      $("#routine-trigger").hidden = false;
      $("#routine-history").hidden = false;
      void loadRoutineWebhook();
      void loadRoutineRuns();
      renderRoutines(result);
      $("#routine-input").focus();
    });
  });
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
    renderRoutines(await api("/v1/routines"));
  } catch (error) {
    $("#routine-list").innerHTML =
      `<p class="harness-empty">${escapeHtml(error instanceof Error ? error.message : "Routines unavailable.")}</p>`;
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
        `<article class="account-card"><span class="account-mark">${escapeHtml(account.provider)}</span><div><strong>${escapeHtml(account.email)}</strong><small>${
          Object.keys(account.capabilities || {})
            .filter((key) => account.capabilities[key])
            .map(escapeHtml)
            .join(" · ") || "No capabilities reported"
        }</small></div><span class="account-status ${account.needsReauth ? "needs-reauth" : ""}">${account.needsReauth ? "reauth" : account.isActive ? "active" : "inactive"}</span></article>`,
    )
    .join("");
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
        `<article class="channel-card"><div><strong>${escapeHtml(channel.kind)}</strong><small>${escapeHtml(channel.address)}</small></div><span class="channel-status ${channel.status === "disabled" ? "disabled" : ""}">${escapeHtml(channel.status)}</span></article>`,
    )
    .join("");
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
function renderSuggestions(result) {
  const target = $("#suggestion-list");
  const suggestions = result.suggestions || [];
  if (!suggestions.length) {
    target.innerHTML =
      '<p class="harness-empty">Nothing needs your attention right now.</p>';
    return;
  }
  target.innerHTML = suggestions
    .map(
      (suggestion) =>
        `<article class="suggestion-card" data-suggestion-id="${escapeHtml(suggestion.id)}" data-suggestion-revision="${escapeHtml(suggestion.revision)}"><div class="suggestion-copy"><span class="suggestion-kind">${escapeHtml(suggestion.kind)} · ${escapeHtml(suggestion.sourceType)}</span><strong>${escapeHtml(suggestion.title)}</strong><p>${escapeHtml(suggestion.body)}</p><small>${escapeHtml(suggestion.sourceRef)}</small></div><div class="suggestion-actions"><button class="quiet-button suggestion-dismiss" type="button">Dismiss</button><button class="primary-button suggestion-convert" type="button">Make task <span>→</span></button></div></article>`,
    )
    .join("");
}
async function loadSuggestions() {
  if (!state.token) {
    $("#suggestion-list").innerHTML =
      '<p class="harness-empty">Connect the API to load suggestions.</p>';
    return;
  }
  try {
    renderSuggestions(await api("/v1/suggestions?status=open&limit=50"));
  } catch (error) {
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
async function inspectSquare(squareId, card) {
  if (!squareId || !state.token) return;
  const detail = $("#square-detail");
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
    const memberItems = members.members || [];
    $("#square-members").innerHTML = memberItems.length
      ? memberItems
          .map(
            (member) =>
              `<div class="square-member"><span class="square-member-id">${escapeHtml(member.userId.slice(0, 8))}</span><span>${escapeHtml(member.role)}</span><small>${escapeHtml(member.status)}</small></div>`,
          )
          .join("")
      : '<p class="harness-empty">No active members returned.</p>';
    $("#square-policy").textContent =
      `Tools: ${policy.policy.allowedToolNames.length || "none"} allowed · Domains: ${policy.policy.allowedDomains.length || "none"} allowed · policy revision ${policy.policy.revision}`;
    document.querySelectorAll(".square-card").forEach((item) => {
      item.classList.toggle("is-selected", item === card);
    });
  } catch (error) {
    $("#square-members").innerHTML =
      `<p class="harness-empty">${escapeHtml(error instanceof Error ? error.message : "Square details unavailable.")}</p>`;
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
      return `<article class="a2a-card" data-a2a-id="${escapeHtml(request.id)}" data-a2a-revision="${escapeHtml(request.revision)}"><div class="a2a-copy"><span class="a2a-meta">${escapeHtml(request.status)} · revision ${escapeHtml(request.revision)}</span><strong>${escapeHtml(request.capability)}</strong><p>${escapeHtml(JSON.stringify(request.request))}</p><small>${escapeHtml(request.requesterId.slice(0, 8))} → ${escapeHtml(request.recipientId.slice(0, 8))} · ${escapeHtml(expiry)}</small></div>${actionable ? '<div class="a2a-actions"><button class="quiet-button a2a-decline" type="button">Decline</button><button class="primary-button a2a-accept" type="button">Accept <span>→</span></button></div>' : ""}</article>`;
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
async function transitionA2A(card, status) {
  const id = card.dataset.a2aId;
  const revision = Number(card.dataset.a2aRevision);
  if (!id || !Number.isInteger(revision)) return;
  const error = $("#a2a-transition-error");
  error.hidden = true;
  card.querySelectorAll("button").forEach((button) => (button.disabled = true));
  try {
    await api(`/v1/a2a/requests/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ status, expectedRevision: revision }),
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
  if (!button || !card) return;
  void createContentShare(card.dataset.contentId, card);
});
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
$("#people-add-toggle").addEventListener("click", () => {
  $("#people-add-form").hidden = !$("#people-add-form").hidden;
  if (!$("#people-add-form").hidden) $("#person-name").focus();
});
$("#person-save").addEventListener("click", () => void savePerson());
document.querySelector(".profile-chip").addEventListener("click", (event) => {
  event.preventDefault();
  $("#profile-error").hidden = true;
  openDialog($("#profile-dialog"));
  void loadProfile();
});
$("#profile-save").addEventListener("click", () => void saveProfile());
$("#tasks-open").addEventListener("click", () => {
  openDialog($("#tasks-dialog"));
  void loadTasks();
});
$("#task-add-toggle").addEventListener("click", () => {
  $("#task-add-form").hidden = !$("#task-add-form").hidden;
  if (!$("#task-add-form").hidden) $("#task-title").focus();
});
$("#task-save").addEventListener("click", () => void saveTask());
$("#routines-open").addEventListener("click", () => {
  selectedRoutineId = null;
  $("#routine-trigger").hidden = true;
  $("#routine-history").hidden = true;
  openDialog($("#routines-dialog"));
  void loadRoutines();
});
$("#routine-run").addEventListener("click", () => void runSelectedRoutine());
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
});
$("#google-connect").addEventListener("click", () => void startGoogleOAuth());
$("#channels-open").addEventListener("click", () => {
  openDialog($("#channels-dialog"));
  void loadChannels();
});
$("#channel-timeline-more").addEventListener("click", () => {
  void loadChannelTimeline(true).catch(() => undefined);
});
$("#channel-add-toggle").addEventListener("click", () => {
  $("#channel-add-form").hidden = !$("#channel-add-form").hidden;
  if (!$("#channel-add-form").hidden) $("#channel-address").focus();
});
$("#channel-save").addEventListener("click", () => void saveChannel());
$("#channel-kind").addEventListener("change", updateChannelConfigFields);
updateChannelConfigFields();
$("#billing-open").addEventListener("click", () => {
  openDialog($("#billing-dialog"));
  void loadBilling();
});
$("#suggestions-open").addEventListener("click", () => {
  $("#suggestions-error").hidden = true;
  openDialog($("#suggestions-dialog"));
  void loadSuggestions();
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
$("#square-list").addEventListener("click", (event) => {
  const button = event.target.closest(".square-inspect");
  const card = event.target.closest(".square-card");
  if (!button || !card) return;
  void inspectSquare(card.dataset.squareId, card);
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
  void transitionA2A(
    card,
    button.classList.contains("a2a-accept") ? "accepted" : "declined",
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
