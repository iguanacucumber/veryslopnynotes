# ADR-003 — client direct (Pronote = téléphone)

- Statut : accepté (issue #211). Actée ici, appliquée en deux temps : port Kotlin
  à parité prouvée (#200/#201/#203, harnais #202) puis branchement app (#205) et
  suppression du chemin serveur mort (issue dédiée).

## Contexte

Les règles fondatrices ont été écrites quand le serveur était le seul à parler
Pronote :
- `AGENTS.md` : « Réseau : Pronote = IP serveur uniquement, jamais téléphone. »
- INVARIANTS I1 : « `android/` ne contient aucune URL/référence hôte Pronote. »
- I2 : unique `PronoteHttpClient` côté serveur, seul accès réseau Pronote.

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
- **I2 remplacé** : un seul point d'accès réseau Pronote **par runtime** —
  `HttpSession`/`Client` côté `android/pronote/`, unique `PronoteHttpClient`
  côté serveur tant que le chemin legacy vit (scan inchangé jusqu'à la
  suppression du serveur mort).
- **I3/I5 étendus à `android/`** : `android/core/` suit la même pureté que
  `server/domain/` (port #203, harnais de parité) ; côté app aucun prompt LLM
  n'est assemblé — la clé vit dans le store chiffré et ne voyage qu'en corps
  `writeOnly` (I8).
- **Transition explicite** : le chemin serveur reste en place jusqu'à sa
  suppression (issue dédiée) ; le branchement app arrive en #205 (points
  d'entrée tolérés par I9 jusque-là). Aucun nouveau code ne passe par le
  serveur.

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
- **Plus de point de contrôle central** : filtrage (hôtes privés et loopback
  refusés), borne d'échecs, audit — tout ce que le serveur appliquait en un
  point doit être répliqué par appareil (validation d'hôte côté
  `android/pronote/`, purge session). Le garde anti-rebinding serveur ne couvre
  plus le téléphone : à fermer côté client au branchement (#205).
- **Session sur appareil perdu ou volé** : atténué par la purge existante
  (logout, changement d'hôte) et l'absence de persistance disque côté serveur
  (rien à moissonner côté backend) ; le chiffrement au repos côté app reste du
  ressort du store (voir I8).
- **Dérive de parité TS↔Kotlin** : atténuée par les harnais
  (`kotlin-pronote-parity`, `kotlin-pronote-client-parity`,
  `kotlin-domain-parity`) qui compilent et rejouent le vrai code ; toute
  divergence = défaut bloquant.

## Conséquences

- INVARIANTS I1/I2/I3/I5 réécrits ; `AGENTS.md` (règle réseau), `README.md`
  (démarrage sans serveur), `docs/HUMAN_INPUTS.md` (corpus, compte scraper)
  alignés.
- Scans inchangés (I1 repointé en #216, I2 serveur ≤ 1 définition, I3
  `server/domain/`, I5 `server/ai/`) : `make check` reste vert pendant la
  transition.
- Branchement #205 + suppression du serveur mort : issues dédiées, pas cette
  ADR.
