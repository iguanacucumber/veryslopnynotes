# Notices de tiers

veryslopnynotes est distribué sous **GPL-3.0-only**. Le texte complet de la
licence de l'application est fourni dans
[`web/public/licenses/APP-GPL-3.0-ONLY.txt`](web/public/licenses/APP-GPL-3.0-ONLY.txt).

Ce fichier inventorie les dépendances tierces réellement résolues pour
l'application. Les versions viennent de `bun.lock` pour le web et de
`android/gradle/libs.versions.toml` pour Android ; les textes intégraux sont
dans `web/public/licenses/`, copiés dans `assets/web/licenses/` de l'APK.

| Composant | Version | Licence | Texte |
|---|---|---|---|
| veryslopnynotes | 0.1.0 | GPL-3.0-only | `APP-GPL-3.0-ONLY.txt` |
| pronotets | 1.0.0 | MIT | `PRONOTETS-MIT.txt` |
| react | 19.3.1 | MIT | `REACT-MIT.txt` |
| react-dom | 19.3.1 | MIT | `REACT-MIT.txt` |
| react-router-dom | 7.18.5 | MIT | `REACT-ROUTER-DOM-MIT.txt` |
| rolldown | 1.2.14 | MIT | `ROLLDOWN-MIT.txt` |
| androidx.core:core-ktx | 1.19.1 | Apache-2.0 | `APACHE-2.0.txt` |
| androidx.activity:activity-ktx | 1.13.0 | Apache-2.0 | `APACHE-2.0.txt` |
| androidx.exifinterface:exifinterface | 1.4.2 | Apache-2.0 | `APACHE-2.0.txt` |
| androidx.security:security-crypto | 1.1.0 | Apache-2.0 | `APACHE-2.0.txt` |
| androidx.work:work-runtime-ktx | 2.12.0 | Apache-2.0 | `APACHE-2.0.txt` |
| com.squareup.okhttp3:okhttp | 5.5.1 | Apache-2.0 | `APACHE-2.0.txt` |
| com.journeyapps:zxing-android-embedded | 4.3.0 | Apache-2.0 | `APACHE-2.0.txt` |
| SN Pro | — | OFL-1.1 | `SN-PRO-OFL.txt` |
| Papicons | 0.2.3 | MIT | `PAPICONS-MIT.txt` |

## Portée

- **pronotets** est l'implémentation TypeScript de référence du protocole
  Pronote ; le client Kotlin embarqué en est le port. Sa notice MIT est
  conservée avec le code source et les tests de parité.
- **rolldown** est le bundler utilisé par Vite au build ; les modules produits
  proviennent de son exécution, sa notice MIT accompagne donc le livrable.
- Les composants AndroidX transitifs (lifecycle, etc.) sont distribués sous
  Apache-2.0 et couverts par le même texte intégral.
- Les outils de build non embarqués dans l'APK (Vite, TypeScript, Playwright,
  lightningcss MPL-2.0) ne figurent pas dans cet inventaire.

## Textes

Les textes MIT proviennent du fichier `LICENSE` du paquet installé dans
`node_modules/`. Le texte Apache-2.0 est le texte canonique de la Apache
Software Foundation ; le texte GPL-3.0 est le texte canonique de la GNU Project
(version du 29 juin 2007). Aucun texte n'est modifié.

Le code source correspondant est publié sur
<https://github.com/iguanacucumber/veryslopnynotes>.
