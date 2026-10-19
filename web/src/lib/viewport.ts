// #399 : la zone de saisie suit le viewport RÉEL, pas une hauteur figée.
//
// Le clavier logiciel réduit la zone visible de la WebView (côté natif :
// l'inset IME est appliqué au conteneur, cf. `MainActivity.kt`). Une unité de
// viewport figée garde la hauteur d'origine dans une WebView : la mise en
// page plaçait donc le champ « Code PIN du QR » sous le clavier, et la barre
// d'onglets disparaissait avec.
//
// On lit donc la hauteur du viewport VISUEL (la seule qui rétrécit quand un
// élément recouvre la page), on la publie en variable CSS (`--app-height`),
// et les éléments FIXES du bas remontent de la hauteur du clavier
// (`--keyboard-bottom`).

export interface ViewportMetrics {
  /** Hauteur visible (px) : la zone où l'on peut lire. */
  height: number;
  /** Hauteur du clavier (px) : 0 quand il est fermé. */
  keyboard: number;
}

/**
 * Hauteur visible et hauteur du clavier.
 *
 * `innerHeight` = la fenêtre de mise en page. Le viewport VISUEL est plus
 * bas dès qu'un élément en surplomb (le clavier) recouvre la page : la
 * différence EST la hauteur du clavier.
 *
 * `visualHeight` à 0 = pas de viewport visuel (WebView ancienne) : on retombe
 * sur la fenêtre de mise en page.
 */
export function viewportMetrics(innerHeight: number, visualHeight: number, visualTop: number): ViewportMetrics {
  const visible = visualHeight > 0 ? visualHeight : innerHeight;
  return {
    height: Math.max(0, Math.round(visible)),
    keyboard: Math.max(0, Math.round(innerHeight - visible - visualTop)),
  };
}

/** Publie les mesures du viewport dans les variables CSS de la racine. */
export function applyViewport(root: HTMLElement, metrics: ViewportMetrics): void {
  root.style.setProperty("--app-height", `${metrics.height}px`);
  root.style.setProperty("--keyboard-bottom", `${metrics.keyboard}px`);
}

/**
 * Ramène le champ focalisé dans la zone visible.
 *
 * Le renderer fait défiler le champ AU FOCUS, donc avant l'ouverture du
 * clavier : quand la zone visible rétrécit, le champ se retrouve sous le
 * clavier. `nearest` : on ne le déplace que s'il est sorti du cadre.
 *
 * Pas de `instanceof HTMLElement` : le test suffit (`matches`) et la
 * fonction reste vérifiable sans DOM.
 */
export function keepFocusVisible(doc: Document): void {
  const active = doc.activeElement;
  if (!active) return;
  if (!active.matches("input, textarea, select")) return;
  active.scrollIntoView({ block: "nearest" });
}

/**
 * Suit le viewport : publie la hauteur utile, remonte les éléments fixes du
 * bas et ramène le champ focalisé quand la zone visible rétrécit.
 */
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
