// Runtime configuration.
// The token below is a limited Airtable personal access token with
// data.records:read + data.records:write scoped to ONLY this base.
export const CONFIG = {
  airtableToken: "",   // pat… (runtime token — filled in during setup)
  baseId: "appd8hZ3F0sOhoxo7",
  tableName: "Items",
  // Items expiring within this many days count as "Expiring soon".
  // Keep in sync with the Airtable email automation's filter.
  soonDays: 90,
};

export const CATEGORIES = [
  { name: "Water",             emoji: "💧" },
  { name: "Food",              emoji: "🥫" },
  { name: "First Aid",         emoji: "⛑️" },
  { name: "Medication",        emoji: "💊" },
  { name: "Light & Power",     emoji: "🔦" },
  { name: "Tools",             emoji: "🔧" },
  { name: "Communication",     emoji: "📻" },
  { name: "Hygiene",           emoji: "🧼" },
  { name: "Documents & Cash",  emoji: "📄" },
  { name: "Clothing & Warmth", emoji: "🧥" },
  { name: "Other",             emoji: "📦" },
];

export function isConfigured() {
  return CONFIG.airtableToken.startsWith("pat") && CONFIG.baseId.startsWith("app");
}
