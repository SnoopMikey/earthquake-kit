import { CONFIG } from "./config.js";

const API = "https://api.airtable.com/v0";
const CONTENT_API = "https://content.airtable.com/v0";

async function request(table, path, opts = {}) {
  const url = `${API}/${CONFIG.baseId}/${encodeURIComponent(table)}${path}`;
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

async function listAll(table) {
  const records = [];
  let offset;
  do {
    const q = new URLSearchParams({ pageSize: "100" });
    if (offset) q.set("offset", offset);
    const data = await request(table, `?${q}`);
    records.push(...data.records);
    offset = data.offset;
  } while (offset);
  return records;
}

// ---------- Items ----------

function fromItemRecord(rec) {
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
    photoUrl: photo ? (photo.thumbnails?.large?.url || photo.url) : null,
    createdTime: rec.createdTime,
  };
}

function toItemFields(item) {
  const fields = {
    Name: item.name,
    Category: item.category,
    Quantity: item.quantity === null || item.quantity === "" ? null : Number(item.quantity),
    "Expiration Date": item.expiration || null,
    Barcode: item.barcode || "",
    Notes: item.notes || "",
  };
  // Only (re)write the attachment when a new external image URL is being set;
  // otherwise leave the stored attachment untouched.
  if (item.newPhotoUrl) {
    fields.Photo = [{ url: item.newPhotoUrl }];
  }
  return fields;
}

export async function listItems() {
  return (await listAll(CONFIG.tableName)).map(fromItemRecord);
}

export async function createItem(item) {
  const data = await request(CONFIG.tableName, "", {
    method: "POST",
    body: JSON.stringify({ fields: toItemFields(item), typecast: true }),
  });
  return fromItemRecord(data);
}

export async function updateItem(id, item) {
  const data = await request(CONFIG.tableName, `/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ fields: toItemFields(item), typecast: true }),
  });
  return fromItemRecord(data);
}

export async function deleteItem(id) {
  await request(CONFIG.tableName, `/${id}`, { method: "DELETE" });
}

// Upload a captured photo (base64 JPEG) into the record's Photo field.
export async function uploadItemPhoto(recordId, photo) {
  const url = `${CONTENT_API}/${CONFIG.baseId}/${recordId}/Photo/uploadAttachment`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${CONFIG.airtableToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      contentType: photo.contentType,
      filename: `photo-${recordId}.jpg`,
      file: photo.base64,
    }),
  });
  if (!res.ok) throw new Error(`Airtable upload: HTTP ${res.status}`);
}

// ---------- Evacuation checklist ----------

function fromEvacRecord(rec) {
  const f = rec.fields || {};
  return {
    id: rec.id,
    name: f.Item || "",
    notes: f.Notes || "",
    packed: !!f.Packed,
    createdTime: rec.createdTime,
  };
}

export async function listEvac() {
  return (await listAll(CONFIG.evacTableName))
    .map(fromEvacRecord)
    .sort((a, b) => a.createdTime.localeCompare(b.createdTime));
}

export async function createEvac(name) {
  const data = await request(CONFIG.evacTableName, "", {
    method: "POST",
    body: JSON.stringify({ fields: { Item: name } }),
  });
  return fromEvacRecord(data);
}

export async function updateEvac(id, fields) {
  const data = await request(CONFIG.evacTableName, `/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ fields: { Item: fields.name, Packed: fields.packed } }),
  });
  return fromEvacRecord(data);
}

export async function deleteEvac(id) {
  await request(CONFIG.evacTableName, `/${id}`, { method: "DELETE" });
}

// Uncheck everything (batched — Airtable allows 10 records per request).
export async function resetEvac(ids) {
  for (let i = 0; i < ids.length; i += 10) {
    await request(CONFIG.evacTableName, "", {
      method: "PATCH",
      body: JSON.stringify({
        records: ids.slice(i, i + 10).map((id) => ({ id, fields: { Packed: false } })),
      }),
    });
  }
}
