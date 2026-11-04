# ADR-008 — relicence GPL-3.0-only et distribution

- Statut : accepté (issue #837)
- Contexte : #827 (choix de la licence), #835 (texte `LICENSE`), #838
  (inventaire Papillon), #839 (notices tierces), #841 (offre de source).
- Complète [ADR-001](001-stack.md) pour la compatibilité des dépendances et
  [ADR-005](005-rules-and-architecture.md) pour la règle de dépôt. Aucun ADR
  n'est remplacé.

## Contexte

Le dépôt est sous MIT, un texte qui ne couvre plus la situation réelle : le
code Kotlin reprend des règles de Papillon (moyennes, absences, notes) et
l'interface s'inspire de son design, alors que Papillon est distribué sous
GPL-3.0. Un dérivé de code GPL-3.0 ne peut pas rester MIT, même si les
fichiers concernés ne sont pas encore tous inventoriés (#838). La seule
alternative serait une réécriture clean-room, plus coûteuse et sans garantie.

Les dépendances applicatives sont compatibles GPL-3.0-only : MIT (React,
pronotets), Apache-2.0 (AndroidX, OkHttp, zxing) et BSD-3-Clause
(tough-cookie). Apache-2.0 est incompatible avec GPL-2.0 mais compatible
avec GPL-3.0 : c'est la version qui permet d'embarquer l'écosystème Android
sans exception. `pronotets` (MIT) reste la référence de parité ; sa notice et
son crédit sont conservés.

Aucune version binaire n'a été publiée : pas de tag ni de GitHub Release au
2026-11-04. La fenêtre de relicence est donc encore ouverte pour l'ensemble de
l'historique. Une copie binaire qui aurait circulé hors dépôt resterait régie
par les termes MIT reçus avec elle ; la relicence ne révoque pas ces droits.

Au moment de cette décision, les notices tierces déclarent déjà GPL-3.0-only
(#839) alors que `LICENSE` racine est encore MIT. Cet écart est transitoire et
se ferme avec #835 et #836.
Une décision écrite précède la première release publique : la distribution
déclenche les obligations de source et d'attribution.

## Décision

### 1. Licence du dépôt : GPL-3.0-only

Le code, ses contributions et les œuvres dérivées sont distribués sous
**GPL-3.0-only**, identifiant SPDX `GPL-3.0-only`. `LICENSE` porte le
texte canonique de la GNU GPL version 3, sans ajout, sans exception et sans
clause « ou toute version ultérieure » : « only » évite d'accorder par avance
un choix que le projet n'a pas testé. La ligne de copyright reste
« Copyright (c) 2026 veryslopnynotes contributors ».

Aucune restriction supplémentaire n'est ajoutée ; notices, textes de licence
et mention « aucune garantie » sont livrés avec chaque artefact.

### 2. Contributions et attribution

Contribution entrante sous la même licence que la sortie
(inbound = outbound). Le sign-off DCO atteste que l'auteur peut publier sa
contribution sous GPL-3.0-only ; il n'y a ni CLA ni cession de copyright. Les
auteurs gardent leur copyright ; leur nom reste dans l'historique Git, la
ligne collective couvre l'ensemble.

Chaque version modifiée distribuée porte une notice de modification datée
(GPL-3.0 §5a). Les ayants droit de Papillon et des dépendances tierces sont
crédités dans [`THIRD_PARTY_NOTICES.md`](../../THIRD_PARTY_NOTICES.md) et dans
l'écran À propos (#840). Le crédit de `pronotets` reste dans le README et la
documentation de compatibilité.

### 3. Distribution APK, AAB et magasins

Chaque binaire distribué (APK de sideload, AAB Google Play, split APK produit
par le store) est du code objet GPL-3.0-only. La distribution doit donc
accompagner le binaire de la **Source Correspondante** de la version exacte :

- lien vers le tag et l'archive source de la version publiée, accessible sans
  frais, avec des instructions claires depuis la page de release (§6d) ;
- procédure de build documentée : JDK, SDK Android, Bun, Gradle, génération
  de l'interface web ;
- textes de licence et notices embarqués dans l'app ;
- si une offre écrite est utilisée à la place du lien, elle reste valable trois
  ans et couvre toute personne ayant reçu le binaire.

Google Play accepte une application GPL si ses conditions n'ajoutent pas de
restriction incompatible. L'AAB et les splits ne changent pas l'obligation :
la source publiée doit permettre de reconstruire l'application telle
qu'installée. Play App Signing et la signature d'upload sont des contraintes
de canal, pas une protection contre la reconstruction.

L'utilisateur doit pouvoir reconstruire et installer une version modifiée :
notice de build, SDK et signature sont publiés (installation information,
§6). Un canal qui interdit une version modifiée ou ajoute une restriction
incompatible est écarté. L'App Store iOS n'est pas un canal du projet : ses
conditions ajoutent des restrictions que la GPL-3.0 interdit ; une
distribution iOS exigerait une nouvelle décision juridique.

### 4. Posture Papillon

Papillon est un projet GPL-3.0. Les fichiers portés ou adaptés depuis Papillon
restent sous GPL-3.0, avec le copyright et l'attribution d'origine ; ils ne
sont ni blanchis ni présentés comme clean-room. `docs/legal/PROVENANCE.md`
(#838) inventorie les fichiers, la version ou le commit source et la logique
portée. Tant qu'il est incomplet, un fichier ressemblant à un portage est
traité comme dérivé et crédité.

La communication du projet ne se présente pas comme « une copie de Papillon »
(#843) : le crédit GPL reste, la revendication visuelle et la marque
disparaissent. Aucun logo ni capture de Papillon n'est utilisé sans
autorisation.

### 5. Statut MIT antérieur

Aucune version binaire publique n'a été publiée sous MIT. Si une telle version
apparaissait (tag, release, APK distribué), elle resterait sous MIT pour ses
destinataires : la relicence ne s'applique pas aux copies déjà livrées. Une
note de release le rappellerait au lieu de prétendre que le MIT a disparu.

Le dépôt lui-même est couvert par la GPL-3.0-only à partir de cet ADR ; les
commits antérieurs restent dans l'historique et leur combinaison avec le reste
est distribuée sous GPL.

### 6. Règle de dépôt (AGENTS.md)

[`AGENTS.md`](../../AGENTS.md) porte la règle courte : code et contributions
sous GPL-3.0-only, dépendance nouvelle compatible GPL-3.0-only, pas de CLA.
La compatibilité des licences est vérifiée en CI (#842) ; une dépendance
incompatible est refusée, pas ajoutée avec une exception non écrite.

## Alternatives rejetées

- **Rester MIT** : incompatible avec le code dérivé de Papillon ; il faudrait
  réécrire les fichiers en clean-room et prouver l'absence de dérivation, ce
  que #838 ne permet pas aujourd'hui.
- **GPL-2.0-or-later** : Apache-2.0 (AndroidX, OkHttp, zxing) est incompatible
  avec GPL-2.0. Rejeté.
- **GPL-3.0-or-later** : accorde par avance une version future non testée,
  sans bénéfice pour les utilisateurs actuels. Rejeté.
- **AGPL-3.0** : la clause réseau ne vise pas une app locale et décourage des
  distributeurs sans contrepartie. Rejeté.
- **Apache-2.0** : compatible avec les dépendances, pas avec le code Papillon
  GPL-3.0. Rejeté.
- **Double licence ou propriétaire** : aucun CLA ne permet de relicencier les
  contributions existantes, et aucun revenu n'est planifié. Rejeté.
- **Attendre la première release** : un binaire MIT publié créerait des droits
  MIT permanents sur cette version. Rejeté.

## Conséquences

- `LICENSE` est remplacé par le texte GPL-3.0 canonique (#835) ; `package.json`
  et le README déclarent `GPL-3.0-only` (#836).
- `CONTRIBUTING.md` et `AGENTS.md` doivent dire la même règle : contribution
  sous GPL-3.0-only, sign-off DCO, pas de CLA.
- `THIRD_PARTY_NOTICES.md` et `web/public/licenses/` restent la source des
  textes ; l'app les embarque et l'écran À propos les expose (#840).
- Chaque release porte le lien vers la source exacte (#841) ; le gate et la CI
  vérifient les licences des dépendances (#842).
- `docs/RELEASE.md` cesse de présenter la licence applicative comme MIT et
  décrit la source correspondante.
- Les fichiers dérivés de Papillon sont inventoriés et crédités (#838) ; la
  communication ne revendique plus une copie (#843).
- Cet ADR est une décision d'ingénierie fondée sur les textes publics des
  licences ; il ne vaut pas avis juridique et ne revendique aucune validation
  d'un conseil. La revue juridique avant release publique reste requise, comme
  pour le scraper de manuels.

## Risques

- **Provenance incomplète** : un fichier peut être plus dérivé que son crédit
  actuel. L'inventaire #838 le corrige ; en cas de doute, réécrire plutôt que
  blanchir.
- **Conditions de magasin** : un canal peut ajouter des restrictions
  incompatibles (DRM, signature verrouillée, interdiction de versions
  modifiées). La source offerte ne rachète pas un contrat contraire à la GPL ;
  le canal est alors écarté.
- **Version MIT oubliée** : si un binaire a circulé, ses droits MIT subsistent.
  La note de release le documente au lieu de le nier.
- **Dérive de dépendance** : une licence incompatible peut entrer sans revue.
  Le contrôle CI #842 et la règle AGENTS.md sont la garde.
