import { useCallback } from "react";
import { flushSync } from "react-dom";
import { useNavigate, type NavigateOptions, type To } from "react-router-dom";

/**
 * Transitions de route : routage déclaratif (`HashRouter`), donc l'option
 * `viewTransition` de react-router ne s'applique pas ; on branche l'API native.
 * Repli silencieux si l'API ou `prefers-reduced-motion` manque.
 */

export function animateNavigation(options: { reducedMotion: boolean; supported: boolean }): boolean {
  return options.supported && !options.reducedMotion;
}

function prefersReducedMotion(): boolean {
  return matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** `update` doit changer l'écran de façon synchrone : `flushSync` garantit que
 *  le DOM est à jour quand le navigateur prend l'instantané « après ». */
export function withViewTransition(update: () => void): void {
  const start = document.startViewTransition;
  const supported = typeof start === "function";
  if (!animateNavigation({ reducedMotion: prefersReducedMotion(), supported })) {
    update();
    return;
  }
  const transition = start.call(document, () => {
    flushSync(update);
  });
  // Une navigation plus rapide annule la précédente : ce n'est pas une erreur.
  void transition.finished.catch(() => undefined);
  void transition.updateCallbackDone.catch(() => undefined);
}

/** Le retour (`navigate(-1)`) reste une navigation simple : l'historique
 *  change après coup, la transition ne capturerait pas le nouvel écran. */
export function useViewNavigate(): (to: To | number, options?: NavigateOptions) => void {
  const navigate = useNavigate();
  return useCallback(
    (to: To | number, options?: NavigateOptions) => {
      if (typeof to === "number") {
        navigate(to);
        return;
      }
      withViewTransition(() => navigate(to, options));
    },
    [navigate],
  );
}
