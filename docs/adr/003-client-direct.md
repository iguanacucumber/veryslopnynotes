# ADR-003 — client direct (Pronote = téléphone)

- Statut : accepté (issue #211). Actée ici, appliquée en deux temps : port Kotlin
  à parité prouvée (#200/#201/#203, harnais #202) puis branchement app (#205) et
  suppression du chemin serveur mort (issue dédiée).

## Contexte

Les règles fondatrices ont été écrites quand le serveur était le seul à parler
Pronote :
- `AGENTS.md` : « Réseau : Pronote = IP serveur uniquement, jamais téléphone. »
- INVARIANTS I1 : « `android/` ne contient aucune URL/référence hôte Pronote. »
- I2 : client HTTP Pronote unique côté serveur (ancienne architecture, retirée après #199).

Le port Kotlin change la donne : `android/pronote/` (zéro dépendance, transport
plateforme) rejoue le protocole à parité compilée et rejouée (crypto #200,
client + resolver #201, domaine #203), et la session n'a plus aucune raison de
quitter le téléphone. Garder le serveur comme intermédiaire serait garder un
composant à compromettre pour acheminer des secrets qui n'ont pas à voyager.

## Décision

- **Pronote = téléphone.** Seul `android/pronote/` parle Pronote en direct (I1
  repointé, scans #216). Aucun serveur intermédiaire ne voit la session : le QR
  et son PIN sont saisis dans l'app, la session vit et meurt dans le téléphone
  (purge au logout / changement d'hôte, inchangée).
- **I2 remplacé** : aucun accès Pronote depuis le serveur ; l'app a un seul
  `HttpSession`/`Client` dans `android/pronote/`.
- **I3/I5 étendus à `android/`** : `android/core/` reste sans réseau ni stockage ;
  l'app assemble et valide les prompts localement.
  La clé reste chiffrée sur l'appareil et part directement à OpenRouter dans
  `Authorization` (I8).
- **Transition terminée** : depuis #205, aucun code Pronote ne passe par le
  serveur. L'outil de capture TypeScript a été retiré à la clôture de #199.

## Alternatives rejetées

- **Serveur seul (statu quo)** : rejeté — un serveur à compromettre, une
  session exfiltrée hors du téléphone, et l'épinglage réseau (hôte fixe ou
  ré-auth) imposé à tous. Le port prouve que l'intermédiaire n'apporte rien
  aux lectures.
- **Double-parleur permanent (serveur + téléphone)** : rejeté — deux sessions,
  deux points de contrôle, dérive de parité TS↔Kotlin sans responsable unique.
- **WebView distante** : rejeté — contredit le proxy médias (jamais de contenu
  distant brut) et rouvre l'instruction par contenu externe (I6).

## Risques assumés

- **Réseau du téléphone exposé à l'établissement** : avant, l'établissement ne
  voyait que le réseau du serveur ; désormais chaque client présente le sien.
  Pas d'anonymisation par intermédiaire, et un réseau scolaire filtrant peut
  bloquer un client là où il laissait passer un serveur.
- **Plus de point de contrôle central** : la validation côté serveur ne couvre
  plus le téléphone. Le client valide l'adresse saisie et la session est purgée
  au logout ou au changement d'établissement.
- **Session sur appareil perdu ou volé** : atténué par la purge existante
  (logout, changement d'hôte) et l'absence de persistance disque côté serveur
  (rien à moissonner côté backend) ; le chiffrement au repos côté app reste du
  ressort du store (voir I8).
- **Dérive de parité TS↔Kotlin** : atténuée par les harnais
  `kotlin-pronote-parity`, `kotlin-pronote-client-parity` et le replay du corpus
  local, qui compilent/rejouent le code Android ; toute divergence = défaut bloquant.

## Conséquences

- INVARIANTS I1/I2/I3/I5 réécrits ; `AGENTS.md`, `README.md` et
  `docs/HUMAN_INPUTS.md` alignés.
- Scans et invariants sont alignés sur l'accès direct : `make check` vérifie le
  client Android et les contraintes du scraper restant.
