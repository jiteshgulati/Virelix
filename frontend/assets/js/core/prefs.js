// Appearance preferences: applied to <html> data attributes and mirrored to localStorage.
const KEY = "vx-prefs";
const APPEARANCE = ["theme", "accent", "text_size", "density", "sidebar", "motion"];
const media = window.matchMedia("(prefers-color-scheme: dark)");
let current = {};

export function readLocal() {
  try { return JSON.parse(localStorage.getItem(KEY) || "{}"); } catch { return {}; }
}

function writeLocal(prefs) {
  try {
    const subset = {};
    APPEARANCE.forEach((k) => { if (prefs[k] !== undefined) subset[k] = prefs[k]; });
    localStorage.setItem(KEY, JSON.stringify(subset));
  } catch { /* private mode */ }
}

export function resolvedTheme(theme = current.theme || "light") {
  return theme === "system" ? (media.matches ? "dark" : "light") : theme;
}

export function applyPrefs(prefs = {}) {
  current = { ...current, ...prefs };
  const d = document.documentElement;
  const theme = resolvedTheme(current.theme);
  d.dataset.theme = theme;
  d.dataset.bsTheme = theme === "light" ? "light" : "dark";
  d.dataset.accent = current.accent || "viridian";
  d.dataset.text = current.text_size || "md";
  d.dataset.density = current.density || "comfortable";
  d.dataset.sidebar = current.sidebar || "expanded";
  d.dataset.motion = current.motion || "system";
  writeLocal(current);
}

export function prefersReducedMotion() {
  const m = current.motion || "system";
  if (m === "reduce") return true;
  if (m === "full") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

media.addEventListener("change", () => { if (current.theme === "system") applyPrefs({}); });
current = readLocal();
