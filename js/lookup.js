// Barcode → product info lookup.
// Tries Open Food Facts first (free, unlimited, food/water focused),
// then UPCitemdb's trial endpoint (broader products, ~100 lookups/day).
// Returns { name, category, photoUrl, source } or null if nothing matched.

const UPC_CATEGORY_RULES = [
  [/water/i, "Water"],
  [/first aid/i, "First Aid"],
  [/medic|pharma|drug|health care|vitamin/i, "Medication"],
  [/food|beverage|grocery|snack|nutrition/i, "Food"],
  [/flashlight|lighting|batter|power|electronic/i, "Light & Power"],
  [/tool|hardware/i, "Tools"],
  [/radio|phone|communication/i, "Communication"],
  [/hygiene|personal care|toilet|soap|sanit|wipe/i, "Hygiene"],
  [/cloth|apparel|blanket|shoe/i, "Clothing & Warmth"],
];

function categorize(text) {
  for (const [re, cat] of UPC_CATEGORY_RULES) {
    if (re.test(text)) return cat;
  }
  return "Other";
}

function joinBrandName(brand, name) {
  if (!name) return brand || "";
  if (!brand) return name;
  return name.toLowerCase().includes(brand.toLowerCase()) ? name : `${brand} ${name}`;
}

async function tryOpenFoodFacts(code) {
  const url =
    `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json` +
    `?fields=product_name,brands,quantity,image_front_url,categories_tags`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json();
  if (data.status !== 1 || !data.product) return null;
  const p = data.product;
  const brand = (p.brands || "").split(",")[0].trim();
  let name = joinBrandName(brand, (p.product_name || "").trim());
  if (!name) return null;
  if (p.quantity) name += ` (${p.quantity})`;
  const tags = (p.categories_tags || []).join(" ");
  const category = /water/i.test(tags) ? "Water" : "Food";
  return { name, category, photoUrl: p.image_front_url || null, source: "Open Food Facts" };
}

async function tryUpcItemDb(code) {
  const url = `https://api.upcitemdb.com/prod/trial/lookup?upc=${encodeURIComponent(code)}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json();
  const item = data.items && data.items[0];
  if (!item || !item.title) return null;
  return {
    name: joinBrandName((item.brand || "").trim(), item.title.trim()),
    category: categorize(item.category || item.title),
    photoUrl: (item.images && item.images[0]) || null,
    source: "UPCitemdb",
  };
}

export async function lookupBarcode(code) {
  for (const fn of [tryOpenFoodFacts, tryUpcItemDb]) {
    try {
      const hit = await fn(code);
      if (hit) return hit;
    } catch { /* network/CORS failure — fall through to next source */ }
  }
  return null;
}
