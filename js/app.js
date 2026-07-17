import { CONFIG, CATEGORIES, isConfigured } from "./config.js";
import * as airtable from "./airtable.js";
import { lookupBarcode } from "./lookup.js";
import { scannerAvailable, startScan, stopScan } from "./scanner.js";
import { unlockAudio, beep } from "./beep.js";
import { pickPhoto, fileToJpeg } from "./photo.js";
import { readCache, writeCache, readQueue, writeQueue, enqueue, relTime } from "./offline.js";

// ---------- state ----------

const state = {
  tab: "kit",           // 'kit' | 'evac'
  items: [],
  evacItems: [],
  statusFilter: null,   // 'expired' | 'soon' | 'ok' | 'none' | null
  categoryFilter: null, // category name | null
  query: "",
  offline: false,
  syncedAt: null,       // ms timestamp of last successful Airtable pull
};

let pendingPhoto = null; // {dataUrl, base64, contentType} captured but not yet saved

const demo = !isConfigured();

// In-memory store used until Airtable is wired up, so the UI is fully usable.
const demoStore = {
  seq: 0,
  items: [
    { name: "Bottled water 24-pack", category: "Water", quantity: 2, expiration: offsetDate(-20), notes: "Rotate every 6 months" },
    { name: "Clif Bars variety box", category: "Food", quantity: 12, expiration: offsetDate(45) },
    { name: "Adhesive bandages", category: "First Aid", quantity: 1, expiration: offsetDate(400) },
    { name: "Ibuprofen 200mg", category: "Medication", quantity: 1, expiration: offsetDate(75) },
    { name: "Manual can opener", category: "Kitchen", quantity: 1, expiration: null },
    { name: "LED flashlight", category: "Light & Power", quantity: 2, expiration: null },
    { name: "AA batteries 12-pack", category: "Light & Power", quantity: 1, expiration: offsetDate(900) },
    { name: "Hand-crank radio", category: "Communication", quantity: 1, expiration: null },
  ].map((it, i) => ({ id: `demo${i}`, barcode: "", notes: "", photoUrl: null, ...it })),
  evac: [
    "Passports & documents binder",
    "Wallet & keys",
    "Phone chargers",
    "Prescription meds",
    "Laptop",
  ].map((name, i) => ({ id: `evac${i}`, name, notes: "", packed: i < 2, createdTime: String(i) })),
  evacSeq: 5,
};
demoStore.seq = demoStore.items.length;

function offsetDate(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

// ---------- data layer (demo vs airtable) ----------

const store = demo
  ? {
      list: async () => [...demoStore.items],
      create: async (item) => {
        const rec = { ...item, id: `demo${demoStore.seq++}`, photoUrl: item.newPhotoUrl || null };
        demoStore.items.push(rec);
        return rec;
      },
      update: async (id, item) => {
        const i = demoStore.items.findIndex((x) => x.id === id);
        const prev = demoStore.items[i];
        demoStore.items[i] = { ...prev, ...item, id, photoUrl: item.newPhotoUrl || prev.photoUrl };
        return demoStore.items[i];
      },
      remove: async (id) => {
        demoStore.items = demoStore.items.filter((x) => x.id !== id);
      },
      attachPhoto: async () => {},
      evacList: async () => [...demoStore.evac],
      evacCreate: async (name) => {
        const rec = { id: `evac${demoStore.evacSeq++}`, name, notes: "", packed: false, createdTime: String(Date.now()) };
        demoStore.evac.push(rec);
        return rec;
      },
      evacUpdate: async (id, fields) => {
        const rec = demoStore.evac.find((x) => x.id === id);
        Object.assign(rec, fields);
        return rec;
      },
      evacRemove: async (id) => {
        demoStore.evac = demoStore.evac.filter((x) => x.id !== id);
      },
      evacReset: async () => {
        demoStore.evac.forEach((x) => { x.packed = false; });
      },
    }
  : {
      list: airtable.listItems,
      create: airtable.createItem,
      update: airtable.updateItem,
      remove: airtable.deleteItem,
      attachPhoto: airtable.uploadItemPhoto,
      evacList: airtable.listEvac,
      evacCreate: airtable.createEvac,
      evacUpdate: airtable.updateEvac,
      evacRemove: airtable.deleteEvac,
      evacReset: airtable.resetEvac,
    };

// fetch throws TypeError when the network itself is unreachable; Airtable
// HTTP errors surface as plain Errors. This distinction drives offline UX.
const isNetworkError = (err) => err instanceof TypeError;

function persistCache() {
  if (demo) return;
  writeCache({ items: state.items, evacItems: state.evacItems, syncedAt: state.syncedAt });
}

// ---------- status helpers ----------

function daysUntil(dateStr) {
  if (!dateStr) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(`${dateStr}T00:00:00`);
  return Math.round((d - today) / 86400000);
}

function statusOf(item) {
  const days = daysUntil(item.expiration);
  if (days === null) return "none";
  if (days < 0) return "expired";
  if (days <= CONFIG.soonDays) return "soon";
  return "ok";
}

function statusLabel(item) {
  const days = daysUntil(item.expiration);
  if (days === null) return "No expiry";
  if (days < -1) return `Expired ${-days}d ago`;
  if (days === -1) return "Expired yesterday";
  if (days === 0) return "Expires today";
  if (days === 1) return "Expires tomorrow";
  if (days <= 60) return `Expires in ${days}d`;
  return `Expires ${item.expiration}`;
}

const STATUS_ORDER = { expired: 0, soon: 1, ok: 2, none: 3 };

function sortItems(items) {
  return [...items].sort((a, b) => {
    const s = STATUS_ORDER[statusOf(a)] - STATUS_ORDER[statusOf(b)];
    if (s !== 0) return s;
    const da = daysUntil(a.expiration);
    const db = daysUntil(b.expiration);
    if (da !== null && db !== null && da !== db) return da - db;
    return a.name.localeCompare(b.name);
  });
}

function categoryEmoji(name) {
  return CATEGORIES.find((c) => c.name === name)?.emoji || "📦";
}

// ---------- DOM helpers ----------

const $ = (sel) => document.querySelector(sel);

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

let toastTimer;
function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
}

function updateBanner() {
  const banner = $("#banner");
  if (demo) {
    banner.hidden = false;
    banner.textContent = "Demo mode — Airtable isn’t connected yet, so changes won’t be saved.";
    return;
  }
  if (state.offline) {
    const pending = readQueue().length;
    const synced = state.syncedAt ? `synced ${relTime(state.syncedAt)}` : "never synced";
    banner.hidden = false;
    banner.textContent = `📴 Offline — showing data ${synced}.` +
      (pending ? ` ${pending} checklist change${pending > 1 ? "s" : ""} will sync when you’re back online.` : "");
  } else {
    banner.hidden = true;
  }
}

// ---------- tabs ----------

function switchTab(tab) {
  state.tab = tab;
  $("#kitView").hidden = tab !== "kit";
  $("#evacView").hidden = tab !== "evac";
  $("#fab").hidden = tab !== "kit";
  document.querySelectorAll(".tabbar .tab").forEach((b) => {
    b.classList.toggle("active", b.dataset.tab === tab);
  });
}

// ---------- rendering: kit ----------

function render() {
  renderSummary();
  renderChips();
  renderList();
  renderEvac();
}

function renderSummary() {
  const counts = { expired: 0, soon: 0, ok: 0, none: 0 };
  for (const it of state.items) counts[statusOf(it)]++;
  const defs = [
    ["expired", "Expired"],
    ["soon", `≤ ${CONFIG.soonDays} days`],
    ["ok", "OK"],
    ["none", "No expiry"],
  ];
  $("#summary").innerHTML = defs
    .map(([key, label]) =>
      `<button class="stat ${key} ${state.statusFilter === key ? "active" : ""}" data-status="${key}">
        <span class="num">${counts[key]}</span><span class="lbl">${esc(label)}</span>
      </button>`)
    .join("");
}

function renderChips() {
  const inUse = new Set(state.items.map((it) => it.category));
  const cats = CATEGORIES.filter((c) => inUse.has(c.name));
  $("#categoryChips").innerHTML = cats
    .map((c) =>
      `<button class="chip ${state.categoryFilter === c.name ? "active" : ""}" data-category="${esc(c.name)}">
        ${c.emoji} ${esc(c.name)}
      </button>`)
    .join("");
}

function visibleItems() {
  const q = state.query.trim().toLowerCase();
  return sortItems(state.items.filter((it) => {
    if (state.statusFilter && statusOf(it) !== state.statusFilter) return false;
    if (state.categoryFilter && it.category !== state.categoryFilter) return false;
    if (q && !`${it.name} ${it.notes} ${it.barcode}`.toLowerCase().includes(q)) return false;
    return true;
  }));
}

function renderList() {
  const items = visibleItems();
  const list = $("#list");
  const empty = $("#empty");

  list.innerHTML = items
    .map((it) => {
      const st = statusOf(it);
      const qty = it.quantity ? `×${it.quantity} · ` : "";
      const emoji = categoryEmoji(it.category);
      const thumb = it.photoUrl
        ? `<img src="${esc(it.photoUrl)}" alt="" loading="lazy">`
        : emoji;
      return `<li class="item-card" data-id="${esc(it.id)}">
        <div class="item-thumb" data-emoji="${emoji}">${thumb}</div>
        <div class="item-body">
          <div class="item-name">${esc(it.name)}</div>
          <div class="item-sub">${qty}${esc(it.category)}</div>
        </div>
        <span class="badge ${st}">${esc(statusLabel(it))}</span>
      </li>`;
    })
    .join("");

  empty.hidden = items.length > 0;
  if (items.length === 0) {
    empty.textContent = state.items.length === 0
      ? "Your kit is empty. Tap “＋ Add item” to start logging."
      : "No items match the current filters.";
  }
}

// ---------- rendering: evacuation ----------

function renderEvac() {
  const items = state.evacItems;
  const packed = items.filter((x) => x.packed).length;

  $("#evacProgress").textContent = items.length
    ? `${packed} of ${items.length} packed`
    : "Grab-and-go checklist";
  $("#evacBarFill").style.width = items.length ? `${(packed / items.length) * 100}%` : "0";
  $("#evacReset").hidden = packed === 0;

  $("#evacList").innerHTML = items
    .map((it) =>
      `<li class="evac-item ${it.packed ? "packed" : ""}" data-id="${esc(it.id)}">
        <label>
          <input type="checkbox" ${it.packed ? "checked" : ""}>
          <span class="evac-name">${esc(it.name)}</span>
        </label>
        <button class="evac-del" aria-label="Remove ${esc(it.name)}">✕</button>
      </li>`)
    .join("");

  const empty = $("#evacEmpty");
  empty.hidden = items.length > 0;
  if (items.length === 0) {
    empty.textContent =
      "Nothing here yet — list the things to grab in an evacuation that aren’t stored in the kit (documents, meds, chargers, pets…).";
  }
}

// ---------- offline queue (evacuation checklist) ----------

let flushing = false;

// Replays queued checklist ops against Airtable. Network failure keeps the
// op queued for later; a permanent error (e.g. record deleted) drops it.
async function flushQueue() {
  if (demo || flushing) return false;
  flushing = true;
  let syncedSomething = false;
  try {
    while (true) {
      const q = readQueue();
      if (!q.length) break;
      const op = q[0];
      try {
        if (op.t === "add") {
          const rec = await airtable.createEvac(op.name);
          const local = state.evacItems.find((x) => x.id === op.tempId);
          if (local) {
            local.id = rec.id;
            local.createdTime = rec.createdTime;
          }
          writeQueue(q.slice(1).map((o) => (o.id === op.tempId ? { ...o, id: rec.id } : o)));
        } else if (op.t === "toggle") {
          await airtable.updateEvac(op.id, { name: op.name, packed: op.packed });
          writeQueue(q.slice(1));
        } else if (op.t === "del") {
          await airtable.deleteEvac(op.id);
          writeQueue(q.slice(1));
        } else {
          writeQueue(q.slice(1));
        }
        syncedSomething = true;
        state.offline = false;
      } catch (err) {
        if (isNetworkError(err)) {
          state.offline = true;
          break; // still offline — retry on the next flush
        }
        writeQueue(q.slice(1)); // permanent failure — drop the op
      }
    }
  } finally {
    flushing = false;
  }
  if (syncedSomething) persistCache();
  updateBanner();
  return syncedSomething;
}

// Re-applies still-queued ops on top of a fresh server pull, so pending
// offline changes aren't visually lost mid-sync.
function applyQueueToState() {
  for (const op of readQueue()) {
    if (op.t === "add" && !state.evacItems.some((x) => x.id === op.tempId)) {
      state.evacItems.push({ id: op.tempId, name: op.name, notes: "", packed: false, createdTime: op.at || "~" });
    } else if (op.t === "toggle") {
      const rec = state.evacItems.find((x) => x.id === op.id);
      if (rec) rec.packed = op.packed;
    } else if (op.t === "del") {
      state.evacItems = state.evacItems.filter((x) => x.id !== op.id);
    }
  }
}

let tempSeq = 0;
const newTempId = () => `tmp-${Date.now()}-${tempSeq++}`;

// ---------- data loading ----------

async function load() {
  if (demo) {
    state.items = await store.list();
    state.evacItems = await store.evacList();
    render();
    return;
  }

  // Render instantly from the last sync while the network round-trip runs.
  const cached = readCache();
  if (cached) {
    state.items = cached.items || [];
    state.evacItems = cached.evacItems || [];
    state.syncedAt = cached.syncedAt || null;
    applyQueueToState();
    render();
  }

  await flushQueue(); // push pending changes before pulling

  try {
    const [items, evacItems] = await Promise.all([store.list(), store.evacList()]);
    state.items = items;
    state.evacItems = evacItems;
    applyQueueToState();
    state.syncedAt = Date.now();
    state.offline = false;
    persistCache();
    render();
  } catch (err) {
    if (isNetworkError(err)) {
      state.offline = true;
      if (!cached) toast("Offline, and no cached data yet — connect once to sync.");
    } else if (!cached) {
      toast(`Couldn’t load — ${err.message}`);
    } else {
      toast(`Refresh failed — ${err.message}`);
    }
  }
  updateBanner();
}

// ---------- add / edit dialog ----------

const dialog = $("#itemDialog");
const form = $("#itemForm");

function openDialog(item = null) {
  form.reset();
  pendingPhoto = null;
  $("#dialogTitle").textContent = item ? "Edit item" : "Add item";
  $("#deleteBtn").hidden = !item;
  $("#lookupStatus").hidden = true;
  setPhotoPreview(item?.photoUrl || null);
  form.elements.id.value = item?.id || "";
  form.elements.name.value = item?.name || "";
  form.elements.category.value = item?.category || "Other";
  form.elements.quantity.value = item?.quantity ?? "";
  form.elements.expiration.value = item?.expiration || "";
  form.elements.notes.value = item?.notes || "";
  form.elements.barcode.value = item?.barcode || "";
  form.elements.photoUrl.value = "";
  $("#metaLine").textContent = item?.barcode ? `Barcode ${item.barcode}` : "";

  dialog.showModal();
}

function setPhotoPreview(url) {
  const box = $("#photoPreview");
  box.hidden = !url;
  box.innerHTML = url ? `<img src="${esc(url)}" alt="Product photo">` : "";
}

function readForm() {
  return {
    name: form.elements.name.value.trim(),
    category: form.elements.category.value,
    quantity: form.elements.quantity.value === "" ? null : Number(form.elements.quantity.value),
    expiration: form.elements.expiration.value || null,
    notes: form.elements.notes.value.trim(),
    barcode: form.elements.barcode.value.trim(),
    // A captured photo wins over a product-lookup image URL.
    newPhotoUrl: pendingPhoto ? null : (form.elements.photoUrl.value || null),
  };
}

async function saveItem() {
  const id = form.elements.id.value;
  const item = readForm();
  if (!item.name) return;
  try {
    let saved;
    if (id) {
      saved = await store.update(id, item);
      state.items = state.items.map((x) => (x.id === id ? saved : x));
    } else {
      saved = await store.create(item);
      state.items.push(saved);
    }
    if (pendingPhoto) {
      try {
        await store.attachPhoto(saved.id, pendingPhoto);
        saved.photoUrl = pendingPhoto.dataUrl;
      } catch {
        toast("Saved, but the photo upload failed");
      }
      pendingPhoto = null;
    }
    state.offline = false;
    persistCache();
    updateBanner();
    toast(id ? "Saved" : `Added ${saved.name}`);
    dialog.close();
    render();
  } catch (err) {
    if (isNetworkError(err)) {
      state.offline = true;
      updateBanner();
      toast("You’re offline — kit changes can’t be saved right now.");
    } else {
      toast(`Save failed — ${err.message}`);
    }
  }
}

// ---------- photo capture ----------

async function takePhoto() {
  const file = await pickPhoto($("#photoInput"));
  if (!file) return;
  try {
    pendingPhoto = await fileToJpeg(file);
    form.elements.photoUrl.value = "";
    setPhotoPreview(pendingPhoto.dataUrl);
  } catch {
    toast("Couldn’t process that photo");
  }
}

// ---------- scanning ----------

const scanOverlay = $("#scanOverlay");

async function openScanner() {
  unlockAudio(); // user gesture — prime audio so the decode beep can play on iOS
  scanOverlay.showModal();
  $("#manualBarcode").value = "";
  $(".scan-hint").textContent = "Point the camera at the UPC/EAN barcode.";
  if (!scannerAvailable()) {
    $(".scan-hint").textContent =
      "Camera scanning isn’t available here — type the barcode number instead.";
    return;
  }
  try {
    await startScan("reader", onBarcode);
  } catch {
    $(".scan-hint").textContent =
      "Couldn’t start the camera (permission denied?). Type the barcode number instead.";
  }
}

async function closeScanner() {
  await stopScan();
  if (scanOverlay.open) scanOverlay.close();
}

async function onBarcode(code) {
  beep();
  await closeScanner();
  form.elements.barcode.value = code;
  const status = $("#lookupStatus");
  status.hidden = false;
  status.className = "lookup-status";
  status.textContent = `Looking up ${code}…`;

  const hit = await lookupBarcode(code);
  if (hit) {
    if (!form.elements.name.value.trim()) form.elements.name.value = hit.name;
    form.elements.category.value = hit.category;
    if (hit.photoUrl && !pendingPhoto) {
      form.elements.photoUrl.value = hit.photoUrl;
      setPhotoPreview(hit.photoUrl);
    }
    status.className = "lookup-status ok";
    status.textContent = `✓ Found via ${hit.source} — set the expiration date from the package.`;
  } else {
    status.className = "lookup-status warn";
    status.textContent = `Barcode ${code} saved, but no product match — enter the details or 📸 take a photo.`;
  }
}

// ---------- evacuation actions (queue-backed when live) ----------

async function evacAdd(name) {
  if (demo) {
    state.evacItems.push(await store.evacCreate(name));
  } else {
    const tempId = newTempId();
    const at = new Date().toISOString();
    state.evacItems.push({ id: tempId, name, notes: "", packed: false, createdTime: at });
    enqueue({ t: "add", tempId, name, at });
    flushQueue();
  }
  persistCache();
  renderEvac();
}

async function evacToggle(rec, packed) {
  rec.packed = packed;
  renderEvac();
  if (demo) {
    await store.evacUpdate(rec.id, { name: rec.name, packed });
  } else {
    enqueue({ t: "toggle", id: rec.id, name: rec.name, packed });
    flushQueue();
  }
  persistCache();
}

async function evacRemove(rec) {
  state.evacItems = state.evacItems.filter((x) => x.id !== rec.id);
  renderEvac();
  if (demo) {
    await store.evacRemove(rec.id);
  } else {
    enqueue({ t: "del", id: rec.id });
    flushQueue();
  }
  persistCache();
}

async function evacResetAll() {
  const packedRecs = state.evacItems.filter((x) => x.packed);
  state.evacItems.forEach((x) => { x.packed = false; });
  renderEvac();
  if (demo) {
    await store.evacReset(packedRecs.map((x) => x.id));
  } else {
    packedRecs.forEach((rec) => enqueue({ t: "toggle", id: rec.id, name: rec.name, packed: false }));
    flushQueue();
  }
  persistCache();
}

// ---------- events ----------

function bindEvents() {
  document.querySelector(".tabbar").addEventListener("click", (e) => {
    const btn = e.target.closest(".tab");
    if (btn) switchTab(btn.dataset.tab);
  });

  $("#summary").addEventListener("click", (e) => {
    const btn = e.target.closest(".stat");
    if (!btn) return;
    state.statusFilter = state.statusFilter === btn.dataset.status ? null : btn.dataset.status;
    render();
  });

  $("#categoryChips").addEventListener("click", (e) => {
    const chip = e.target.closest(".chip");
    if (!chip) return;
    state.categoryFilter = state.categoryFilter === chip.dataset.category ? null : chip.dataset.category;
    render();
  });

  $("#search").addEventListener("input", (e) => {
    state.query = e.target.value;
    renderList();
  });

  $("#list").addEventListener("click", (e) => {
    const card = e.target.closest(".item-card");
    if (!card) return;
    const item = state.items.find((x) => x.id === card.dataset.id);
    if (item) openDialog(item);
  });

  // Offline (or expired attachment URL): swap a broken photo for the emoji.
  $("#list").addEventListener("error", (e) => {
    if (e.target.tagName !== "IMG") return;
    const thumb = e.target.closest(".item-thumb");
    e.target.remove();
    if (thumb) thumb.textContent = thumb.dataset.emoji || "📦";
  }, true);

  $("#fab").addEventListener("click", () => openDialog());
  $("#refreshBtn").addEventListener("click", () => { load(); toast("Refreshing…"); });
  $("#closeDialog").addEventListener("click", () => dialog.close());

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    saveItem();
  });

  $("#deleteBtn").addEventListener("click", async () => {
    const id = form.elements.id.value;
    if (!id) return;
    const item = state.items.find((x) => x.id === id);
    if (!confirm(`Delete “${item?.name}” from the kit?`)) return;
    try {
      await store.remove(id);
      state.items = state.items.filter((x) => x.id !== id);
      persistCache();
      dialog.close();
      render();
      toast("Deleted");
    } catch (err) {
      toast(isNetworkError(err)
        ? "You’re offline — kit changes can’t be saved right now."
        : `Delete failed — ${err.message}`);
    }
  });

  document.querySelector(".quick-dates").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-months]");
    if (!btn) return;
    const months = Number(btn.dataset.months);
    if (months === 0) {
      form.elements.expiration.value = "";
      return;
    }
    const d = new Date();
    d.setMonth(d.getMonth() + months);
    form.elements.expiration.value = d.toISOString().slice(0, 10);
  });

  $("#scanBtn").addEventListener("click", openScanner);
  $("#photoBtn").addEventListener("click", takePhoto);
  $("#closeScan").addEventListener("click", closeScanner);
  $("#scanToPhoto").addEventListener("click", async () => {
    await closeScanner();
    takePhoto();
  });
  scanOverlay.addEventListener("cancel", () => stopScan()); // Esc key
  scanOverlay.addEventListener("close", () => stopScan());
  $("#manualBarcodeForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const code = $("#manualBarcode").value.trim();
    if (code) onBarcode(code);
  });

  // ----- evacuation checklist -----

  $("#evacAddForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const input = $("#evacAddInput");
    const name = input.value.trim();
    if (!name) return;
    evacAdd(name);
    input.value = "";
  });

  $("#evacList").addEventListener("change", (e) => {
    const li = e.target.closest(".evac-item");
    if (!li || e.target.type !== "checkbox") return;
    const rec = state.evacItems.find((x) => x.id === li.dataset.id);
    if (rec) evacToggle(rec, e.target.checked);
  });

  $("#evacList").addEventListener("click", (e) => {
    const del = e.target.closest(".evac-del");
    if (!del) return;
    const li = del.closest(".evac-item");
    const rec = state.evacItems.find((x) => x.id === li.dataset.id);
    if (!rec) return;
    if (!confirm(`Remove “${rec.name}” from the evacuation list?`)) return;
    evacRemove(rec);
  });

  $("#evacReset").addEventListener("click", () => {
    if (!confirm("Uncheck everything on the evacuation list?")) return;
    evacResetAll();
  });

  // Resync automatically when connectivity returns.
  window.addEventListener("online", () => load());
}

// ---------- init ----------

function init() {
  $("#categorySelect").innerHTML = CATEGORIES
    .map((c) => `<option value="${esc(c.name)}">${c.emoji} ${esc(c.name)}</option>`)
    .join("");

  updateBanner();
  bindEvents();
  load();

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }

  // Debug/testing hook (harmless in production).
  window.__duxprep = { state, load, flushQueue, readQueue };
}

init();
