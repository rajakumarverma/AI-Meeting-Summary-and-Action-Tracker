const state = {
  summary: "",
  decisions: [],
  actionItems: []
};

const transcriptInput = document.getElementById("transcriptInput");
const analyzeBtn = document.getElementById("analyzeBtn");
const summaryOutput = document.getElementById("summaryOutput");
const decisionsOutput = document.getElementById("decisionsOutput");
const reviewList = document.getElementById("reviewList");
const kanbanBoard = document.getElementById("kanbanBoard");
const dashboard = document.getElementById("dashboard");

analyzeBtn.addEventListener("click", () => {
  const transcript = transcriptInput.value.trim();
  if (!transcript) {
    alert("Please paste a meeting transcript first.");
    return;
  }

  state.summary = buildSummary(transcript);
  state.decisions = extractDecisions(transcript);
  state.actionItems = extractActionItems(transcript);
  renderAll();
});

function buildSummary(transcript) {
  const sentences = transcript
    .replace(/\n+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .filter(Boolean);

  if (!sentences.length) {
    return "No summary could be generated.";
  }

  return sentences.slice(0, 3).join(" ");
}

function extractDecisions(transcript) {
  const lines = transcript.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  return lines.filter((line) => /\b(decision|decided|agreed|approved|resolved)\b/i.test(line));
}

function extractActionItems(transcript) {
  const lines = transcript.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const items = [];

  lines.forEach((line) => {
    let match = line.match(/^(?:action\s*:\s*)?([A-Z][a-zA-Z]+)\s+(?:will|should|to)\s+(.+?)\s+(?:by|before|due)\s+(.+)$/i);
    if (match) {
      items.push(createTask(match[2], match[1], match[3]));
      return;
    }

    match = line.match(/^(.+?)\s*[-:]\s*owner\s*[:=]\s*([^,;]+)[,;]\s*(?:due|deadline)\s*[:=]\s*(.+)$/i);
    if (match) {
      items.push(createTask(match[1], match[2], match[3]));
      return;
    }

    if (/\b(action|todo|follow-up|next step)\b/i.test(line)) {
      items.push(createTask(line, "Unassigned", "No deadline"));
    }
  });

  return items;
}

function createTask(title, owner, deadline) {
  return {
    id: crypto.randomUUID(),
    title: title.trim(),
    owner: owner.trim(),
    deadline: deadline.trim(),
    reviewStatus: "pending",
    status: "Todo"
  };
}

function renderAll() {
  renderSummary();
  renderDecisions();
  renderReviewList();
  renderKanban();
  renderDashboard();
}

function renderSummary() {
  summaryOutput.textContent = state.summary || "No summary yet.";
}

function renderDecisions() {
  decisionsOutput.innerHTML = "";
  if (!state.decisions.length) {
    const item = document.createElement("li");
    item.className = "muted";
    item.textContent = "No explicit decisions found.";
    decisionsOutput.appendChild(item);
    return;
  }

  state.decisions.forEach((decision) => {
    const li = document.createElement("li");
    li.textContent = decision;
    decisionsOutput.appendChild(li);
  });
}

function renderReviewList() {
  reviewList.innerHTML = "";
  const pending = state.actionItems.filter((item) => item.reviewStatus === "pending");

  if (!pending.length) {
    reviewList.innerHTML = '<p class="muted">No pending action items to review.</p>';
    return;
  }

  pending.forEach((item) => {
    const wrapper = document.createElement("div");
    wrapper.className = "review-item";
    wrapper.innerHTML = `
      <strong>${escapeHtml(item.title)}</strong>
      <div class="muted">Owner: ${escapeHtml(item.owner)} | Deadline: ${escapeHtml(item.deadline)}</div>
      <div style="margin-top:8px; display:flex; gap:8px;">
        <button class="approve" data-id="${item.id}">Approve</button>
        <button class="reject" data-id="${item.id}">Reject</button>
      </div>
    `;
    reviewList.appendChild(wrapper);
  });

  reviewList.querySelectorAll("button.approve").forEach((button) => {
    button.addEventListener("click", () => updateReviewStatus(button.dataset.id, "approved"));
  });

  reviewList.querySelectorAll("button.reject").forEach((button) => {
    button.addEventListener("click", () => updateReviewStatus(button.dataset.id, "rejected"));
  });
}

function updateReviewStatus(id, reviewStatus) {
  const item = state.actionItems.find((task) => task.id === id);
  if (!item) return;
  item.reviewStatus = reviewStatus;
  renderAll();
}

function renderKanban() {
  const columns = ["Todo", "In Progress", "Done"];
  const approvedItems = state.actionItems.filter((item) => item.reviewStatus === "approved");

  kanbanBoard.innerHTML = columns
    .map((column) => {
      const cards = approvedItems.filter((item) => item.status === column);
      const cardHtml = cards.length
        ? cards
            .map(
              (card) => `
            <div class="task-card">
              <strong>${escapeHtml(card.title)}</strong>
              <div class="muted">Owner: ${escapeHtml(card.owner)}</div>
              <div class="muted">Deadline: ${escapeHtml(card.deadline)}</div>
              <div style="margin-top: 8px;">
                <label class="muted" for="status-${card.id}">Status</label>
                <select id="status-${card.id}" data-id="${card.id}">
                  ${columns.map((status) => `<option value="${status}" ${status === card.status ? "selected" : ""}>${status}</option>`).join("")}
                </select>
              </div>
            </div>
          `
            )
            .join("")
        : '<p class="muted">No tasks</p>';

      return `<div class="column"><h3>${column}</h3>${cardHtml}</div>`;
    })
    .join("");

  kanbanBoard.querySelectorAll("select[data-id]").forEach((select) => {
    select.addEventListener("change", () => {
      const item = state.actionItems.find((task) => task.id === select.dataset.id);
      if (!item) return;
      item.status = select.value;
      renderAll();
    });
  });
}

function renderDashboard() {
  const approved = state.actionItems.filter((item) => item.reviewStatus === "approved");
  const done = approved.filter((item) => item.status === "Done").length;
  const inProgress = approved.filter((item) => item.status === "In Progress").length;
  const todo = approved.filter((item) => item.status === "Todo").length;
  const overdue = approved.filter((item) => isOverdue(item)).length;
  const completionRate = approved.length ? Math.round((done / approved.length) * 100) : 0;

  dashboard.innerHTML = `
    <div class="metric"><span class="muted">Approved Tasks</span><strong>${approved.length}</strong></div>
    <div class="metric"><span class="muted">Todo</span><strong>${todo}</strong></div>
    <div class="metric"><span class="muted">In Progress</span><strong>${inProgress}</strong></div>
    <div class="metric"><span class="muted">Completed</span><strong>${done}</strong></div>
    <div class="metric"><span class="muted">Overdue</span><strong>${overdue}</strong></div>
    <div class="metric"><span class="muted">Completion Rate</span><strong>${completionRate}%</strong></div>
  `;
}

function isOverdue(item) {
  if (item.status === "Done") return false;
  const parsed = new Date(item.deadline);
  if (Number.isNaN(parsed.getTime())) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return parsed < today;
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
