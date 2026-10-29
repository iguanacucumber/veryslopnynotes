// Liste des routes visitées par `make web-smoke`. Module PUR : aucun import,
// aucun effet de bord — il est lu par le script Playwright ET par le test
// d'architecture qui le compare aux `<Route>` de `App.tsx` (#622).
//
// Une route ajoutée ici sans l'être dans `App.tsx` (ou l'inverse) fait échouer
// `make architecture`.
export type SmokeRoute = readonly [name: string, path: string];

export const SMOKE_ROUTES: readonly SmokeRoute[] = [
  ["index", "/"],
  ["calendar", "/calendar"],
  ["grades", "/grades"],
  ["tasks", "/tasks"],
  ["profile", "/profile"],
  ["settings", "/settings"],
  ["messages", "/messages"],
  ["attendance", "/attendance"],
  ["sanctions", "/sanctions"],
  ["news", "/news"],
  ["canteen", "/canteen"],
  ["alerts", "/alerts"],
  ["revision-sheets", "/revision-sheets"],
  ["course-notes", "/course-notes"],
  ["prof", "/prof"],
  // Compatibility aliases: old links must still land on a real screen.
  ["fiches", "/fiches"],
  ["cahier", "/cahier"],
  ["pairing", "/pairing"],
];
