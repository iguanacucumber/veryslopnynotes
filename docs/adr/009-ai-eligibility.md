# ADR-009 — éligibilité de l'assistant IA

- Statut : accepté (issue #829) pour la règle d'ingénierie ; validation
  juridique en attente.
- Complète [ADR-003](003-client-direct.md) pour l'appel direct à OpenRouter et
  l'invariant I36 pour le consentement versionné. Aucun ADR n'est remplacé.

## Contexte

L'assistant est facultatif et parle directement à OpenRouter avec la clé de
l'utilisateur, sans serveur du projet ([ADR-003](003-client-direct.md)). Le
code livré par #848, #849, #860 et #906 applique déjà une porte : consentement
explicite, attestation d'âge ou d'autorisation parentale, clé locale, refus
fermé. Aucun document ne disait pourtant quelle règle d'éligibilité ce code
sert, ni ce qui reste à trancher.

La question est juridique autant que technique. L'app s'adresse à des élèves,
donc probablement à des mineurs. OpenRouter exige d'avoir au moins 18 ans au
moment de la rédaction de ce texte. Une attestation déclarative ne prouve pas
l'âge et ne remplace ni les conditions d'OpenRouter, ni l'autorisation du
représentant légal. La copie et la mention d'âge sur un magasin ne peuvent pas
être déclarées approuvées par le projet seul.

L'issue #829 demande trois choses : une copie 18+ ou autorisation parentale
approuvée, une IA masquée tant que la clé et l'attestation manquent, et un
comportement de retrait défini. Cet ADR consigne la règle du code et la copie
réellement affichée ; il ne remplace pas la note de conseil.

## Décision

### 1. Trois conditions cumulatives

L'IA n'est disponible que si les trois conditions suivantes sont réunies :

1. un **consentement explicite et versionné** couvrant le texte, le périmètre
   des données et l'attestation ;
2. une **attestation d'âge ou d'autorisation parentale** enregistrée avec ce
   consentement ;
3. une **clé OpenRouter fournie par l'utilisateur**, chiffrée sur l'appareil.

Aucune condition ne remplace les autres. Une clé enregistrée ne vaut pas
consentement ; un consentement ne vaut pas attestation ; une attestation ne
vaut pas clé. Le projet ne fournit ni clé, ni compte, ni relais.

### 2. Consentement versionné

La version courante est `AI_CONSENT_VERSION = 4` dans
`android/core/AiConsent.kt` et son miroir web. Un changement **matériel**
incrémente cette version : catégorie de données ajoutée ou retirée,
destinataire ou règle de conservation modifiée, usage élargi, attestation
ajoutée ou modifiée. Une reformulation sans effet sur les données ne la change
pas.

Seul `granted` à la version courante ET attesté autorise un appel. Un accord
d'une autre version, sans attestation, un refus, un retrait ou un
enregistrement absent ou illisible n'autorise rien et n'est jamais réutilisé.
Un accord périmé déclenche un nouveau consentement : l'IA reste désactivée
jusqu'au nouveau geste.

### 3. Attestation enregistrée avec la décision

L'attestation n'est jamais déduite d'une clé, d'une case volatile ou d'un
réglage séparé. Elle est écrite avec la décision et relue avec elle ; absente
ou illisible, elle vaut `false`. La copie affichée est :

> Je certifie avoir 18 ans ou plus, ou, si je suis mineur, disposer de
> l’autorisation de mon représentant légal et d’un compte OpenRouter géré par
> un adulte.

Son détail affiché est :

> L’assistant passe par OpenRouter, qui exige d’avoir au moins 18 ans. Si tu es
> mineur, ton représentant légal doit autoriser cet usage et gérer le compte
> OpenRouter : l’app ne vérifie pas ton âge et ne remplace ni cette autorisation
> ni les conditions d’OpenRouter. Ce texte n’a pas encore fait l’objet d’une
> validation juridique.

Le refus natif associé est : « Coche l’attestation d’âge ou d’autorisation
parentale avant d’activer l’assistant. » Ces phrases sont la copie factuelle du
code ; elles ne sont pas une approbation juridique.

### 4. IA désactivée tant que la porte est fermée

Sans les trois conditions, l'IA est désactivée, pas seulement avertie :

- aucun appel au fournisseur et aucune lecture de clé ;
- aucune clé ne peut être enregistrée ;
- le champ de clé n'est pas exposé avant l'accord et l'attestation ;
- les chemins natifs refusent avec le code `consent` avant toute lecture de
  clé, tout contexte ou tout réseau ;
- un écran qui dépend de l'IA affiche son état désactivé et sa raison, sans
  proposer un essai qui contournerait la porte.

Un stockage indisponible, un enregistrement corrompu ou une version inconnue
échoue fermé : aucun accord, aucune IA.

### 5. Retrait

Refuser ou retirer le consentement laisse l'IA désactivée. Le retrait persiste
d'abord la décision `withdrawn`, puis efface la clé OpenRouter et le fil du
professeur IA ; un échec d'effacement est signalé, jamais masqué derrière un
succès. Les cours, les fiches de révision et le manuel enregistré restent sur
l'appareil.

Le consentement et l'attestation sont des réglages de l'appareil : ils
survivent à une déconnexion et sont effacés par « Supprimer toutes mes
données ». Une déconnexion efface déjà la clé et les données du compte.

### 6. Re-consentement

Tout changement matériel du texte, du périmètre ou de l'attestation incrémente
la version et redemande l'accord ET l'attestation. Aucun ancien accord n'est
réutilisé silencieusement. Une baisse de version, un retour arrière ou une clé
déjà présente ne réactivent jamais l'IA.

## Alternatives rejetées

- **Consentement seul, sans attestation** : ignore l'âge et les conditions
  d'OpenRouter. Rejeté.
- **Attestation seule, sans consentement versionné** : ne prouve pas ce qui a
  été accepté ni ce qui part. Rejeté.
- **Clé comme preuve d'éligibilité** : une clé peut être copiée ou empruntée ;
  elle ne dit rien de l'âge ni de l'autorisation. Rejeté.
- **Clé ou relais fournis par le projet** : contredit le local d'abord et les
  lois 1 et 2. Rejeté.
- **Défaut permissif ou accord implicite** : un enregistrement absent doit
  désactiver l'IA, pas l'activer. Rejeté.
- **Bloquer toute l'app aux mineurs** : l'usage non-IA reste possible avec
  l'accord du représentant légal et le cadre de l'établissement ; le blocage
  global n'est pas la règle du produit. Une restriction propre à l'IA reste à
  trancher par le conseil.

## Conséquences

- `android/core/AiConsent.kt`, `android/data/AiConsentStore.kt`,
  `android/app/VsnBridgeSettings.kt` et les écrans de réglages portent la
  porte ; `tests/unit/ai-consent-migration.test.ts`,
  `tests/unit/privacy-claims.test.ts` et `tests/web/ai-age-attestation.test.ts`
  la vérifient.
- Toute modification matérielle incrémente la version dans les deux sources et
  redemande l'accord ; un simple changement de mots n'incrémente rien.
- Si le conseil impose l'âge strict de 18 ans, la copie et la règle changent :
  nouvelle version de consentement, nouveau texte, tests mis à jour. Le code ne
  doit pas élargir l'accès au-delà de l'attestation disjonctive livrée avant
  cette décision écrite.
- Cet ADR ne vaut pas avis juridique et ne revendique aucune validation d'un
  conseil.

## Revue de conseil encore requise

Le point ouvert exact est l'arbitrage entre :

1. **18 ans stricts** pour toute utilisation de l'assistant, ce qui exclut
   l'autorisation parentale ; ou
2. le maintien de l'**attestation disjonctive** « 18 ans ou plus, ou
   autorisation du représentant légal avec un compte OpenRouter géré par un
   adulte ».

Le conseil doit aussi approuver la copie ci-dessus et la mention d'âge prévue
pour le magasin. Tant que cet arbitrage n'est pas écrit, le code garde la règle
livrée et la déclare en attente ; aucune issue ni cet ADR ne peut annoncer une
approbation juridique.
