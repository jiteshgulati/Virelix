// Client mirror of backend preprocessing, used only for display highlighting.
export function tokenizeQuery(text) {
  const norm = (text || "").normalize("NFKC").toLowerCase()
    .replace(/(?<=[\p{L}\p{N}])['’`](?=[\p{L}\p{N}])/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  return norm ? [...new Set(norm.split(" "))].slice(0, 24) : [];
}
