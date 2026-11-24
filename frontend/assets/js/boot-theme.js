/* Applies saved appearance before first paint (classic script: runs synchronously in <head>). */
(function () {
  try {
    var p = JSON.parse(localStorage.getItem("vx-prefs") || "{}");
    var d = document.documentElement;
    var theme = p.theme || "light"; // light unless the visitor explicitly chose otherwise
    if (theme === "system") theme = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    d.dataset.theme = theme;
    d.dataset.bsTheme = theme === "light" ? "light" : "dark";
    d.dataset.accent = p.accent || "viridian";
    d.dataset.text = p.text_size || "md";
    d.dataset.density = p.density || "comfortable";
    d.dataset.sidebar = p.sidebar || "expanded";
    d.dataset.motion = p.motion || "system";
  } catch (e) { /* storage unavailable: defaults apply */ }
})();
