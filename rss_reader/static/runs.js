const $ = (s) => document.querySelector(s);

function safe(v) {
  return String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c]));
}

function statusPill(status) {
  return `<span class="status-pill ${safe(status)}"><i class="live-dot"></i> ${safe(status)}</span>`;
}

let selectedId = parseInt(new URLSearchParams(location.search).get("id") || "0", 10) || null;
let names = {};

async function loadNames() {
  names = Object.fromEntries((await fetch("/api/pipelines").then((r) => r.json())).map((p) => [p.id, p.name]));
}

async function loadRuns() {
  const runs = await fetch("/api/runs").then((r) => r.json());
  const list = $("#run-list");
  if (!runs.length) {
    list.innerHTML = `<div class="empty-state"><p>No runs yet.</p></div>`;
  } else {
    list.innerHTML = runs
      .map(
        (r) => `<div class="run-row" data-id="${r.id}" style="cursor:pointer">
          <div><div class="run-name">${safe(names[r.pipeline_id] || "Pipeline")}${r.preview ? " · preview" : ""}</div>
          <div class="run-meta">#${r.id} · ${r.articles_seen} articles · ${r.records_count} records · ${r.error_count} errors</div></div>
          ${statusPill(r.status)}
          <div class="run-spacer"></div>
          ${r.status === "success" || r.status === "failed" ? `<button class="button" data-retry="${r.pipeline_id}">Retry</button>` : ""}
        </div>`
      )
      .join("");
    list.querySelectorAll("[data-id]").forEach((el) =>
      el.addEventListener("click", (e) => {
        if (e.target.dataset.retry) return;
        selectedId = parseInt(el.dataset.id, 10);
        loadDetail();
      })
    );
    list.querySelectorAll("[data-retry]").forEach((b) =>
      b.addEventListener("click", async (e) => {
        e.stopPropagation();
        const res = await fetch(`/api/pipelines/${b.dataset.retry}/retry`, { method: "POST" }).then((r) => r.json());
        if (res.run_id) {
          selectedId = res.run_id;
          loadRuns();
          loadDetail();
        }
      })
    );
  }
  if (selectedId && !runs.find((r) => r.id === selectedId)) {
    selectedId = runs.length ? runs[0].id : null;
  }
  if (selectedId) loadDetail();
}

async function loadDetail() {
  if (!selectedId) return;
  const data = await fetch(`/api/runs/${selectedId}/logs`).then((r) => r.json());
  const run = data.run;
  $("#detail-title").textContent = `#${run.id} · ${safe(names[run.pipeline_id] || "Pipeline")}`;
  $("#detail-status").innerHTML = statusPill(run.status);
  const result = JSON.parse(run.result || "{}");
  const pct = run.progress_total ? Math.round((run.progress_current / run.progress_total) * 100) : 0;
  const logs = data.logs
    .map(
      (l) => `<div class="log-line ${l.level === "error" ? "error" : ""}"><span class="log-step">${safe(l.step)}</span><span>${safe(l.message)}</span></div>`
    )
    .join("");
  const recordsHtml = (result.records || [])
    .map(
      (rec) => `<div class="step-panel" style="margin-bottom:10px"><dl class="kv">${Object.entries(rec)
        .map(([k, v]) => `<dt>${safe(k)}</dt><dd>${safe(typeof v === "object" ? JSON.stringify(v) : v)}</dd>`)
        .join("")}</dl></div>`
    )
    .join("") || `<p class="run-meta">No records produced.</p>`;
  const errorsHtml = (result.errors || [])
    .map((e) => `<div class="log-line error"><span class="log-step">${safe(e.title)}</span><span>${safe(e.error)}</span></div>`)
    .join("") || `<p class="run-meta">No errors.</p>`;
  const out = result.output || {};
  $("#detail-body").innerHTML = `
    <div class="progress-inline"><span style="width:${pct}%"></span></div>
    <p class="run-meta">${run.articles_seen} articles · ${run.records_count} valid records · ${run.error_count} failed · phase: ${safe(run.phase || "—")}</p>
    ${run.status === "running" || run.status === "queued" ? `<p class="run-meta"><i class="live-dot"></i> ${safe(run.last_message || "Working…")}</p>` : ""}
    ${run.error ? `<div class="log-line error"><span class="log-step">fatal</span><span>${safe(run.error)}</span></div>` : ""}
    <div class="preview-wrap">
      <div class="step-nav">
        <button data-tab="logs" class="active"><b>Live log</b><small>${data.logs.length} entries</small></button>
        <button data-tab="records"><b>Records (${result.records?.length || 0})</b><small>validated JSON</small></button>
        <button data-tab="errors"><b>Errors (${result.errors?.length || 0})</b><small>failed items</small></button>
        <button data-tab="output"><b>Output</b><small>${safe(out.type || "—")}</small></button>
      </div>
      <div>
        <div class="step-panel" data-panel="logs">${logs || '<p class="run-meta">No log entries yet.</p>'}</div>
        <div class="step-panel" data-panel="records" style="display:none">${recordsHtml}</div>
        <div class="step-panel" data-panel="errors" style="display:none">${errorsHtml}</div>
        <div class="step-panel" data-panel="output" style="display:none">${
          out && out.path
            ? `<dl class="kv"><dt>Type</dt><dd>${safe(out.type)}</dd><dt>Path</dt><dd>${safe(out.path)}</dd><dt>Table</dt><dd>${safe(out.table || "—")}</dd><dt>Records</dt><dd>${out.records}</dd></dl>`
            : "<p class='run-meta'>No output written (preview or no records).</p>"
        }</div>
      </div>
    </div>`;
  $("#detail-body").querySelectorAll("[data-tab]").forEach((b) =>
    b.addEventListener("click", () => {
      $("#detail-body").querySelectorAll("[data-tab]").forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      $("#detail-body").querySelectorAll("[data-panel]").forEach((p) => {
        p.style.display = p.dataset.panel === b.dataset.tab ? "" : "none";
      });
    })
  );
}

async function pollStatus() {
  try {
    const runs = await fetch("/api/runs").then((r) => r.json());
    const active = runs.find((r) => r.status === "queued" || r.status === "running");
    const bar = $("#status-bar");
    if (active) {
      bar.className = "status-bar busy";
      $("#sb-phase").textContent = active.phase || "running";
      $("#sb-msg").textContent = active.last_message || "Working…";
      const pct = active.progress_total ? Math.round((active.progress_current / active.progress_total) * 100) : 0;
      $("#sb-fill").style.width = pct + "%";
      $("#sb-count").textContent = `${active.progress_current}/${active.progress_total}`;
      $("#sb-time").textContent = active.created_at;
    } else {
      bar.className = "status-bar idle";
      $("#sb-phase").textContent = "idle";
      if (runs.length) {
        const last = runs[0];
        $("#sb-msg").textContent = `Last run: ${last.status} · ${last.records_count} records · ${last.error_count} errors`;
        $("#sb-time").textContent = last.finished_at || last.created_at;
      } else {
        $("#sb-msg").textContent = "Engine is ready";
        $("#sb-time").textContent = "";
      }
      $("#sb-fill").style.width = "0%";
      $("#sb-count").textContent = "";
    }
  } catch (e) {}
}

(async () => {
  await loadNames();
  await loadRuns();
  $("#refresh").addEventListener("click", loadRuns);
  pollStatus();
  setInterval(async () => {
    await loadRuns();
    await pollStatus();
  }, 1500);
})();
