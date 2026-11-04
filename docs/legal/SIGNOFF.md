# Dossier de validation juridique et vie privée

Statut du dossier : **ouvert — aucune signature de conseil enregistrée**.
Révision : **1** — date du constat : **2026-11-04**. Issue de suivi :
[#976](https://github.com/iguanacucumber/veryslopnynotes/issues/976).

> Ce dossier prépare une revue de conseil. Il ne vaut pas avis juridique et ne
> remplace ni [`PRIVACY.md`](../../PRIVACY.md), ni [`TERMS.md`](../../TERMS.md),
> ni la licence du code. Aucun nom de conseil, aucune entité, aucune adresse et
> aucune signature ne sont inventés : les blocs de signature restent vides tant
> qu'une décision écrite n'a pas été rendue et archivée.

## Comment lire ce dossier

Chaque sujet porte un statut :

- `pending` : aucune décision écrite de conseil n'est enregistrée. C'est l'état
  de toutes les sections à cette révision.
- `signed` : une décision écrite, datée et signée a été archivée selon la
  procédure ci-dessous. Le statut ne se déduit jamais d'un test, d'un ADR ou
  d'une relecture interne.

Un bloc de signature ne couvre que le périmètre et les questions de sa section.
Une réponse orale, un commentaire d'issue ou une validation d'ingénierie ne
remplacent pas une signature. Le projet ne peut pas s'auto-attribuer une
validation juridique.

| # | Sujet | Statut | Faits ouverts |
|---|---|---|---|
| 1 | GPL et relicence | `pending` | #827, #838 |
| 2 | Notice de confidentialité | `pending` | #831, #829, #906 |
| 3 | Assistant IA et mineurs | `pending` | #829 |
| 4 | Autorisation Pronote et établissement | `pending` | #831 |
| 5 | Marque et nom public | `pending` | #826 |
| 6 | Droit d'auteur des manuels et du scraper | `pending` | #976 |
| 7 | Sécurité et garde des clés | `pending` | #828 |

## 1. GPL et relicence

- Statut : `pending`
- Portée : distribution du dépôt et des binaires sous `GPL-3.0-only`, relicence
  depuis MIT, contributions, dérivés Papillon et offre de source correspondante.
- Dépend de : [#827](https://github.com/iguanacucumber/veryslopnynotes/issues/827)
  (voie de relicence), [#838](https://github.com/iguanacucumber/veryslopnynotes/issues/838)
  (inventaire des fichiers dérivés de Papillon).

**Ce que le dépôt permet de vérifier**

- [`LICENSE`](../../LICENSE) porte le texte GPL-3.0 et
  [`THIRD_PARTY_NOTICES.md`](../../THIRD_PARTY_NOTICES.md) déclare
  `GPL-3.0-only` pour l'application et crédite Papillon et les dépendances.
- [`ADR-008`](../adr/008-relicense-gpl.md) consigne la décision : relicence au
  commit `2def868`, contributions entrantes sous la même licence, sign-off DCO,
  pas de CLA, aucune release binaire avant le changement.
- [`docs/RELEASE.md`](../RELEASE.md) décrit la publication de la source
  correspondante, les textes de licence embarqués et la signature de l'APK.
- La preuve détaillée de la voie MIT → GPL et l'inventaire Papillon sont suivis
  dans #827 et #838 ; ils ne sont pas remplacés par ce dossier.

**Questions au conseil**

1. La relicence MIT → `GPL-3.0-only` couvre-t-elle tout l'historique et toutes
   les contributions, compte tenu de la clause MIT de sous-licence, de l'absence
   de CLA et des identités Git relevées dans l'historique puis suivies dans
   #827 ? Une autorisation de contributeur est-elle requise pour l'un d'eux ?
2. Les fichiers dérivés de Papillon sont-ils correctement identifiés et crédités
   par `THIRD_PARTY_NOTICES.md` et l'ADR-008 ? L'inventaire incomplet de #838
   interdit-il une distribution avant sa clôture ?
3. La distribution prévue (APK GitHub, puis éventuellement Google Play avec Play
   App Signing et AAB) respecte-t-elle la GPL-3.0, notamment les §4, §5 et §6 ?
   Faut-il une offre écrite supplémentaire ou une clause de source ?
4. L'offre de source correspondante de `docs/RELEASE.md` (lien vers le tag,
   archive, instructions de build, textes de licence) est-elle complète pour
   permettre la reconstruction et l'installation d'une version modifiée ?
5. Les notices de tiers et les textes embarqués couvrent-ils toutes les
   dépendances distribuées (AndroidX, OkHttp, zxing, React, pronotets, polices,
   icônes) sans omission ni mention trompeuse ?

**Preuves** : [`LICENSE`](../../LICENSE),
[`THIRD_PARTY_NOTICES.md`](../../THIRD_PARTY_NOTICES.md),
[`ADR-008`](../adr/008-relicense-gpl.md), [`docs/RELEASE.md`](../RELEASE.md),
#827, #838.

**Bloc de signature — à remplir uniquement après décision écrite**

- Nom et qualité du signataire : ____________________________________________
- Date : ____________________________________________________________________
- Signature : _______________________________________________________________
- Décision : ________________________________________________________________
- Réserves : _______________________________________________________________

## 2. Notice de confidentialité

- Statut : `pending`
- Portée : [`PRIVACY.md`](../../PRIVACY.md) version 1 (2026-11-04),
  [`docs/legal/DATA-MAP.md`](DATA-MAP.md), bases légales, destinataires,
  transferts, rétention, droits et AIPD.
- Dépend de : [#831](https://github.com/iguanacucumber/veryslopnynotes/issues/831)
  (responsable et contact), [#829](https://github.com/iguanacucumber/veryslopnynotes/issues/829)
  (mineurs), [#906](https://github.com/iguanacucumber/veryslopnynotes/issues/906)
  (durée de vie de la clé IA).

**Ce que le dépôt permet de vérifier**

- [`PRIVACY.md`](../../PRIVACY.md) décrit les données traitées, les finalités,
  les bases proposées, les destinataires, les transferts hors EEE, les durées,
  la suppression, la portabilité, les mineurs, les droits et la sécurité.
  Sa section 15 liste les points qu'une décision humaine doit trancher.
- [`docs/legal/DATA-MAP.md`](DATA-MAP.md) relie chaque catégorie à un chemin,
  une constante ou un test, et contient le crible AIPD.
- Le code est local d'abord : aucun serveur du projet ne reçoit les données
  scolaires ; les seuls flux sont l'établissement, OpenRouter, le scraper
  facultatif, GitHub et l'application de partage choisie.
- Aucune entité, adresse, adresse e-mail dédiée ni DPO n'est publiée : #831 est
  ouverte et le dépôt interdit d'inventer ces valeurs.

**Questions au conseil**

1. Qui est responsable du traitement pour l'application, le dépôt, les releases
   et le support ? Le mainteneur personne physique, une entité à créer, ou un
   partage avec l'établissement ? Quelles mentions d'identité, d'adresse, de
   contact vie privée et, le cas échéant, de représentant UE doivent figurer ?
   (#831)
2. Les bases légales proposées sont-elles valides pour chaque catégorie :
   session, données scolaires, absences et sanctions pouvant révéler la santé,
   photos, prompts IA, exports et données GitHub ? Faut-il distinguer la base
   du projet de celle de l'établissement ?
3. Les rôles d'OpenRouter, de GitHub, de l'établissement, du scraper et de
   l'application de partage sont-ils correctement qualifiés (responsable,
   responsable conjoint, sous-traitant) ? Quels DPA, clauses contractuelles
   types ou garanties de transfert doivent être vérifiés et cités ?
4. Les durées de conservation et l'exception des exports après déconnexion ou
   changement de compte sont-elles acceptables ? Faut-il purger les exports
   avec le compte ou les conserver avec une information spécifique ?
5. Une AIPD est-elle requise ? Qui la porte : le projet, l'établissement ou les
   deux ? Le crible de `DATA-MAP.md` suffit-il comme point de départ, et quelles
   conclusions doivent être datées et signées ?
6. Quel canal privé, quel registre des demandes et quel délai de réponse doivent
   être publiés pour les droits des personnes ? GitHub peut-il rester le seul
   canal, ou faut-il une adresse dédiée sans créer d'entité fictive ? (#831)
7. La notice contient-elle toutes les informations obligatoires (identité,
   finalités, bases, destinataires, transferts, rétention, droits, réclamation)
   et ses affirmations « aucun serveur du projet », « aucune télémétrie » et
   « aucune publicité » sont-elles exactes et suffisamment qualifiées ?
8. La version 1 et le mécanisme de versionnement de la notice suffisent-ils, ou
   faut-il un consentement séparé pour certaines catégories (photos, données de
   santé, IA) ?

**Preuves** : [`PRIVACY.md`](../../PRIVACY.md),
[`docs/legal/DATA-MAP.md`](DATA-MAP.md),
[`docs/THREAT-MODEL.md`](../THREAT-MODEL.md), #831, #829, #906.

**Bloc de signature — à remplir uniquement après décision écrite**

- Nom et qualité du signataire : ____________________________________________
- Date : ____________________________________________________________________
- Signature : _______________________________________________________________
- Décision : ________________________________________________________________
- Réserves : _______________________________________________________________

## 3. Assistant IA et mineurs

- Statut : `pending`
- Portée : éligibilité à l'assistant, attestation d'âge ou d'autorisation
  parentale, consentement versionné, retrait, photos et mention d'âge sur un
  magasin.
- Dépend de : [#829](https://github.com/iguanacucumber/veryslopnynotes/issues/829)
  (règle d'éligibilité ; décision d'ingénierie consignée, validation de conseil
  encore attendue).

**Ce que le dépôt permet de vérifier**

- [`ADR-009`](../adr/009-ai-eligibility.md) consigne la règle livrée :
  consentement explicite versionné, attestation enregistrée avec la décision,
  clé OpenRouter fournie par l'utilisateur, et IA désactivée si l'une des trois
  conditions manque.
- La copie exacte de l'attestation et de son détail est citée dans l'ADR-009 et
  dans [`PRIVACY.md`](../../PRIVACY.md) §8 et §11 ; [`TERMS.md`](../../TERMS.md)
  §5 reprend la règle.
- Le retrait persiste d'abord la décision, puis efface la clé et le fil du
  professeur ; l'échec est signalé. Les cours, fiches et manuel restent.
- OpenRouter exige 18 ans au moment de la rédaction ; l'app ne vérifie pas
  l'âge et ne remplace ni l'autorisation parentale ni les conditions du
  fournisseur. Aucune approbation de conseil n'est revendiquée.

**Questions au conseil**

1. Faut-il choisir l'**âge strict de 18 ans** pour tout usage de l'assistant, ou
   maintenir l'**attestation disjonctive** « 18 ans ou plus, ou autorisation du
   représentant légal avec un compte OpenRouter géré par un adulte » ?
2. La copie exacte de l'attestation, le détail affiché et le message de refus
   cités dans l'ADR-009 sont-ils juridiquement appropriés ? Faut-il les modifier
   avant la première release ?
3. Quelle mention d'âge et quelle classification doivent être utilisées sur un
   magasin (public adolescent, 18+, autre) ? La notice et la fiche magasin
   doivent-elles être alignées mot pour mot ?
4. L'attestation disjonctive est-elle compatible avec les conditions
   d'OpenRouter qui exigent 18 ans ? Si elle ne l'est pas, faut-il interdire
   l'IA aux mineurs ou modifier la copie et le parcours ?
5. Le consentement versionné et son retrait constituent-ils une preuve
   suffisante au regard du RGPD, notamment pour des données de mineurs, des
   photos pouvant contenir des visages ou des documents d'identité, et des
   données de santé révélées par un motif d'absence ?
6. L'usage non-IA par un mineur non accompagné doit-il rester possible ? Quelles
   informations du représentant légal et quelles vérifications minimales
   faut-il ajouter, sans créer une collecte d'âge non nécessaire ?

**Preuves** : [`ADR-009`](../adr/009-ai-eligibility.md),
[`PRIVACY.md`](../../PRIVACY.md) §8 et §11, [`TERMS.md`](../../TERMS.md) §5,
[`docs/legal/DATA-MAP.md`](DATA-MAP.md) section Mineurs, #829.

**Bloc de signature — à remplir uniquement après décision écrite**

- Nom et qualité du signataire : ____________________________________________
- Date : ____________________________________________________________________
- Signature : _______________________________________________________________
- Décision : ________________________________________________________________
- Réserves : _______________________________________________________________

## 4. Autorisation Pronote et établissement

- Statut : `pending`
- Portée : accès au compte scolaire avec QR + PIN, absence d'affiliation, rôle de
  l'établissement, conditions de Pronote et autorisation d'usage.
- Dépend de : [#831](https://github.com/iguanacucumber/veryslopnynotes/issues/831)
  pour l'identité et le rôle du responsable ; aucune autorisation écrite de
  Pronote, d'Index Éducation ou d'un établissement n'est présente dans le
  dépôt.

**Ce que le dépôt permet de vérifier**

- L'app est un client direct : l'utilisateur scanne le QR de son compte et
  saisit son PIN ; la session reste sur l'appareil et les requêtes vont à
  l'établissement ([`PRIVACY.md`](../../PRIVACY.md) §2 et §4,
  [`TERMS.md`](../../TERMS.md) §2, [`ADR-003`](../adr/003-client-direct.md)).
- Le projet n'est ni édité, ni approuvé, ni parrainé par Pronote, Index
  Éducation, OpenRouter ou un établissement ; la non-affiliation est répétée
  dans [`TERMS.md`](../../TERMS.md) §10 et
  [`THIRD_PARTY_NOTICES.md`](../../THIRD_PARTY_NOTICES.md).
- Aucun accord, licence de protocole ou autorisation d'établissement n'est
  archivé dans le dépôt. Le dépôt ne doit pas en revendiquer un.
- L'établissement est présenté comme responsable des données scolaires qu'il
  héberge ; le projet ne reçoit pas ces données.

**Questions au conseil**

1. L'accès au compte Pronote de l'utilisateur, avec le QR et le PIN fournis par
   l'établissement, exige-t-il une autorisation écrite d'Index Éducation, de
   Pronote ou de l'établissement ? Un client tiers non affilié peut-il utiliser
   le protocole sans accord ?
2. L'usage de l'app par un élève ou son représentant légal respecte-t-il les
   conditions d'utilisation de Pronote et le règlement de l'établissement ?
   Quelles mentions doivent figurer dans l'app et dans les conditions ?
3. Le projet doit-il conclure un accord de traitement avec les établissements,
   ou reste-t-il un simple éditeur d'outil local sans rôle de sous-traitant ?
   Qui répond d'une demande liée aux données scolaires ?
4. Une autorisation de l'établissement est-elle nécessaire avant une utilisation
   en classe, une recommandation aux élèves ou une mention dans un document
   scolaire ? Faut-il une attestation utilisateur supplémentaire ?
5. Que faire si un établissement interdit l'app ou si Pronote modifie ses
   conditions ? Faut-il un avertissement, un retrait de fonctionnalité ou une
   clause de fin d'usage ?
6. L'utilisation des noms « Pronote » et « Index Éducation » pour décrire la
   compatibilité est-elle licite à titre informatif ? La section 5 couvre la
   marque ; la présente section couvre l'autorisation d'accès et de protocole.

**Preuves** : [`PRIVACY.md`](../../PRIVACY.md) §2 et §4,
[`TERMS.md`](../../TERMS.md) §2 et §10,
[`docs/legal/DATA-MAP.md`](DATA-MAP.md) section Périmètre et rôles,
[`THIRD_PARTY_NOTICES.md`](../../THIRD_PARTY_NOTICES.md), #831.

**Bloc de signature — à remplir uniquement après décision écrite**

- Nom et qualité du signataire : ____________________________________________
- Date : ____________________________________________________________________
- Signature : _______________________________________________________________
- Décision : ________________________________________________________________
- Réserves : _______________________________________________________________

## 5. Marque et nom public

- Statut : `pending`
- Portée : nom `veryslopnynotes` / `VerySlopyNyNotes`, `applicationId`,
  revendications de marque, recherche d'antériorité, icône et usage des marques
  de tiers.
- Dépend de : [#826](https://github.com/iguanacucumber/veryslopnynotes/issues/826)
  (nom public et `applicationId`), aucune recherche professionnelle de marque
  n'étant encore menée.

**Ce que le dépôt permet de vérifier**

- [`docs/legal/NAME.md`](NAME.md) fixe le nom canonique, le libellé Android et
  l'`applicationId` `fr.veryslopnynotes.app`, et documente les vérifications
  publiques effectuées le 2026-11-04.
- Aucune recherche professionnelle d'antériorité n'est consignée pour les
  classes 9 et 42 ; aucun domaine `veryslopnynotes.*` n'est enregistré ; aucune
  fiche de magasin n'existe.
- L'icône et la marque de barre supérieure sont présentées comme propres au
  projet ; aucun logo ni capture de Papillon n'est livré (ADR-008 §4).
- [`TERMS.md`](../../TERMS.md) §10 et
  [`THIRD_PARTY_NOTICES.md`](../../THIRD_PARTY_NOTICES.md) nomment les marques
  de tiers et la non-affiliation.

**Questions au conseil**

1. Le nom `veryslopnynotes` / `VerySlopyNyNotes` est-il disponible et
   enregistrable pour les classes 9 et 42, en France, dans l'Union européenne et
   aux États-Unis ? Existe-t-il un risque d'antériorité ou de confusion ?
2. L'usage informatif de « Pronote » et « Index Éducation » dans le nom de
   l'app, la fiche magasin, le README et les captures est-il licite ? Quelles
   mentions de non-affiliation et quels usages faut-il éviter ?
3. L'icône, le nom et l'identité visuelle sont-ils des créations propres au
   projet, libres de droits de tiers ? Faut-il une cession ou une preuve
   d'auteur avant la distribution ?
4. Le préfixe `fr.` de l'`applicationId` est-il trompeur en l'absence d'entité
   ou de domaine français ? Faut-il le conserver, le changer avant la première
   release, ou accompagner le changement d'une note ?
5. Le projet doit-il déposer la marque et réserver un domaine avant la bêta ou
   la release publique ? À défaut, quelles mentions (™, « marque de fait »,
   absence de revendication) sont appropriées ?
6. La fiche magasin et la mention d'âge doivent-elles inclure des informations
   de marque ou de non-affiliation supplémentaires ?

**Preuves** : [`docs/legal/NAME.md`](NAME.md),
[`TERMS.md`](../../TERMS.md) §10,
[`THIRD_PARTY_NOTICES.md`](../../THIRD_PARTY_NOTICES.md),
[`ADR-008`](../adr/008-relicense-gpl.md) §4, #826.

**Bloc de signature — à remplir uniquement après décision écrite**

- Nom et qualité du signataire : ____________________________________________
- Date : ____________________________________________________________________
- Signature : _______________________________________________________________
- Décision : ________________________________________________________________
- Réserves : _______________________________________________________________

## 6. Droit d'auteur des manuels et du scraper

- Statut : `pending`
- Portée : extraction de pages de manuel, conservation locale d'extraits,
  envoi à l'IA, attribution, `robots.txt`, conditions des sites sources et
  responsabilité de l'opérateur du scraper.
- Dépend de : [#976](https://github.com/iguanacucumber/veryslopnynotes/issues/976) ;
  aucune autorisation d'éditeur n'est archivée dans le dépôt.

**Ce que le dépôt permet de vérifier**

- [`docs/legal/manual-scraper.md`](manual-scraper.md) décrit le comportement :
  URL saisie par l'utilisateur, aucune adresse par défaut, hôtes publics
  seulement, page de connexion refusée, **`robots.txt` non consulté
  aujourd'hui**, extrait cité comme « Manuel : <titre> », URL non citée et non
  envoyée au fournisseur LLM.
- La case d'attestation de l'app rappelle à l'utilisateur qu'il répond de son
  droit d'usage ; elle ne remplace ni une licence ni une autorisation.
- [`docs/legal/DATA-MAP.md`](DATA-MAP.md) borne les extraits (8 documents,
  32 matières, 8 000 caractères) et décrit le cookie jar local du scraper.
- [`PRIVACY.md`](../../PRIVACY.md) §4 et §11 décrivent ce qui part vers le
  scraper et vers OpenRouter ; le serveur ne reçoit jamais la session Pronote.

**Questions au conseil**

1. L'extraction et la conservation locale d'extraits de manuels, à la demande
   de l'utilisateur et pour son usage personnel, relèvent-elles de l'exception
   de citation, de la copie privée, d'un usage transitoire ou d'une
   autorisation de l'éditeur ? Quelles limites de longueur et de proportion
   faut-il respecter ?
2. L'envoi d'extraits à OpenRouter pour une réponse IA constitue-t-il une
   reproduction ou une communication au public soumise à autorisation ? Le
   projet, l'utilisateur ou le fournisseur en porte-t-il la responsabilité ?
3. Le scraper doit-il consulter `robots.txt`, s'identifier par un User-Agent
   dédié, refuser les pages payantes ou protégées, et respecter les conditions
   des sites sources ? Quelles modifications sont obligatoires avant une release
   publique ?
4. La case d'attestation utilisateur et l'absence d'adresse par défaut
   suffisent-elles à déplacer la responsabilité vers l'utilisateur, ou le
   projet reste-t-il responsable de l'outil ?
5. L'attribution « Manuel : <titre> » est-elle suffisante au regard du droit
   moral et des mentions demandées par les éditeurs ? Faut-il afficher auteur,
   éditeur, ISBN ou page ?
6. Quel régime s'applique si le scraper est hébergé par un tiers ou partagé
   entre plusieurs utilisateurs (logs, cookie jar, responsabilité de
   l'opérateur) ?

**Preuves** : [`docs/legal/manual-scraper.md`](manual-scraper.md),
[`docs/legal/DATA-MAP.md`](DATA-MAP.md),
[`PRIVACY.md`](../../PRIVACY.md) §4 et §11,
[`docs/PRODUCT.md`](../PRODUCT.md) section scraper, #976.

**Bloc de signature — à remplir uniquement après décision écrite**

- Nom et qualité du signataire : ____________________________________________
- Date : ____________________________________________________________________
- Signature : _______________________________________________________________
- Décision : ________________________________________________________________
- Réserves : _______________________________________________________________

## 7. Sécurité et garde des clés

- Statut : `pending`
- Portée : mesures techniques et organisationnelles, chiffrement local,
  sauvegarde, clé de signature release, environnements GitHub, compromission et
  notification.
- Dépend de : [#828](https://github.com/iguanacucumber/veryslopnynotes/issues/828)
  (garde de la clé de signature). [`docs/SIGNING.md`](../SIGNING.md) contient
  encore des placeholders tant que cette décision n'est pas prise.

**Ce que le dépôt permet de vérifier**

- [`PRIVACY.md`](../../PRIVACY.md) §13 et [`SECURITY.md`](../../SECURITY.md)
  décrivent le chiffrement Keystore de la session et de la clé LLM, l'absence de
  sauvegarde cloud (`allowBackup="false"`), TLS obligatoire, `FLAG_SECURE` et
  l'absence de secrets dans les logs.
- [`docs/THREAT-MODEL.md`](../THREAT-MODEL.md) couvre l'appareil partagé, la
  charge scolaire malveillante, la dépendance compromise, le scraper local et
  la clé perdue.
- [`docs/SIGNING.md`](../SIGNING.md) décrit la clé release hors dépôt, les
  secrets de l'environnement `release`, l'empreinte publiée, la rotation et la
  compromission ; la décision de custody elle-même reste suivie dans #828.
- [`docs/BRANCH-PROTECTION.md`](../BRANCH-PROTECTION.md) décrit le ruleset de
  `main`, l'environnement `release` et le relecteur obligatoire ; les scans de
  secrets et de dépendances sont dans la CI.

**Questions au conseil**

1. Les mesures techniques et organisationnelles décrites (Keystore pour la
   session et la clé LLM, données scolaires en clair dans le bac à sable
   Android, absence de sauvegarde, TLS, `FLAG_SECURE`) satisfont-elles
   l'article 32 du RGPD pour des données de mineurs ? Faut-il chiffrer
   davantage de données au repos ?
2. La garde de la clé de signature par un seul mainteneur, avec deux sauvegardes
   hors ligne et un gestionnaire de mots de passe, est-elle acceptable ? Quelles
   séparations de duties, preuves de sauvegarde ou assurances faut-il ajouter ?
   (#828)
3. La clé de signature et l'`applicationId` doivent-ils appartenir à une entité
   juridique plutôt qu'à un compte personnel ? Que se passe-t-il en cas de
   changement de mainteneur, d'incapacité ou de décès ?
4. Quelles obligations de notification en cas de compromission de la session
   Pronote, de la clé OpenRouter, de la clé de signature ou d'une release
   publiée ? Qui notifie l'établissement, les utilisateurs et l'autorité de
   contrôle, et dans quel délai ?
5. Le canal de signalement (GitHub Security Advisories uniquement, sans courriel
   ni PGP) et les délais de `SECURITY.md` sont-ils suffisants ? Faut-il publier
   un contact de sécurité ou une politique de divulgation plus formelle ?
6. Les affirmations « aucune télémétrie », « aucun serveur du projet » et
   « aucune donnée scolaire envoyée au projet » sont-elles exactes pour tous les
   builds, y compris debug, beta et release ? Une erreur de qualification
   expose-t-elle le projet à un risque contractuel ou réglementaire ?

**Preuves** : [`PRIVACY.md`](../../PRIVACY.md) §13,
[`SECURITY.md`](../../SECURITY.md), [`docs/THREAT-MODEL.md`](../THREAT-MODEL.md),
[`docs/SIGNING.md`](../SIGNING.md), [`docs/BRANCH-PROTECTION.md`](../BRANCH-PROTECTION.md),
#828.

**Bloc de signature — à remplir uniquement après décision écrite**

- Nom et qualité du signataire : ____________________________________________
- Date : ____________________________________________________________________
- Signature : _______________________________________________________________
- Décision : ________________________________________________________________
- Réserves : _______________________________________________________________

## Archive de la copie signée

La signature juridique n'est pas la signature APK décrite dans
[`docs/SIGNING.md`](../SIGNING.md) : ce sont deux procédures distinctes. Une
décision de conseil n'est `signed` que si les règles suivantes sont respectées.

1. **Original.** La copie signée (PDF ou document écrit équivalent) est déposée
   dans l'archive privée du mainteneur `iguanacucumber`, hors du dépôt public,
   sur un support chiffré. L'emplacement exact est choisi par le mainteneur et
   n'est pas publié ; il ne doit contenir ni secret, ni donnée scolaire.
2. **Accès.** Le mainteneur, le signataire et toute personne mandatée pour un
   audit de release peuvent lire l'original avec l'accord du mainteneur. Le
   public ne reçoit qu'un extrait rédigé : date, périmètre, statut, empreinte
   SHA-256 de l'original et identité du signataire seulement si celui-ci
   consent à sa publication.
3. **Traçabilité.** Après dépôt, la ligne du journal ci-dessous reçoit la date,
   l'identité du signataire, le périmètre signé et l'empreinte SHA-256 de
   l'original. Aucune signature, aucun nom et aucune date ne sont écrits avant
   le dépôt réel.
4. **Publication.** La présente page passe au statut `signed` pour la section
   concernée. Une signature partielle ne signe que sa section ; les autres
   restent `pending`. Une décision qui contredit un document du dépôt impose de
   corriger ce document dans la même PR ou une PR liée.
5. **Release.** Les notes de release et la checklist de publication citent
   `docs/legal/SIGNOFF.md` et la révision archivée. Une release publique ou une
   bêta ne peut pas annoncer une validation juridique si les sept sections ne
   sont pas `signed` ; toute dérogation suit [#972](https://github.com/iguanacucumber/veryslopnynotes/issues/972)
   et est nommée comme dérogation, jamais comme une signature.
6. **Correction ou retrait.** Une signature peut être retirée si son périmètre
   change matériellement. Le journal conserve la trace du retrait, la date et
   la raison ; une nouvelle signature est exigée pour le nouveau périmètre.

## Journal des signatures

| Section | Statut | Date | Signataire | Archive SHA-256 |
|---|---|---|---|---|
| GPL et relicence | `pending` | — | — | — |
| Notice de confidentialité | `pending` | — | — | — |
| Assistant IA et mineurs | `pending` | — | — | — |
| Autorisation Pronote et établissement | `pending` | — | — | — |
| Marque et nom public | `pending` | — | — | — |
| Droit d'auteur des manuels et du scraper | `pending` | — | — | — |
| Sécurité et garde des clés | `pending` | — | — | — |

## Vérification

- `bun test tests/architecture/legal-signoff.test.ts` : sections, statuts
  `pending`, blocs de signature vides et liens.
- Les liens relatifs de ce fichier sont vérifiés par
  `tests/architecture/docs.test.ts`.
- Aucun test ne peut prouver une signature : seule la copie archivée et le
  journal rempli le peuvent.
