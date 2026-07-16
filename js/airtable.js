import { CONFIG } from "./config.js";

const API = "https://api.airtable.com/v0";

async function request(path, opts = {}) {
  const url = `${API}/${CONFIG.baseId}/${encodeURIComponent(CONFIG.tableName)}${path}`;
  const res = await fetch(url, {
    ...opts,
    headers: {
      Authorization: `Bearer ${CONFIG.airtableToken}`,
      "Content-Type": "application/json",
      ...(opts.headers || {}),
    },
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      msg = body.error?.message || body.error?.type || msg;
    } catch { /* non-JSON error body */ }
    throw new Error(`Airtable: ${msg}`);
  }
  return res.json();
}

function fromRecord(rec) {
  const f = rec.fields || {};
  const photo = Array.isArray(f.Photo) && f.Photo[0] ? f.Photo[0] : null;
  return {
    id: rec.id,
    name: f.Name || "",
    category: f.Category || "Other",
    quantity: f.Quantity ?? null,
    expiration: f["Expiration Date"] || null, // "YYYY-MM-DD"
    barcode: f.Barcode || "",
    notes: f.Notes || "",
    lastReplaced: f["Last Replaced"] || null,
    photoUrl: photo ? (photo.thumbnails?.large?.url || photo.url) : null,
    createdTime: rec.createdTime,
  };
}

function toFields(item) {
  const fields = {
    Name: item.name,
    Category: item.category,
    Quantity: item.quantity === null || item.quantity === "" ? null : Number(item.quantity),
    "Expiration Date": item.expiration || null,
    Barcode: item.barcode || "",
    Notes: item.notes || "",
    "Last Replaced": item.lastReplaced || null,
  };
  // Only (re)write the attachment when a new external image URL is being set;
  // otherwise leave the stored attachment untouched.
  if (item.newPhotoUrl) {
    fields.Photo = [{ url: item.newPhotoUrl }];
  }
  return fields;
}

export async function listItems() {
  const records = [];
  let offset;
  do {
    const q = new URLSearchParams({ pageSize: "100" });
    if (offset) q.set("offset", offset);
    const data = await request(`?${q}`);
    records.push(...data.records);
    offset = data.offset;
  } while (offset);
  return records.map(fromRecord);
}

export async function createItem(item) {
  const data = await request("", {
    method: "POST",
    body: JSON.stringify({ fields: toFields(item), typecast: true }),
  });
  return fromRecord(data);
}

export async function updateItem(id, item) {
  const data = await request(`/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ fields: toFields(item), typecast: true }),
  });
  return fromRecord(data);
}

export async function deleteItem(id) {
  await request(`/${id}`, { method: "DELETE" });
}
