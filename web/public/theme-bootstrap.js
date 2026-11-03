// Thème appliqué AVANT le premier rendu : dans AppContext, `data-theme` est
// posé par un effet React, donc après le montage — un thème sombre mémorisé
// démarrait sur un écran blanc. Fichier classique (pas un module) : il bloque
// la peinture, la palette est en place avant que le corps soit visible.
(function () {
  var theme = "SYSTEM";
  try {
    theme = localStorage.getItem("vsn:theme") || "SYSTEM";
  } catch (_) {
    theme = "SYSTEM";
  }
  var systemDark = false;
  try {
    systemDark = matchMedia("(prefers-color-scheme: dark)").matches;
  } catch (_) {
    systemDark = false;
  }
  var dark = theme === "DARK" || (theme !== "LIGHT" && systemDark);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  // `--page` vaut #ffffff en clair et #000000 en sombre (tokens.css) : la barre
  // système suit le même fond, sans éclair blanc au lancement.
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", dark ? "#000000" : "#ffffff");
})();
