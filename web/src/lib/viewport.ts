// La zone de saisie suit le viewport RÉEL, pas une hauteur figée : le clavier
// réduit la zone visible (inset IME côté natif) et une unité figée laisse le
// champ sous le clavier. On lit le viewport VISUEL, on publie `--app-height`
// et les éléments fixes du bas remontent de `--keyboard-bottom`.

export interface ViewportMetrics {
  /** Hauteur visible (px). */
  height: number;
  /** Hauteur du clavier (px) : 0 quand il est fermé. */
  keyboard: number;
}

/** `visualHeight` à 0 = pas de viewport visuel (WebView ancienne) : on retombe
 *  sur la fenêtre de mise en page ; la différence avec le visuel = clavier. */
export function viewportMetrics(innerHeight: number, visualHeight: number, visualTop: number): ViewportMetrics {
  const visible = visualHeight > 0 ? visualHeight : innerHeight;
  return {
    height: Math.max(0, Math.round(visible)),
    keyboard: Math.max(0, Math.round(innerHeight - visible - visualTop)),
  };
}

export function applyViewport(root: HTMLElement, metrics: ViewportMetrics): void {
  root.style.setProperty("--app-height", `${metrics.height}px`);
  root.style.setProperty("--keyboard-bottom", `${metrics.keyboard}px`);
}

/** Le renderer fait défiler le champ AU FOCUS, avant l'ouverture du clavier :
 *  `nearest` ne le déplace que s'il est sorti du cadre. Pas de `instanceof` :
 *  `matches` suffit et reste vérifiable sans DOM. */
export function keepFocusVisible(doc: Document): void {
  const active = doc.activeElement;
  if (!active) return;
  if (!active.matches("input, textarea, select")) return;
  active.scrollIntoView({ block: "nearest" });
}

export function watchViewport(win: Window, doc: Document): () => void {
  const root = doc.documentElement;
  const update = (): void => {
    const visual = win.visualViewport;
    const metrics = viewportMetrics(win.innerHeight, visual?.height ?? 0, visual?.offsetTop ?? 0);
    applyViewport(root, metrics);
    keepFocusVisible(doc);
  };
  win.addEventListener("resize", update);
  win.visualViewport?.addEventListener("resize", update);
  update();
  return () => {
    win.removeEventListener("resize", update);
    win.visualViewport?.removeEventListener("resize", update);
  };
}
