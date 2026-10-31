// Routes visitées par `make web-smoke`. Module PUR (aucun import, aucun effet)
// lu par Playwright ET par le test d'architecture qui le compare aux `<Route>`
// de `App.tsx` : un écart fait échouer `make architecture`.
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
  // Alias de compatibilité : les anciens liens atterrissent sur un écran réel.
  ["fiches", "/fiches"],
  ["cahier", "/cahier"],
  ["pairing", "/pairing"],
];
