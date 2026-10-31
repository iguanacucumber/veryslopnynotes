// Une page web choisie par l'élève -> source citée « Web : titre ».
//
// MÊME moteur et MÊME garde que le scrape de manuel (`manuals-scrape.ts`) :
// schéma http(s), hôte privé/loopback/link-local/métadonnées refusés, nom
// résolu (rebinding DNS), redirections et URL finale vérifiées, taille bornée
// avant lecture, HTML borné dans le navigateur, délai de lecture.
//
// Différences VOLONTAIRES : aucun jar de session (`useSession: false`), pas de
// cookie de l'élève, userinfo refusé, contenu non textuel refusé.
//
// La réponse ne contient NI l'URL complète NI aucun cookie : seulement le
// titre et le texte. L'app marque le contenu Untrusted avant l'IA (I6).
import type { ScrapeManualsError } from "./manuals-scrape";
import { scrapePage } from "./manuals-scrape";
import type { ScrapeOptions } from "./manuals-scrape";

/** Miroir contrat de `WebScrapeDoc` (shared/contracts/api.ts). */
export interface WebDoc {
  readonly title: string;
  readonly excerpt: string;
}

/**
 * Lit une page web publique. `[]` = page sans texte lisible (aucune source
 * ajoutée côté app, jamais une page inventée). Un échec réseau/SSRF lève
 * `ScrapeManualsError` avec son motif typé.
 */
export async function scrapeWebPage(opts: ScrapeOptions): Promise<WebDoc[]> {
  const page = await scrapePage(
    {
      label: "Page web",
      useSession: false,
      textOnly: true,
      credentials: "none",
    },
    opts,
  );
  if (!page) return [];
  // Une page sans <title> (ou dont le titre EST son adresse) ne doit pas
  // transformer le libellé citable en URL : « Web : https://… » ferait entrer
  // l'adresse dans le prompt. Le repli est un libellé neutre, jamais l'URL.
  const title = page.title.includes("://") ? "Page web" : page.title;
  return [{ title, excerpt: page.text }];
}

/** Type du refus, ré-exporté pour les appelants qui n'importent pas le manuel. */
export type WebScrapeError = ScrapeManualsError;
