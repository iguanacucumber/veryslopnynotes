// Fuseau unique pour les tests du frontend : les écrans web affichent des dates
// locales et le producteur natif est en Europe/Paris. Sans ce verrou, un test
// passe à Paris et échoue à Kiritimati (ou l'inverse).
//
// Chaque fichier de `tests/web` appelle `useParisTz()` avant ses dates. Un
// preload global toucherait aussi les tests unitaires de parité (fenêtres en
// UTC) ; un simple import ne suffit pas car Bun partage le cache de modules
// entre fichiers. Le fuseau est restauré après le fichier car `process.env` est
// partagé : Bun ne relit pas `delete process.env.TZ`, on restaure un NOM.
import { afterAll } from "bun:test";

export function useParisTz(): void {
  const previous = process.env.TZ ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  process.env.TZ = "Europe/Paris";
  afterAll(() => {
    process.env.TZ = previous;
  });
}
