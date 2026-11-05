// Résolution d'une page imprimée dans le sommaire d'un ouvrage : le slug
// vient d'un contenu EXTERNE, donc seuls `page/<chiffres>` passent et l'URL
// est reconstruite sur l'origine déjà validée.
import { describe, expect, test } from "bun:test";
import { manualPageFromHtml } from "../../server/infrastructure/manuals-scrape";

const BASE = "https://manuels.example.invalid/manuels/maths";
const state = {
  book: {
    summary: {
      elements: [
        { type: "Page", element: { page: 190, nbPages: 2, slug: "page/19001" } },
        { type: "Page", element: { page: 192, nbPages: 2, slug: "page/19201" } },
        { type: "Page", element: { page: 225, nbPages: 1, slug: "https://interne.example/secret" } },
      ],
    },
  },
};
const html = `<script id="id-initial-state">window.__PRELOADED_STATE__ = ${JSON.stringify(state)};</script>`;

describe("page de manuel dans le sommaire", () => {
  test("choisit la page qui contient le numéro demandé", async () => {
    expect(await manualPageFromHtml(html, 192, BASE)).toBe("https://manuels.example.invalid/page/19201");
    // Une page de deux pages couvre aussi la suivante.
    expect(await manualPageFromHtml(html, 193, BASE)).toBe("https://manuels.example.invalid/page/19201");
  });

  test("refuse un slug absolu (contenu externe non fiable)", async () => {
    expect(await manualPageFromHtml(html, 225, BASE)).toBeNull();
  });

  test("page absente ou sommaire illisible = pas de cible", async () => {
    expect(await manualPageFromHtml(html, 500, BASE)).toBeNull();
    expect(await manualPageFromHtml("<html></html>", 192, BASE)).toBeNull();
    expect(await manualPageFromHtml(html, 0, BASE)).toBeNull();
  });
});
