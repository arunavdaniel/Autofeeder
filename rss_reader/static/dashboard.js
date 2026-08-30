const $ = (s, r = document) => r.querySelector(s);

function safe(v) {
  return String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c]));
}

function statusPill(status) {
  return `<span class="status-pill ${status}"><i class="live-dot"></i> ${safe(status)}</span>`;
}

async function loadDashboard() {
  const [metrics, pipelines, runs] = await Promise.all([
    fetch("/api/dashboard").then((r) => r.json()),
    fetch("/api/pipelines").then((r) => r.json()),
    fetch("/api/runs").then((r) => r.json()),
  ]);

  $("#m-active").textContent = metrics.active_pipelines;
  $("#m-pipelines").textContent = `${metrics.pipelines} pipelines total`;
  $("#m-feeds").textContent = metrics.feeds;
  $("#m-saved").textContent = `${metrics.saved_articles} saved articles`;
  $("#m-records").textContent = metrics.total_records;
  $("#m-runs").textContent = `${metrics.total_runs} runs total`;
  $("#m-errors").textContent = metrics.total_errors;
  $("#m-active-runs").textContent = `${metrics.active_runs} in progress`;

  const names = Object.fromEntries(pipelines.map((p) => [p.id, p.name]));
  const list = $("#pipelines");
  if (!pipelines.length) {
    list.innerHTML = `<div class="empty-state"><span class="empty-icon">→</span><h3>No pipelines yet</h3><p>Build a workflow to turn feed articles into CSV or SQLite records.</p><a class="button primary" href="/pipelines">Create pipeline</a></div>`;
  } else {
    list.innerHTML = pipelines
      .map(
        (p) => `<div class="run-row">
          <div><div class="run-name">${safe(p.name)}</div>
          <div class="run-meta">${p.definition.feed_ids?.length || 0} sources · ${safe(p.definition.output?.type || "csv")} output</div></div>
          <div class="run-spacer"></div>
          <button class="button" data-run="${p.id}">Run</button>
          <button class="button" data-preview="${p.id}">Preview</button>
          <a class="run-link" href="/pipelines?id=${p.id}">Edit</a>
        </div>`
      )
      .join("");
    list.querySelectorAll("[data-run]").forEach((b) =>
      b.addEventListener("click", () => startRun(b.dataset.run, false))
    );
    list.querySelectorAll("[data-preview]").forEach((b) =>
      b.addEventListener("click", () => startRun(b.dataset.preview, true))
    );
  }

  const recent = $("#recent-runs");
  if (!runs.length) {
    recent.innerHTML = `<div class="empty-state"><p>No runs yet. Start a pipeline to see live progress here.</p></div>`;
  } else {
    recent.innerHTML = runs
      .slice(0, 6)
      .map(
        (r) => `<div class="run-row">
          <div><div class="run-name">${safe(names[r.pipeline_id] || "Pipeline")}${r.preview ? " · preview" : ""}</div>
          <div class="run-meta">${r.articles_seen} articles · ${r.records_count} records · ${r.error_count} errors</div></div>
          ${statusPill(r.status)}
          <div class="run-spacer"></div>
          <a class="run-link" href="/runs?id=${r.id}">Details</a>
        </div>`
      )
      .join("");
  }
}

async function startRun(id, preview) {
  const res = await fetch(`/api/pipelines/${id}/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ preview }),
  }).then((r) => r.json());
  if (res.run_id) {
    window.location.href = `/runs?id=${res.run_id}`;
  }
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

loadDashboard().catch(() => {});
pollStatus();
setInterval(pollStatus, 1500);
