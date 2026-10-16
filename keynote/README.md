# keynote/ — vidéo de présentation (web tech)

Deck **vanilla single-file** (`index.html`, zéro dépendance) + export mp4 via
Playwright (devDep épinglé `playwright@1.64.1`, Apache-2.0, `bun audit` clean) +
ffmpeg système. Contenu FR, ~3 min 30, 16:9, dark premium + accent vert.

## Présenter (navigateur)

```sh
# servir le dossier (file:// marche aussi, sans fetch tout est inline)
bunx serve keynote -l 8080
# ouvrir http://localhost:8080/index.html
```

- `?autoplay=0` : navigation manuelle (←/→, espace, boutons)
- `?t=75` : démarrer à 75 s
- `?export=1` : mode capture (curseur/boutons masqués, audio WebAudio coupé —
  la nappe est muxée par ffmpeg à l'export)
- 🔊 : nappe épique générée en WebAudio natif (aucun mp3)

## Exporter (mp4 1080p60)

```sh
bun keynote/export.mjs --shots    # PNG par scène : contrôle rapide
bun keynote/export.mjs --preview  # mp4 12 s : test fumée
bun keynote/export.mjs            # keynote/dist/keynote-1080p60.mp4 (210 s)
```

La piste audio est **100 % synthétisée par ffmpeg** (sines + tremolo + montée
de filtre + échos) : aucun asset tiers. La vidéo Playwright (~25 fps natifs)
est conteneurisée à 60 fps (`-r 60`, standard conteneur, pas de fausse
interpolation annoncée).

## Scènes (210 s, source unique : `data-dur` dans `index.html`)

| # | Titre | Durée |
|---|-------|-------|
| 1 | Couverture « VerySloppy Notes » | 20 s |
| 2 | Le problème (session qui voyage) | 25 s |
| 3 | Solution ADR-003 + schéma archi | 30 s |
| 4 | Client : devoirs+IA, notes, EDT | 50 s |
| 5 | IA : sources ou refus + clé directe | 40 s |
| 6 | Invariants I1–I8, tests bloquants | 30 s |
| 7 | Outro : hors-ligne + liens docs | 15 s |

Téléphones = **mockups CSS purs** (aucune capture réelle, aucune donnée
perso). Le test `tests/unit/keynote-deck.test.ts` pine durées, langue et
absence de secrets/hôtes réels.
