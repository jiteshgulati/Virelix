const dateFmt = new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "numeric" });
const timeFmt = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" });
const dtFmt = new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
const nf = new Intl.NumberFormat();

/** Only same-origin relative paths are allowed as link targets (no javascript:, data:, //host). */
export function safePath(value, fallback = null) {
  const v = String(value ?? "");
  return v.startsWith("/") && !v.startsWith("//") && !v.startsWith("/\\") ? v : fallback;
}

export const num = (n) => (n === null || n === undefined ? "—" : nf.format(n));

export function date(value) {
  if (!value) return "—";
  const d = new Date(value.length === 10 ? `${value}T00:00:00` : value);
  return Number.isNaN(d.getTime()) ? value : dateFmt.format(d);
}

export const time = (v) => (v ? timeFmt.format(new Date(v)) : "—");
export const datetime = (v) => (v ? dtFmt.format(new Date(v)) : "—");

export function relative(value) {
  if (!value) return "—";
  const diff = (new Date(value).getTime() - Date.now()) / 1000;
  const abs = Math.abs(diff);
  if (abs < 45) return diff < 0 ? "just now" : "in a moment";
  const units = [["minute", 60], ["hour", 3600], ["day", 86400], ["week", 604800], ["month", 2629800], ["year", 31557600]];
  let unit = "minute";
  let size = 60;
  for (const [u, s] of units) { if (abs >= s) { unit = u; size = s; } }
  return rtf.format(Math.round(diff / size), unit);
}

export function bytes(n) {
  if (n === null || n === undefined) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function duration(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

export function dayGroup(value) {
  const d = new Date(value);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const that = new Date(d); that.setHours(0, 0, 0, 0);
  const days = Math.round((today - that) / 86400000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return "This week";
  return dateFmt.format(d);
}

export const plural = (n, one, many = `${one}s`) => `${num(n)} ${n === 1 ? one : many}`;

export const roleLabel = (r) => ({ user: "Member", admin: "Admin", owner: "Owner" }[r] || r);
export const modeLabel = (m) => ({ all: "All terms", any: "Any term", phrase: "Exact phrase" }[m] || m);
export const sourceLabel = (s) => ({ corpus: "Shared corpus", attachments: "My attachments", attachment: "Private attachment" }[s] || s);
