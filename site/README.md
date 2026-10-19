# site/ — hero animé (refonte from scratch)

Landing hero **vanilla, zéro dépendance** : `index.html` + `style.css` + `hero.js`.
Aucun appel réseau, aucune fonte distante, 100 % hors-ligne et données fictives.

> Choix d'emplacement : le hero vit dans un dossier `site/` dédié, séparé de
> l'application embarquée. `android/` et `server/` sont intouchés.

## Ouvrir

```sh
cd site && bunx serve . -l 8080
# ouvrir http://localhost:8080/index.html
```

`file://` marche aussi (aucun `fetch`, modules relatifs simples — servir en
HTTP reste recommandé pour les ES modules).

## Ce que fait la page

Une piste de scroll unique (`.track`, 420vh) pilote 4 écrans dans un mockup
téléphone CSS pur : notes (compte easeOutExpo 0 → 14,82 + courbe SVG +
chips), devoirs (case « fait » + ripple), EDT (grille + badge « prochain
cours »), sécurité (injection neutralisée). Autour : mesh gradient canvas +
grain généré, 6 cartes verre en parallaxe, titre révélé mot à mot, CTA
magnétiques à bordure animée.

## Régler le look

- CSS : bloc `:root` de `style.css` (couleurs, durées, easings).
- JS : objet `CONFIG` en tête de `hero.js` (moyenne, durées, staggers,
  `parallaxMax: 12`, `magneticMax: 8`, mot-clé shimmer).

## Budgets (pinnés par `tests/unit/site-hero.test.ts`)

JS < 25 Ko gzip, CSS < 15 Ko gzip, aucun secret/hôte réel, thèmes
clair/sombre intentionnels, `prefers-reduced-motion` → cadre final statique.
