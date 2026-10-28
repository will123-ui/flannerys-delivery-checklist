(() => {
const TASKS = [
  { n: 1, title: "Bring all empty kegs up from both basements and leave them outside the windbreakers of Jerry Flannery's Bar", note: "Do this as soon as you arrive" },
  { n: 2, title: "Put all beer cases with empty bottles on a pallet and stack them in the lobby of 1314" },
  { n: 3, title: "Sort all blue skips that have empty bottles" },
  { n: 4, title: "Bring all deliveries to the basement and store them properly", note: "Old stock to the front, new stock to the bottom" },
  { n: 5, title: "Courtyard", subs: [
    "Polish all the glass",
    "Polish the bar counter and doors",
    "Clean all table bases and chair legs",
    "Sweep and mop the courtyard"
  ]},
  { n: 6, title: "Stock all bars", note: "Old stock to the front, new stock to the back" },
  { n: 7, title: "Deep clean all toilets in 1314 & Flannery's", subs: [
    "Spray toilet bowls with bleach and scrub; clean seats on top and underneath",
    "Clean mirrors with glass cleaner",
    "Check soap and toilet roll dispensers; replace if needed",
    "Sweep and mop floors",
    "Check behind and under the toilets and bins",
    "Check that the air vents are clean"
  ]},
  { n: 8, title: "Polish all brass in 1314 and Flannery's" },
  { n: 9, title: "Wash out and sanitise all blue skips, then store upside down" },
  { n: 10, title: "Take apart all 5 glass washers and scrub clean" },
  { n: 11, title: "Sweep & mop these areas", note: "Get on your knees and check for bottle caps under the fridges and shelves", subs: [
    "Behind all bars, Flannery's and 1314",
    "The lobby in 1314",
    "The porch in 1314",
    "The entrance from the courtyard to 1314",
    "The spirit store",
    "The stairs to the basement, 1314",
    "All of the basement and the ramp (1314)",
    "Mop the lift"
  ]},
  { n: 12, title: "Make sure no rubbish or empty cases are left in the basement" },
  { n: 13, title: "Check that all bars are fully stocked with glasses" },
  { n: 14, title: "Can returns", subs: [
    "Return all empty cans",
    "Put the money in an envelope and add it to the drop safe"
  ]}
];

const LEAVES = [];
TASKS.forEach(t => {
  if (t.subs) t.subs.forEach((s, i) => LEAVES.push({ id: `t${t.n}-${String.fromCharCode(97 + i)}`, task: t.n, text: s, label: `${t.n}${String.fromCharCode(97 + i)}` }));
  else LEAVES.push({ id: `t${t.n}`, task: t.n, text: null, label: String(t.n) });
});
const titleOf = l => l.text || TASKS.find(t => t.n === l.task).title;

const ICON_CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
const ICON_CAM = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>';

const $ = id => document.getElementById(id);
const esc = s => { const d = document.createElement("div"); d.textContent = s == null ? "" : String(s); return d.innerHTML; };
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} }
};

let items = {}, photos = {};
let filter = "all";
let pending = 0;
const busy = {}, errs = {};
let myName = store.get("dsc:name") || "";

function todayISO() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}
function fmtTime(iso) { try { return new Date(iso).toLocaleTimeString("en-IE", { hour: "2-digit", minute: "2-digit" }); } catch { return ""; } }
function fmtDate(iso) { try { return new Date(iso + "T12:00:00").toLocaleDateString("en-IE", { weekday: "long", day: "numeric", month: "long", year: "numeric" }); } catch { return iso; } }
const dateInput = $("shiftDate");
dateInput.value = todayISO();

// ---------- API ----------
class AuthError extends Error {}
async function api(path, opts = {}) {
  const res = await fetch("/api/" + path, { credentials: "same-origin", ...opts });
  let body = null;
  try { body = await res.json(); } catch {}
  if (res.status === 401 && !path.startsWith("login") && !path.startsWith("change-pin")) { showGate(true); throw new AuthError("auth"); }
  if (!res.ok) throw new Error((body && body.error) || "Something went wrong. Try again.");
  return body;
}

// ---------- Gate ----------
let gateMode = "login";
function showGate(pinSet) {
  stopPolling();
  gateMode = pinSet ? "login" : "setup";
  $("app").hidden = true; $("gate").hidden = false;
  $("gateTitle").textContent = pinSet ? "Staff login" : "Set up the staff PIN";
  $("gateText").textContent = pinSet
    ? "Enter the staff PIN to open the delivery checklist."
    : "First time here. Choose a PIN of 4 to 8 digits that staff will use to log in. Use at least 6 digits so it's hard to guess.";
  $("gatePin2Wrap").hidden = pinSet;
  $("gatePin2").required = !pinSet;
  $("gateBtn").textContent = pinSet ? "Open checklist" : "Save PIN and open checklist";
  $("gateName").value = myName;
  $("gateErr").textContent = "";
  $("gatePin").value = ""; $("gatePin2").value = "";
  setTimeout(() => $("gatePin").focus(), 50);
}
$("gateForm").addEventListener("submit", async e => {
  e.preventDefault();
  const pin = $("gatePin").value.trim();
  const name = $("gateName").value.trim();
  const errEl = $("gateErr");
  errEl.textContent = "";
  if (!/^\d{4,8}$/.test(pin)) { errEl.textContent = "The PIN must be 4 to 8 digits."; return; }
  if (gateMode === "setup" && pin !== $("gatePin2").value.trim()) { errEl.textContent = "The two PINs don't match."; return; }
  if (!name) { errEl.textContent = "Enter your first name."; return; }
  const btn = $("gateBtn"); btn.disabled = true;
  try {
    await api(gateMode === "setup" ? "setup" : "login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pin }) });
    setName(name);
    openApp();
  } catch (er) {
    errEl.textContent = er.message;
    if (/already been set/.test(er.message)) showGate(true);
  } finally { btn.disabled = false; }
});
function setName(n) { myName = n; store.set("dsc:name", n); $("whoText").textContent = "Logged in as " + n + " ·"; }

// ---------- Build list ----------
const list = $("list");
TASKS.forEach(t => {
  const card = document.createElement("section");
  card.className = "task"; card.id = "task-" + t.n;
  card.innerHTML = `<div class="task-head"><div class="num">${t.n}</div><div class="task-title">${esc(t.title)}</div>${t.note ? `<div class="task-note">${esc(t.note)}</div>` : ""}${t.subs ? `<div class="task-count" id="count-${t.n}"></div>` : ""}</div>`;
  LEAVES.filter(l => l.task === t.n).forEach(l => {
    const row = document.createElement("div");
    row.className = "item" + (l.text ? "" : " solo"); row.id = "item-" + l.id;
    row.innerHTML = `
      <button class="check" id="chk-${l.id}">${ICON_CHECK}</button>
      <div class="item-body">
        ${l.text ? `<div class="item-text">${esc(l.text)}</div>` : ""}
        <div class="meta" id="meta-${l.id}"></div>
        <div class="photos" id="photos-${l.id}"></div>
      </div>`;
    card.appendChild(row);
  });
  list.appendChild(card);
});
const emptyEl = document.createElement("div"); emptyEl.className = "empty"; emptyEl.hidden = true; list.appendChild(emptyEl);

list.addEventListener("click", e => {
  const chk = e.target.closest(".check");
  if (chk) { toggle(chk.id.slice(4)); return; }
  const th = e.target.closest(".thumb");
  if (th) { openLightbox(th.dataset.leaf, th.dataset.key); return; }
  const pb = e.target.closest(".photo-btn");
  if (pb) $("file-" + pb.dataset.leaf).click();
});
list.addEventListener("change", e => {
  const f = e.target.closest("input[type=file]");
  if (f && f.files && f.files[0]) { addPhoto(f.dataset.leaf, f.files[0]); f.value = ""; }
});

const photoUrl = key => "/api/photo?key=" + encodeURIComponent(key);

function renderItem(l) {
  const it = items[l.id];
  const ph = photos[l.id] || [];
  const row = $("item-" + l.id);
  row.classList.toggle("done", !!it);
  row.classList.toggle("nophoto", ph.length === 0);
  const chk = $("chk-" + l.id);
  chk.setAttribute("aria-pressed", it ? "true" : "false");
  chk.setAttribute("aria-label", (it ? "Undo: " : "Mark done: ") + titleOf(l));

  let m = "";
  if (it) {
    m += `<span>Done${it.by ? " by " + esc(it.by) : ""}${it.at ? " at " + fmtTime(it.at) : ""}</span>`;
    m += ph.length ? `<span class="pill ok">Photo added</span>` : `<span class="pill need">Photo needed</span>`;
  }
  if (errs[l.id]) m += `<span class="err">${esc(errs[l.id])}</span>`;
  const meta = $("meta-" + l.id); meta.innerHTML = m; meta.hidden = !m;

  const box = $("photos-" + l.id);
  const sig = ph.map(p => p.key).join("|") + "#" + (busy[l.id] ? 1 : 0);
  if (box.dataset.sig === sig) return; // avoid reloading thumbnails on every poll
  box.dataset.sig = sig;
  box.innerHTML = ph.map(p => `<button class="thumb" data-leaf="${l.id}" data-key="${esc(p.key)}" aria-label="View photo"><img src="${esc(photoUrl(p.key))}" alt="" loading="lazy"></button>`).join("")
    + `<button class="photo-btn" data-leaf="${l.id}" ${busy[l.id] ? "disabled" : ""}>${ICON_CAM}${busy[l.id] ? "Uploading…" : (ph.length ? "Add another" : "Add photo")}</button>`
    + `<input type="file" accept="image/*" capture="environment" id="file-${l.id}" data-leaf="${l.id}" hidden>`;
}

function renderAll() {
  let done = 0, pics = 0;
  LEAVES.forEach(l => { renderItem(l); if (items[l.id]) done++; pics += (photos[l.id] || []).length; });
  $("doneCount").textContent = done;
  $("totalCount").textContent = LEAVES.length;
  $("photoCount").textContent = pics;
  $("barFill").style.width = (100 * done / LEAVES.length) + "%";
  TASKS.forEach(t => {
    const leaves = LEAVES.filter(l => l.task === t.n);
    const d = leaves.filter(l => items[l.id]).length;
    $("task-" + t.n).classList.toggle("complete", d === leaves.length);
    if (t.subs) $("count-" + t.n).textContent = `${d} of ${leaves.length} done`;
  });
  applyFilter();
}

function applyFilter() {
  let shown = 0;
  LEAVES.forEach(l => {
    const done = !!items[l.id], hasPh = (photos[l.id] || []).length > 0;
    const vis = filter === "all" || (filter === "todo" && !done) || (filter === "nophoto" && done && !hasPh);
    $("item-" + l.id).hidden = !vis;
  });
  TASKS.forEach(t => {
    const any = LEAVES.some(l => l.task === t.n && !$("item-" + l.id).hidden);
    $("task-" + t.n).hidden = !any; if (any) shown++;
  });
  emptyEl.hidden = shown > 0;
  emptyEl.textContent = filter === "todo" ? "Everything is done for this shift." : "Every finished task has a photo.";
}
[["fAll", "all"], ["fTodo", "todo"], ["fNoPhoto", "nophoto"]].forEach(([id, f]) => {
  $(id).addEventListener("click", () => {
    filter = f;
    ["fAll", "fTodo", "fNoPhoto"].forEach(x => $(x).setAttribute("aria-pressed", x === id ? "true" : "false"));
    applyFilter();
  });
});

// ---------- Live sync ----------
let pollTimer = null, loadSeq = 0;
function showNotice(msg) { const n = $("notice"); n.textContent = msg || ""; n.hidden = !msg; }
async function load() {
  const seq = ++loadSeq;
  const date = dateInput.value;
  try {
    const data = await api("shift?date=" + encodeURIComponent(date));
    if (seq !== loadSeq || pending > 0 || date !== dateInput.value) return;
    items = data.items || {}; photos = data.photos || {};
    renderAll();
    showNotice("");
    $("syncText").textContent = "· Updated " + fmtTime(new Date().toISOString());
  } catch (e) {
    if (e instanceof AuthError) return;
    showNotice("Can't reach the checklist. Check your signal; it will keep trying.");
  }
}
function startPolling() { stopPolling(); pollTimer = setInterval(() => { if (!document.hidden) load(); }, 5000); }
function stopPolling() { if (pollTimer) clearInterval(pollTimer); pollTimer = null; }
document.addEventListener("visibilitychange", () => { if (!document.hidden && !$("app").hidden) load(); });

function updateViewing() {
  const past = dateInput.value !== todayISO();
  $("viewing").hidden = !past;
  if (past) $("viewingText").textContent = "Viewing " + fmtDate(dateInput.value);
}
function changeDate(d) {
  dateInput.value = d; items = {}; photos = {}; Object.keys(errs).forEach(k => delete errs[k]);
  updateViewing(); renderAll(); load();
}
dateInput.addEventListener("change", () => { if (dateInput.value) changeDate(dateInput.value); });
$("backToday").addEventListener("click", () => changeDate(todayISO()));

// ---------- Actions ----------
async function toggle(id) {
  const date = dateInput.value;
  const wasDone = !!items[id];
  const prev = items[id];
  delete errs[id];
  if (wasDone) delete items[id]; else items[id] = { by: myName, at: new Date().toISOString() };
  renderAll();
  pending++;
  try {
    const r = await api("item", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ date, id, done: !wasDone, by: myName }) });
    if (date === dateInput.value) { if (r.item) items[id] = r.item; }
  } catch (e) {
    if (date === dateInput.value) { if (prev) items[id] = prev; else delete items[id]; if (!(e instanceof AuthError)) errs[id] = "Couldn't save. Check your signal and try again."; }
  } finally { pending--; renderAll(); }
}

async function shrink(file) {
  const bmp = await createImageBitmap(file);
  const max = 1600, scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
  c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
  return await new Promise((res, rej) => c.toBlob(b => b ? res(b) : rej(new Error("encode")), "image/jpeg", 0.82));
}

async function addPhoto(id, file) {
  const date = dateInput.value;
  delete errs[id]; busy[id] = true; renderAll();
  pending++;
  try {
    let blob;
    try { blob = await shrink(file); }
    catch {
      if (/^image\/(jpeg|png|webp|gif)$/.test(file.type)) blob = file;
      else throw new Error("That photo format isn't supported. Use a JPG or PNG.");
    }
    const r = await api(`photo?date=${encodeURIComponent(date)}&id=${encodeURIComponent(id)}&by=${encodeURIComponent(myName)}`, {
      method: "POST", headers: { "content-type": blob.type || "image/jpeg" }, body: blob
    });
    if (date === dateInput.value) {
      photos[id] = [...(photos[id] || []), r.photo];
      if (!items[id]) items[id] = { by: r.photo.by, at: r.photo.at };
    }
  } catch (e) {
    if (!(e instanceof AuthError)) errs[id] = e.message || "The photo didn't upload. Check your signal and try again.";
  } finally { busy[id] = false; pending--; renderAll(); }
}

// ---------- Lightbox ----------
const lb = $("lightbox");
let lbCur = null;
function openLightbox(leaf, key) {
  lbCur = { leaf, key };
  const l = LEAVES.find(x => x.id === leaf);
  const p = (photos[leaf] || []).find(x => x.key === key);
  $("lbImg").src = photoUrl(key);
  $("lbCaption").textContent = `Task ${l.label}: ${titleOf(l)}` + (p && p.by ? ` · ${p.by}` : "") + (p && p.at ? ` at ${fmtTime(p.at)}` : "");
  const rm = $("lbRemove"); rm.textContent = "Remove photo"; rm.dataset.confirm = "";
  lb.hidden = false; $("lbClose").focus();
}
function closeLightbox() { lb.hidden = true; lbCur = null; }
$("lbClose").addEventListener("click", closeLightbox);
lb.addEventListener("click", e => { if (e.target === lb || e.target.classList.contains("lb-img")) closeLightbox(); });
document.addEventListener("keydown", e => { if (e.key === "Escape" && !lb.hidden) closeLightbox(); });
$("lbRemove").addEventListener("click", async e => {
  const btn = e.currentTarget;
  if (btn.dataset.confirm !== "1") {
    btn.dataset.confirm = "1"; btn.textContent = "Tap again to remove";
    setTimeout(() => { btn.dataset.confirm = ""; btn.textContent = "Remove photo"; }, 3000);
    return;
  }
  const { leaf, key } = lbCur; closeLightbox();
  const before = photos[leaf] || [];
  photos[leaf] = before.filter(p => p.key !== key); renderAll();
  pending++;
  try { await api("photo?key=" + encodeURIComponent(key), { method: "DELETE" }); }
  catch (er) { photos[leaf] = before; if (!(er instanceof AuthError)) errs[leaf] = "Couldn't remove the photo. Try again."; }
  finally { pending--; renderAll(); }
});

// ---------- History ----------
const histPanel = $("history"), histBtn = $("histBtn");
async function loadHistory() {
  const box = $("histList");
  box.innerHTML = `<div class="hist-empty">Loading past shifts…</div>`;
  try {
    const { days } = await api("history");
    if (!days.length) { box.innerHTML = `<div class="hist-empty">No shifts saved yet. Once tasks are ticked, each day appears here.</div>`; return; }
    box.innerHTML = days.map(r => {
      const pct = Math.min(100, Math.round(100 * r.done / LEAVES.length));
      return `<button class="hist-row${r.date === dateInput.value ? " current" : ""}${r.done >= LEAVES.length ? " full" : ""}" data-date="${esc(r.date)}">
        <span class="d">${esc(fmtDate(r.date))}</span>
        <span class="s">${r.done}/${LEAVES.length} done · ${r.photos} photos</span>
        <span class="mini" aria-hidden="true"><span style="width:${pct}%"></span></span>
      </button>`;
    }).join("");
  } catch (e) {
    if (!(e instanceof AuthError)) box.innerHTML = `<div class="hist-empty">Past shifts couldn't load. Try again in a moment.</div>`;
  }
}
function setHistory(open) {
  histPanel.hidden = !open; histBtn.setAttribute("aria-expanded", open ? "true" : "false");
  if (open) { setSettings(false); loadHistory(); window.scrollTo({ top: 0 }); }
}
histBtn.addEventListener("click", () => setHistory(histPanel.hidden));
$("histClose").addEventListener("click", () => setHistory(false));
$("histList").addEventListener("click", e => {
  const r = e.target.closest(".hist-row"); if (!r) return;
  setHistory(false); changeDate(r.dataset.date);
});

// ---------- Settings ----------
const setPanel = $("settings"), setBtn = $("settingsBtn");
function setSettings(open) {
  setPanel.hidden = !open; setBtn.setAttribute("aria-expanded", open ? "true" : "false");
  if (open) {
    setHistory(false);
    $("nameInput").value = myName; $("nameOk").hidden = true;
    $("pinErr").textContent = ""; $("pinOk").hidden = true; $("pinCur").value = ""; $("pinNew").value = "";
    window.scrollTo({ top: 0 });
  }
}
setBtn.addEventListener("click", () => setSettings(setPanel.hidden));
$("settingsClose").addEventListener("click", () => setSettings(false));
$("nameForm").addEventListener("submit", e => {
  e.preventDefault();
  const n = $("nameInput").value.trim(); if (!n) return;
  setName(n); $("nameOk").hidden = false;
});
$("pinForm").addEventListener("submit", async e => {
  e.preventDefault();
  $("pinErr").textContent = ""; $("pinOk").hidden = true;
  const current = $("pinCur").value.trim(), next = $("pinNew").value.trim();
  if (!/^\d{4,8}$/.test(next)) { $("pinErr").textContent = "The new PIN must be 4 to 8 digits."; return; }
  try {
    await api("change-pin", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ current, next }) });
    $("pinOk").hidden = false; $("pinCur").value = ""; $("pinNew").value = "";
  } catch (er) { $("pinErr").textContent = er.message; }
});
$("logoutBtn").addEventListener("click", async () => {
  try { await api("logout", { method: "POST" }); } catch {}
  setSettings(false); showGate(true);
});

// ---------- Start ----------
function openApp() {
  $("gate").hidden = true; $("app").hidden = false;
  setName(myName || "Staff");
  updateViewing(); renderAll(); load(); startPolling();
}
renderAll();
api("status").then(s => {
  if (s.authed && myName) openApp(); else showGate(s.pinSet);
}).catch(() => {
  $("gate").hidden = false;
  $("gateErr").textContent = "Can't reach the checklist. Check your signal and reload the page.";
});
})();
