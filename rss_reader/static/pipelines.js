const $ = (s) => document.querySelector(s);

function safe(v) {
  return String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c]));
}

let step = 0;
let editingId = parseInt(new URLSearchParams(location.search).get("id") || "0", 10) || null;
let folderParam = parseInt(new URLSearchParams(location.search).get("folder") || "0", 10) || null;
let snapshotParam = parseInt(new URLSearchParams(location.search).get("snapshot") || "0", 10) || null;
let fields = [];
let def = null;

const TYPES = ["string", "number", "integer", "boolean", "array", "object"];

function showStep(n) {
  step = Math.max(0, Math.min(5, n));
  document.querySelectorAll(".step").forEach((el) => (el.hidden = +el.dataset.step !== step));
  document.querySelectorAll("#stepper li").forEach((li) => {
    const s = +li.dataset.step;
    li.classList.toggle("active", s === step);
    li.classList.toggle("done", s < step);
  });
  const last = step === 5;
  $("#back").hidden = step === 0;
  $("#next").hidden = last;
  $("#save").hidden = !last;
  $("#run-now").hidden = !last;
  $("#preview-now").hidden = !last;
  if (last) renderReview();
}

function renderFields() {
  const wrap = $("#fields");
  if (!fields.length) fields = [{ name: "", type: "string", description: "", required: false }];
  wrap.innerHTML = fields
    .map(
      (f, i) => `<div class="schema-row">
        <input placeholder="field name" value="${safe(f.name)}" data-k="name" data-i="${i}">
        <select data-k="type" data-i="${i}">${TYPES.map((t) => `<option ${t === f.type ? "selected" : ""}>${t}</option>`).join("")}</select>
        <input placeholder="description" value="${safe(f.description)}" data-k="description" data-i="${i}">
        <label class="req">req<input type="checkbox" data-k="required" data-i="${i}" ${f.required ? "checked" : ""}></label>
      </div>`
    )
    .join("");
  wrap.querySelectorAll("[data-k]").forEach((el) =>
    el.addEventListener("change", () => {
      const i = +el.dataset.i;
      const k = el.dataset.k;
      fields[i][k] = el.type === "checkbox" ? el.checked : el.value;
    })
  );
}

function collect() {
  const llmEnabled = $("#llm-enabled").checked;
  const sourceType = $("#source-type").value;
  const source =
    sourceType === "snapshot"
      ? { type: "snapshot", snapshot_id: parseInt($("#snapshot-id").value || "0", 10) }
      : { type: "feeds", feed_ids: [...document.querySelectorAll("#feed-options input:checked")].map((c) => parseInt(c.value, 10)) };
  const from = $("#date-from").value;
  const to = $("#date-to").value;
  return {
    name: $("#builder-sub").dataset.name || "",
    source,
    feed_ids: source.feed_ids || [],
    date_filter: { enabled: !!(from || to), from, to },
    max_articles: parseInt($("#max-articles").value || "20", 10),
    use_browser: $("#use-browser").checked,
    llm: {
      enabled: llmEnabled,
      endpoint: $("#endpoint").value.trim(),
      model: $("#model").value.trim(),
      api_key: $("#key").value.trim(),
    },
    prompt: $("#prompt").value,
    fields: fields.filter((f) => f.name.trim()),
    output: {
      type: $("#output-type").value,
      path: $("#output-path").value.trim(),
      table: $("#table").value.trim() || "extracted_records",
      mode: $("#output-mode").value,
    },
    run_on_change: $("#run-on-change").checked,
  };
}

function setStatus(msg, isError) {
  const el = $("#builder-status");
  el.textContent = msg;
  el.style.color = isError ? "#c0492b" : "var(--muted)";
}

async function loadFeeds() {
  const folders = await fetch("/api/folders").then((r) => r.json());
  const opts = $("#feed-options");
  const all = folders.flatMap((f) => f.feeds);
  if (!all.length) {
    opts.innerHTML = `<p class="run-meta">No feeds yet. Add sources from the <a class="run-link" href="/reader">Sources &amp; Reader</a> page first.</p>`;
    return;
  }
  opts.innerHTML = all
    .map((f) => `<label class="feed-chip"><input type="checkbox" value="${f.id}" ${editingId && def && def.feed_ids && def.feed_ids.includes(f.id) ? "checked" : ""}>${safe(f.title)}</label>`)
    .join("");
  if (folderParam && !editingId) {
    const folder = folders.find((f) => f.id === folderParam);
    if (folder) {
      folder.feeds.forEach((f) => {
        const el = opts.querySelector(`input[value="${f.id}"]`);
        if (el) el.checked = true;
      });
      $("#builder-sub").textContent = `New pipeline from “${folder.name}”`;
    }
  }
}

async function loadSnapshots() {
  const snaps = await fetch("/api/snapshots").then((r) => r.json());
  const sel = $("#snapshot-id");
  if (!snaps.length) {
    sel.innerHTML = `<option value="0">No snapshots available</option>`;
    return;
  }
  sel.innerHTML = snaps
    .map((s) => `<option value="${s.id}">${safe(s.name)} (${s.article_count} articles)</option>`)
    .join("");
}

function applySourceType() {
  const isSnap = $("#source-type").value === "snapshot";
  $("#feeds-source").hidden = isSnap;
  $("#snapshot-source").hidden = !isSnap;
}

async function loadEditing() {
  if (!editingId) return;
  const pipelines = await fetch("/api/pipelines").then((r) => r.json());
  def = pipelines.find((p) => p.id === editingId);
  if (!def) return;
  const d = def.definition;
  $("#builder-sub").textContent = `Editing “${def.name}”`;
  $("#builder-sub").dataset.name = def.name;
  $("#max-articles").value = d.max_articles || 20;
  $("#use-browser").checked = d.use_browser !== false;
  $("#llm-enabled").checked = !!(d.llm && d.llm.enabled);
  $("#endpoint").value = d.llm?.endpoint || "";
  $("#model").value = d.llm?.model || "";
  $("#prompt").value = d.prompt || "";
  fields = (d.fields || []).map((f) => ({ ...f }));
  const src = d.source || { type: "feeds", feed_ids: d.feed_ids || [] };
  $("#source-type").value = src.type === "snapshot" ? "snapshot" : "feeds";
  if (src.type === "snapshot") $("#snapshot-id").value = String(src.snapshot_id || 0);
  $("#date-from").value = d.date_filter?.from || "";
  $("#date-to").value = d.date_filter?.to || "";
  $("#output-type").value = d.output?.type || "csv";
  $("#output-path").value = d.output?.path || "";
  $("#table").value = d.output?.table || "extracted_records";
  $("#output-mode").value = d.output?.mode || "append";
  $("#run-on-change").checked = !!d.run_on_change;
  applySourceType();
  renderFields();
  await loadFeeds();
}

function renderReview() {
  const d = collect();
  $("#review").innerHTML = `
    <dt>Name</dt><dd>${safe(d.name || "(set on save)")}</dd>
    <dt>Sources</dt><dd>${d.feed_ids.length} feed(s) selected</dd>
    <dt>LLM</dt><dd>${d.llm.enabled ? `${safe(d.llm.model || "enabled")}` : "disabled (raw text)"}</dd>
    <dt>Schema</dt><dd>${d.fields.length} field(s)</dd>
    <dt>Output</dt><dd>${safe(d.output.type)}${d.output.path ? " · " + safe(d.output.path) : ""}</dd>`;
}

async function savePipeline() {
  const d = collect();
  if (!d.name) {
    const name = prompt("Pipeline name:");
    if (!name) {
      setStatus("A pipeline name is required.", true);
      return null;
    }
    d.name = name;
    $("#builder-sub").dataset.name = name;
  }
  const res = await fetch("/api/pipelines", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(d),
  }).then((r) => r.json());
  if (res.error) {
    setStatus(res.error, true);
    return null;
  }
  editingId = res.id;
  return res.id;
}

async function runPipeline(preview) {
  const id = await savePipeline();
  if (!id) return;
  const res = await fetch(`/api/pipelines/${id}/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ preview }),
  }).then((r) => r.json());
  if (res.run_id) location.href = `/runs?id=${res.run_id}`;
}

$("#add-field").addEventListener("click", () => {
  fields.push({ name: "", type: "string", description: "", required: false });
  renderFields();
});

$("#generate-schema").addEventListener("click", async () => {
  const d = collect();
  if (!d.llm.endpoint || !d.llm.model) {
    setStatus("Set an endpoint and model before suggesting a schema.", true);
    return;
  }
  setStatus("Asking the model for a schema proposal…");
  const res = await fetch("/api/llm/schema", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(d.llm),
  }).then((r) => r.json());
  if (res.error) {
    setStatus(res.error, true);
    return;
  }
  const props = res.schema?.properties || {};
  fields = Object.entries(props).map(([name, v]) => ({
    name,
    type: v.type || "string",
    description: v.description || "",
    required: (res.schema.required || []).includes(name),
  }));
  renderFields();
  setStatus("Schema suggestion applied. Review and adjust the fields.");
});

$("#next").addEventListener("click", () => showStep(step + 1));
$("#back").addEventListener("click", () => showStep(step - 1));
$("#source-type").addEventListener("change", applySourceType);
$("#save").addEventListener("click", async () => {
  const id = await savePipeline();
  if (id) setStatus("Pipeline saved.");
});
$("#run-now").addEventListener("click", () => runPipeline(false));
$("#preview-now").addEventListener("click", () => runPipeline(true));

(async () => {
  renderFields();
  await loadSnapshots();
  await loadFeeds();
  await loadEditing();
  if (snapshotParam && !editingId) {
    $("#source-type").value = "snapshot";
    $("#snapshot-id").value = String(snapshotParam);
  }
  applySourceType();
  showStep(0);
})();
