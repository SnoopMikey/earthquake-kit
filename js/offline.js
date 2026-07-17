// Offline persistence: the last successful Airtable sync lives in
// localStorage so the app renders instantly (and offline), plus a small
// mutation queue for evacuation-checklist changes made while offline.

const CACHE_KEY = "duxprep-data";
const QUEUE_KEY = "duxprep-queue";

export function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function writeCache(data) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(data));
  } catch { /* storage full/unavailable — cache is best-effort */ }
}

export function readQueue() {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function writeQueue(queue) {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  } catch { /* best-effort */ }
}

// Queue ops:
//   {t:"add",    tempId, name, at}
//   {t:"toggle", id, name, packed}
//   {t:"del",    id}
// Coalesces so the queue stays minimal (one toggle per item; deleting an
// item that was only added offline erases both ops).
export function enqueue(op) {
  let q = readQueue();
  if (op.t === "toggle") {
    q = q.filter((o) => !(o.t === "toggle" && o.id === op.id));
    q.push(op);
  } else if (op.t === "del") {
    const hadPendingAdd = q.some((o) => o.t === "add" && o.tempId === op.id);
    q = q.filter((o) => !(o.t === "toggle" && o.id === op.id) && !(o.t === "add" && o.tempId === op.id));
    if (!hadPendingAdd) q.push(op);
  } else {
    q.push(op);
  }
  writeQueue(q);
}

export function relTime(ts) {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(ts).toLocaleString();
}
