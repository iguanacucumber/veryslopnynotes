# Nom public et applicationId

Statut : **décision actée — revue de marque formelle requise avant release
publique**. Ce document consigne une vérification d'ingénierie ; il ne vaut pas
avis juridique et ne remplace pas une recherche d'antériorité professionnelle.

Date de constat : **2026-11-04**. Issue : #826.

## Décision

| Élément | Valeur retenue | Source |
|---|---|---|
| Nom public canonique | `veryslopnynotes` | [README](../../README.md), [package.json](../../package.json) |
| Libellé affiché sur Android | `VerySlopyNyNotes` | [AndroidManifest.xml](../../android/app/src/main/AndroidManifest.xml) |
| `applicationId` | `fr.veryslopnynotes.app` | [android/app/build.gradle.kts](../../android/app/build.gradle.kts) |
| Namespace Kotlin | `fr.veryslopnynotes.*` | modules `app`, `core`, `data`, `pronote` |
| Schéma de deep link debug | `veryslopnynotes://` | [AndroidManifest.xml debug](../../android/app/src/debug/AndroidManifest.xml) |

Le nom public reste **celui déjà livré par le dépôt**. Cette décision ne
renomme ni l'app, ni le paquet, ni les données. `VerySlopyNyNotes` est la forme
stylisée affichée ; `veryslopnynotes` reste la forme canonique pour les URL, les
paquets, les fichiers et la documentation.

L'`applicationId` conserve la convention inverse-DNS du projet. Le préfixe
`fr.` est un choix de nommage, pas la revendication d'un domaine ni d'une
entité juridique : aucun domaine `veryslopnynotes.*` n'est enregistré à la date
du constat.

## Pourquoi ce nom

- Il est déjà l'identité du dépôt public, du manifeste, du bundle web, des
  releases et du schéma de deep link : le changer créerait deux identités pour
  le même produit.
- Aucun conflit public concret n'a été trouvé lors des vérifications ci-dessous.
  Renommer sans bloqueur ajouterait un risque de rupture d'identité sans
  bénéfice démontré.
- L'`applicationId` est l'identité d'installation Android. Le changer crée une
  **nouvelle app** : elle ne met pas à jour l'ancienne, n'accède pas à ses
  données et ne reprend pas son éventuelle fiche de magasin. Même avant la
  première release, ce coût n'est justifié que par un conflit réel.
- Le libellé affiché est décorrélé du paquet : un changement futur de marque
  peut rester un changement de libellé et de fiche de magasin, sans toucher à
  l'`applicationId` déjà publié.

## Vérifications effectuées

Toutes les vérifications datent du **2026-11-04**.

| Contrôle | Résultat | Preuve |
|---|---|---|
| Identité Android compilée | `package="fr.veryslopnynotes.app"`, `android:label="VerySlopyNyNotes"` | manifeste fusionné debug généré par `:app:processDebugMainManifest` ; le FileProvider résout en `fr.veryslopnynotes.app.fileprovider` |
| Namespace GitHub | dépôt public `iguanacucumber/veryslopnynotes`, compte propriétaire `iguanacucumber` | API GitHub du dépôt |
| Compte ou organisation `veryslopnynotes` | libre : HTTP 404 pour l'utilisateur et l'organisation | API GitHub |
| Recherche de dépôts GitHub | un seul résultat : `iguanacucumber/veryslopnynotes` | recherche GitHub |
| Fiche Google Play | absente : HTTP 404 pour `id=fr.veryslopnynotes.app` | page Play Store |
| Fiche F-Droid | absente : HTTP 404 pour `fr.veryslopnynotes.app` | API F-Droid |
| Domaines `veryslopnynotes.com`, `.fr`, `.app`, `.dev`, `.net`, `.org`, `.eu` | aucun enregistrement DNS/A ; RDAP renvoie « not found » pour `.fr`, `.app`, `.dev` et `.org` | `dig` et RDAP |
| Recherche web du terme exact | aucune occurrence tierce exploitable trouvée | recherche web exacte, mots-clés `veryslopnynotes` et `VerySlopyNyNotes` |
| Registres de marques | **non interrogés automatiquement** : l'API USPTO exige une clé, les interfaces INPI/EUIPO demandent une session humaine | contrôle manuel à faire |

Aucun de ces contrôles ne prouve l'absence de droits antérieurs. Ils écartent
seulement un conflit public évident et documentent l'état du nom au jour de la
décision.

## Direction d'icône

L'infrastructure de #875 est conservée : icône adaptative, variante ronde,
calque monochrome, master 512 px et thème de splash. Le remplacement
d'identité de #843 a livré un **mark propre au projet** : une page de notes et
une coche, fond vert profond (`#1c6653`), page claire et accents verts. La
palette jaune sur teal de la première icône n'est plus l'identité livrée ; le
master reste
[`android/artwork/ic_launcher_512.png`](../../android/artwork/ic_launcher_512.png),
avec les ressources dans
[`res/drawable`](../../android/app/src/main/res/drawable) et
[`mipmap-anydpi-v26`](../../android/app/src/main/res/mipmap-anydpi-v26).

La direction retenue est celle d'un mark **sans mot de marque**, sans logo ni
capture de Papillon (ADR-008 §4), sans donnée scolaire. Le nom public et
l'`applicationId` ne dépendent pas du dessin. Une fiche de magasin devra
réutiliser le master 512 px, pas une capture d'écran.

## Clairance non résolue

- **Recherche de marque formelle** : aucune recherche professionnelle INPI,
  EUIPO, USPTO et WIPO n'a été menée pour les classes 9 (logiciel téléchargeable)
  et 42 (services logiciels), ni pour les classes éducatives éventuelles. C'est
  le contrôle humain qui reste avant bêta et avant toute release publique.
- **Dépôt de marque** : aucune demande n'est déposée par le projet. Le nom est
  utilisé comme marque de fait ; sa distinctivité et sa registrabilité ne sont
  pas évaluées.
- **Domaine** : aucun domaine n'est possédé. Si le projet ouvre un site public,
  il faudra enregistrer le domaine choisi avant de l'annoncer ; une absence DNS
  ne réserve rien.
- **Usage commun et magasins** : la recherche web ne couvre ni les usages non
  indexés, ni les réservations de nom dans les consoles de magasin. La fiche
  Play n'existe pas encore ; son nom devra être réservé avant la bêta.
- **Icône** : le dessin livré par #843 doit être confirmé comme création propre
  du projet avant la release publique. Aucun logo Papillon ne doit être
  présenté comme l'identité du produit.

Le contrôle exact qui reste : **recherche d'antériorité professionnelle,
classes 9 et 42, France / Union européenne / États-Unis, avant la première
release publique**, puis décision de déposer ou non la marque. Tant que ce
contrôle n'est pas fait, le nom est utilisable pour le développement et les
builds de test, pas comme clearance juridique de lancement.

## Inventaire de renommage

À n'utiliser que si un conflit concret impose un changement. Un renommage de
**libellé seul** ne touche pas l'`applicationId` ; un renommage de paquet
change l'identité d'installation et doit être décidé avant la première release
publique.

| Surface | Fichiers ou emplacements | Effet |
|---|---|---|
| Identité Gradle | [`android/app/build.gradle.kts`](../../android/app/build.gradle.kts), `android/{core,data,pronote}/build.gradle.kts`, [`android/settings.gradle.kts`](../../android/settings.gradle.kts) | `applicationId`, namespaces, `rootProject.name` |
| Sources Kotlin | `android/{app,core,data,pronote}/src/**/fr/veryslopnynotes/**`, imports et paquets des tests instrumentés | arborescence et paquets à déplacer, imports à réécrire |
| Manifeste | [`AndroidManifest.xml`](../../android/app/src/main/AndroidManifest.xml) et [`AndroidManifest.xml` debug](../../android/app/src/debug/AndroidManifest.xml) | `android:label`, thème `Theme.Veryslopynotes`, autorité `${applicationId}.fileprovider`, schéma du deep link |
| Ressources Android | [`values/colors.xml`](../../android/app/src/main/res/values/colors.xml), thèmes, splash, [`ic_launcher_512.png`](../../android/artwork/ic_launcher_512.png) | commentaires et noms de thème ; l'icône ne contient pas de texte, donc pas de redessin obligatoire |
| Interface web | [`web/index.html`](../../web/index.html), [`AppShell.tsx`](../../web/src/ui/AppShell.tsx), [`PairingScreen.tsx`](../../web/src/features/pairing/PairingScreen.tsx), [`HelpScreen.tsx`](../../web/src/features/help/HelpScreen.tsx) | titres d'onglet, textes d'aide et chemins « Réglages Android » |
| Textes natifs | [`WebViewSupport.kt`](../../android/app/src/main/java/fr/veryslopnynotes/app/WebViewSupport.kt), [`VsnBridge.kt`](../../android/app/src/main/java/fr/veryslopnynotes/app/VsnBridge.kt) | messages d'erreur et d'autorisation citant le nom |
| Build et release | [`package.json`](../../package.json), [`Makefile`](../../Makefile), [`docs/RELEASE.md`](../RELEASE.md) | nom du paquet, URL du dépôt, image serveur `veryslopnynotes-server`, deep link, liens de source |
| Dépôt et distribution | nom du dépôt GitHub, URL des releases, Obtainium, aperçu social, tags et archives source | les URL publiées changent ; GitHub peut rediriger un dépôt renommé, pas une `applicationId` |
| Magasin | console Google Play (absente aujourd'hui), nom de fiche, icône, captures, URL | l'`applicationId` d'une fiche publiée est immuable ; un changement impose une nouvelle fiche |
| Documentation | [`README.md`](../../README.md), [`DESIGN.md`](../../DESIGN.md), [`docs/REPOSITORY.md`](../REPOSITORY.md), [`docs/SUPPORT.md`](../SUPPORT.md), [`THIRD_PARTY_NOTICES.md`](../../THIRD_PARTY_NOTICES.md), [`CHANGELOG.md`](../../CHANGELOG.md) | nom public, aperçu social, support, notices ; les ADR historiques ne se réécrivent pas |
| Données et compatibilité | préférences, cache, exports, URI FileProvider, deep links, sauvegardes | changement d'`applicationId` = nouvelle app, données de l'ancienne inaccessibles ; prévenir avant toute migration |

Ce qui ne change pas avec un renommage : la clé de signature, le processus de
build, le texte de licence et l'obligation de publier la Source Correspondante.
Un changement de nom ne crée aucune exemption GPL.

## Références

- [ADR-008 — relicence GPL-3.0-only et distribution](../adr/008-relicense-gpl.md),
  notamment la posture Papillon et l'interdiction d'utiliser son logo.
- [Carte des données](DATA-MAP.md) et [scraper de manuels](manual-scraper.md)
  pour les autres points de revue juridique.
- [Release](../RELEASE.md) et [dépôt](../REPOSITORY.md) pour les liens publics
  et l'aperçu social à mettre à jour lors d'un renommage.
