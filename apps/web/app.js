/* global document, fetch, localStorage, location, sessionStorage */

const storageKeys = {
  base: "town.api.base",
  token: "town.api.token",
  intention: "town.focus.intention",
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
async function api(path) {
  const response = await fetch(`${state.base.replace(/\/$/, "")}${path}`, {
    headers: {
      Authorization: `Bearer ${state.token}`,
      Accept: "application/json",
    },
  });
  if (!response.ok) throw new Error(`API returned ${response.status}`);
  return response.json();
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
$("#command-open").addEventListener("click", () =>
  openDialog($("#harness-dialog")),
);
$("#people-button").addEventListener("click", () =>
  openDialog($("#harness-dialog")),
);
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
