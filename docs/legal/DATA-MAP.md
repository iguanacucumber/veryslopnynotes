# Carte des données, rétention, destinataires et droits

Statut : **brouillon de travail — revue juridique requise avant toute release
publique**. Ce document décrit ce que le code fait à la date indiquée. Il ne
vaut pas avis juridique, ne nomme aucune entité juridique non vérifiée et ne
remplace ni une politique de confidentialité ni une analyse de conseil. Les
points qui dépendent d'un fait humain ou d'une qualification juridique sont
listés en [questions ouvertes](#questions-ouvertes-à-trancher-avec-le-conseil).

Date de constat : **2026-11-04**. Source de vérité : constantes et chemins du
code cités dans chaque ligne, plus les invariants I16 et I33
([données](../architecture/invariants/donnees.md), [IA](../architecture/invariants/ia.md),
[modèle de menace](../THREAT-MODEL.md)).

## Périmètre et rôles

L'application est un client **local d'abord** : elle ne dispose d'aucun compte
chez le projet et n'envoie aucune donnée scolaire à un serveur du projet. Les
seuls flux réseau sont l'établissement (Pronote), le fournisseur LLM choisi par
l'utilisateur (OpenRouter), le scraper facultatif auto-hébergé et GitHub pour
la distribution et le support ([README](../../README.md),
[PRODUCT](../PRODUCT.md), [ADR-003](../adr/003-client-direct.md)).
Le build de développement peut en plus utiliser l'établissement public de démo ;
la release refuse ce mode (`docs/PRODUCT.md`, `docs/RELEASE.md`).

| Acteur | Rôle proposé | Ce qu'il voit | À confirmer |
|---|---|---|---|
| Élève / représentant légal | Personne concernée ; choisit d'utiliser l'app, l'IA et le scraper | Toutes les données sur l'appareil | — |
| Établissement / Pronote | Responsable du traitement des données scolaires qu'il héberge ; source des payloads | Identifiants de session et requêtes Pronote | Qualification exacte, base légale et politique de rétention de l'établissement |
| Mainteneurs du projet | **Pas d'accès aux données scolaires**. Responsables du traitement pour le dépôt, les releases et le support GitHub | Données GitHub (compte, issues, PR, téléchargements) ; aucune donnée de l'app | Entité juridique, base légale du support, délai de conservation, DPA GitHub |
| OpenRouter | Fournisseur d'API choisi par l'utilisateur ; destinataire des prompts et des images | Contenu du prompt, images, clé API, métadonnées de requête | Responsable indépendant ou sous-traitant de l'utilisateur ; conditions et transferts |
| GitHub | Hébergeur du code, des releases et du support | Compte GitHub, contenu des issues/PR, logs de téléchargement | Rôle exact (hébergeur/sous-traitant), DPA et transferts |
| Opérateur du scraper | Utilisateur qui héberge le service facultatif | URL demandée, pages publiques récupérées, cookie jar de son instance | Rôle si l'instance est partagée ou exploitée par un tiers |

Conséquence pratique : une demande qui porte sur des notes, absences, messages,
devoirs, photos ou une session Pronote ne peut pas être satisfaite par les
mainteneurs, qui n'en ont pas la copie. Le runbook ci-dessous renvoie donc
d'abord vers l'appareil, l'établissement ou le fournisseur concerné. Cette
absence de copie centrale ne couvre pas un utilisateur qui publierait
volontairement une donnée scolaire dans une issue GitHub : ce contenu-là est
traité par GitHub et doit être retiré sur demande.

## Carte des données locales

Les chemins sont ceux de l'espace privé Android de l'app (`filesDir`,
`cacheDir`, `shared_prefs`). Sauf mention contraire, la donnée est en clair
dans le bac à sable applicatif : le chiffrement au repos ne couvre que la
session et la clé LLM (`SessionStore.kt`, `LlmKeyStore.kt`). Aucune donnée
de l'app n'est sauvegardée ni transférée par Android : `allowBackup="false"` et les règles
`data_extraction_rules` excluent tout ([I33](../architecture/invariants/donnees.md#i33),
`android/app/src/main/AndroidManifest.xml`,
`android/app/src/main/res/xml/data_extraction_rules.xml`).

| Catégorie | Contenu | Emplacement et forme | Finalité | Base proposée (à confirmer) | Rétention constatée | Destinataires |
|---|---|---|---|---|---|---|
| Session Pronote | URL du client, identifiant, jeton tourné, UUID d'appareil, identifiant client, URL d'établissement | `EncryptedSharedPreferences` `session` (AES256-SIV/GCM via Keystore) | Ouvrir et restaurer la session sans rescanner le QR | Exécution du contrat / intérêt légitime de sécurité | Jusqu'à déconnexion, session morte ou suppression totale ; pas d'expiration automatique. Le jeton est remplacé à chaque rotation ; le PIN du QR n'est jamais persisté | Établissement (requêtes authentifiées) ; jamais le projet |
| Comptes appairés | Identifiants de compte et compte courant (pas de nom, classe, photo ni jeton) | `SharedPreferences` `accounts`, en clair | Multi-compte et bascule | Exécution du contrat | Jusqu'à déconnexion ou suppression totale ; 8 comptes au plus, identifiant ≤ 64 caractères | Aucun |
| Clé LLM | Clé OpenRouter | `EncryptedSharedPreferences` `llm_keys` (Keystore) | Appeler le fournisseur choisi | Consentement / exécution du service demandé | Jusqu'à « oublier la clé » ou suppression totale ; pas d'expiration automatique | OpenRouter, dans l'en-tête `Authorization` uniquement |
| Consentement et attestation IA | Décision (accord, refus, retrait), version acceptée, attestation d'âge ou d'autorisation parentale | `SharedPreferences` `ai_consent`, en clair | Prouver l'accord et l'attestation avant tout appel IA | Consentement (preuve de l'accord) | Jusqu'au retrait ou suppression totale ; conservé à la déconnexion | Aucun |
| Cache hors-ligne | Notes, devoirs, emploi du temps, actualités, menus, absences/retards, sanctions, capacités, liste des fils, alertes de sécurité | `filesDir/offline/cache_<ressource>_<empreinte>.txt`, en clair ; en-tête horodatage + requête, puis payload | Affichage hors-ligne et reprise rapide | Exécution du contrat / intérêt légitime (continuité du service) | TTL de fraîcheur de 15 min à 24 h selon la ressource (tableau ci-dessous). Une entrée périmée est supprimée à la prochaine écriture de la même ressource, pas par une tâche planifiée ; purge de compte sinon. Plafond global 2 Mio, 512 Kio par payload | Aucun ; le payload vient de l'établissement |
| Messages Pronote | Liste des fils (identifiants, participants, dates, non-lus) ; corps des messages | Liste dans le cache `discussions` (15 min) ; corps d'un fil **en mémoire seule**, jamais écrit sur disque | Lire et répondre dans l'app | Exécution du contrat | Liste : TTL 15 min / purge de compte. Corps : mémoire, effacé à la déconnexion ou à la mort du processus. Aucune donnée de messagerie n'est réinjectée dans l'IA | Établissement ; jamais OpenRouter |
| Cahier de cours | Notes de cours par matière (titre, texte, date), 64 au plus | `filesDir/offline/course-notes.json`, en clair (ancien `cahier.json` migré) | Garder les cours et les donner comme sources à l'IA | Consentement / exécution du service demandé | Jusqu'à suppression par l'utilisateur, déconnexion ou suppression totale ; pas de purge par ancienneté | OpenRouter uniquement quand une aide IA est demandée |
| Fiches de révision | Fiche générée (titre, corps, sources, date), 500 au plus à l'export | `filesDir/offline/revisions/<clé>.bin`, en clair | Relire et exporter une fiche | Consentement / exécution du service demandé | Jusqu'à suppression, déconnexion ou suppression totale ; pas de purge par ancienneté | OpenRouter à la génération ; application choisie par l'utilisateur pour le PDF |
| Fil « professeur » | Conversation locale avec l'assistant, 40 messages stockés, résumé ≤ 1 000 caractères | `filesDir/offline/teacher_chat.json`, en clair | Continuité de l'aide IA | Consentement | Jusqu'à suppression, déconnexion ou suppression totale ; pas de purge par ancienneté | OpenRouter quand l'utilisateur envoie un message |
| Préférences matières | Couleur, emoji, libellé personnalisé par matière, 64 au plus | `filesDir/offline/subject_prefs.json`, en clair | Personnaliser l'affichage | Intérêt légitime / préférence utilisateur | Jusqu'à suppression, déconnexion ou suppression totale | Aucun (pas de synchronisation établissement constatée) |
| Manuel | URL choisie, classe devinée, matières, extraits (8 documents, 32 matières, extrait ≤ 8 000 caractères) | `filesDir/offline/manual.json`, en clair ; anciennes clés dans `SharedPreferences` `manual` | Fournir un manuel comme source citée | Consentement pour la fonction facultative | Jusqu'à « oublier le manuel », déconnexion ou suppression totale. `prompt_seen` reste (réglage d'interface) | Le scraper choisi reçoit l'URL ; OpenRouter reçoit le titre et l'extrait, jamais l'URL |
| Pièces jointes | Fichiers téléchargés depuis les devoirs | `cacheDir/attachments/<devoir>/<id>~<libellé>.<ext>`, en clair | Ouvrir une pièce, l'extraire pour l'IA | Exécution du service demandé / consentement pour l'IA | LRU : 24 fichiers et 32 Mio par dossier, 10 Mio par fichier ; purge de compte | Application choisie par l'utilisateur (viewer) ; OpenRouter si la pièce entre dans le contexte IA |
| Exports | JSON portable (notes, cahier, fiches, fil professeur, manuel, préférences, état de lecture) et PDF de fiche | `cacheDir/exports/...`, en clair ; JSON ≤ 8 Mio | Portabilité et partage | Exécution du service demandé / obligation d'accès | **Exception assumée** : un export survit à la déconnexion et au changement de compte ; seule la suppression totale l'efface, sinon LRU 24 fichiers / 32 Mio. À valider avec le conseil | Application choisie dans la feuille de partage Android ; le projet ne reçoit rien |
| Photos de cours | Photos d'énoncé ré-encodées JPEG, 1 600 px et 2 Mio au plus, 3 pages au plus | `cacheDir/photos/capture-*.jpg` ou `gallery-*.jpg`, en clair | Transcrire ou envoyer un énoncé à l'IA sur geste explicite | Consentement (geste explicite) | Purge à chaque création d'activité et à la déconnexion ; pas de conservation après usage. L'original de galerie n'est pas conservé | OpenRouter si l'utilisateur demande l'analyse ; jamais sans geste |
| Profil | Nom affiché, classe, comptes liés, photo de profil | **Mémoire seule** ; photo décodée ≤ 2 Mio / 512 px | Afficher le profil | Exécution du contrat | Disparaît à la déconnexion ou à la mort du processus ; jamais sur disque | Aucun |
| État de lecture et WebView | Actualités lues (500 identifiants), cache/formulaires/cookies de la coquille, thème et schéma | DOM storage (`localStorage`), cache WebView ; thème/schéma retenus | Éviter de relire une actualité, garder l'apparence | Intérêt légitime / préférence | IDs et cache purgés à la déconnexion ou suppression totale ; thème et schéma conservés même après suppression totale | Aucun |
| Réglages d'interface | Thème, taille de texte, `prompt_seen` du manuel | `SharedPreferences` `settings` et `manual`, en clair | Apparence et éviter un rappel | Préférence utilisateur | Conservés après déconnexion **et** après suppression totale ; effacés à la désinstallation | Aucun |
| État technique | Horodatage de cooldown de file, marqueurs de synchronisation | `filesDir/school-cooldown` et fichiers temporaires, en clair | Respecter le débit et reprendre un travail | Intérêt légitime (sécurité et disponibilité) | Écrasé au prochain passage ; pas de donnée scolaire | Aucun |

Le cache de liste des fils et le cache des messages vivent aussi en mémoire
(`DiscussionListCache`, `ThreadMessageCache`) et sont vidés à la déconnexion.
Les temporaires d'écriture (`tmp-*`, `*.bak`, `quarantine/`) sont des copies
techniques des mêmes données, avec la même purge que leur cible.

## Sous-traitants, destinataires et transferts

| Flux | Données | Sens | Destinataire / rôle | Transfert |
|---|---|---|---|---|
| Pronote | Identifiants de session, requêtes de notes, devoirs, emploi du temps, messages, pièces jointes, profil | Appareil → établissement, HTTPS | Établissement, responsable du traitement | Réseau de l'établissement ; politique de l'établissement |
| OpenRouter | Prompt (consigne, cours, extraits de manuel, pièces jointes, historique du fil), photos, clé API | Appareil → `openrouter.ai`, HTTPS direct | OpenRouter, fournisseur choisi par l'utilisateur | Hors EEE selon le fournisseur et le compte ; conditions et garanties à vérifier. Le projet ne relaie ni ne stocke rien |
| Scraper facultatif | URL de manuel ou de page, plateforme ; pages publiques récupérées | Appareil → serveur configuré ; serveur → sites publics | Opérateur du scraper (souvent l'utilisateur) | Sur le réseau local ou un proxy choisi par l'utilisateur ; le serveur ne contacte jamais Pronote |
| GitHub | Compte, contenu d'issue/PR, logs de téléchargement de release | Navigateur/`gh` → GitHub | GitHub, hébergeur du dépôt et du support | Mondial ; politique et DPA GitHub à vérifier |
| Partage Android | Export JSON ou PDF | Appareil → application choisie | Application choisie par l'utilisateur (mail, cloud, messagerie…) | Sort du contrôle de l'app ; la destination peut être hors EEE |
| Télémétrie, publicité, crash reporting | — | — | **Aucun** constaté dans le code : pas d'analytics, pas de publicité, pas de SDK de crash | — |

Le scraper est un service **local facultatif** : il écoute sur la boucle locale
par défaut, refuse une exposition publique sans jeton et ne reçoit jamais la
session Pronote de l'élève. Son cookie jar est un fichier `0600` dans un
répertoire `0700`, avec une seule sauvegarde, remplacé au scrape suivant ; il
n'a pas de TTL automatique. Les logs du serveur ne contiennent ni URL ni
contenu ([server/README.md](../../server/README.md),
`server/infrastructure/jar-store.ts`).

## Constantes de rétention et de bornes

Ces valeurs sont celles du code au 2026-11-04. Les TTL sont des **indicateurs de
fraîcheur**, pas des minuteries de suppression : une entrée périmée est effacée
lors de la prochaine écriture de la même ressource, ou par la purge de compte.
Il n'existe pas de tâche qui supprime une entrée à l'instant exact de son TTL.

| Ressource | TTL de fraîcheur | Entrées max | Source |
|---|---:|---:|---|
| Notes | 15 min | 8 | `android/data/CachePolicy.kt` |
| Devoirs | 15 min | 12 | `android/data/CachePolicy.kt` |
| Emploi du temps | 60 min | 8 | `android/data/CachePolicy.kt` |
| Actualités | 60 min | 4 | `android/data/CachePolicy.kt` |
| Menus | 6 h | 4 | `android/data/CachePolicy.kt` |
| Absences / retards | 60 min | 8 | `android/data/CachePolicy.kt` |
| Sanctions | 60 min | 4 | `android/data/CachePolicy.kt` |
| Capacités | 24 h | 2 | `android/data/CachePolicy.kt` |
| Liste des fils | 15 min | 4 | `android/data/CachePolicy.kt` |
| Alertes de sécurité | 15 min | 2 | `android/data/CachePolicy.kt` |
| Cache global | — | 2 Mio au total ; 512 Kio par payload | `android/data/CachePolicy.kt` |

| Élément | Borne / rétention | Source |
|---|---|---|
| Pièces jointes | 24 fichiers et 32 Mio par dossier ; 10 Mio par fichier ; LRU ; purge de compte | `android/data/DownloadedFiles.kt` |
| Exports | 24 fichiers et 32 Mio par dossier ; JSON ≤ 8 Mio ; survivent à la déconnexion sauf suppression totale | `android/data/DownloadedFiles.kt`, `android/data/AccountPurgeFactory.kt` |
| Photos | 3 pages, 1 600 px, 2 Mio par image ; lecture galerie ≤ 10 Mio ; purge à chaque activité et à la déconnexion | `android/app/PhotoCapture.kt`, `android/core/Vision.kt` |
| Cahier de cours | 64 notes ; 8 par matière pour l'IA ; texte ≤ 4 000 caractères | `android/core/LessonNote.kt` |
| Fil professeur | 40 messages stockés ; résumé ≤ 1 000 caractères | `android/core/TeacherChat.kt` |
| Manuel | 8 documents ; 32 matières ; extrait ≤ 8 000 caractères | `android/data/Manuals.kt` |
| Préférences matières | 64 entrées | `android/data/SubjectPrefs.kt` |
| État de lecture | 500 identifiants ; 200 caractères par identifiant | `web/src/features/news/readState.ts` |
| Comptes | 8 comptes ; identifiant ≤ 64 caractères | `android/data/StoreCommit.kt` |
| Contexte IA | 12 000 caractères au total ; 2 000 par source ; 8 sources ; 6 éléments d'historique ; 6 pièces jointes lues, dont 2 en vision | `android/core/AiContext.kt`, `android/data/AttachmentText.kt` |
| Sortie IA | 16 000 caractères | `android/core/HomeworkAi.kt`, `android/core/RevisionAi.kt` |

### Rétention hors appareil

| Destinataire | Durée constatée | Source / limite |
|---|---|---|
| Établissement / Pronote | Selon la politique de l'établissement ; l'app n'en fixe aucune | Hors dépôt ; à obtenir de l'établissement |
| OpenRouter | Selon les conditions et le réglage du compte OpenRouter ; l'app n'en fixe aucune | Hors dépôt ; à vérifier avec le fournisseur, notamment pour le modèle gratuit |
| GitHub (releases, issues, PR) | Jusqu'à suppression par l'utilisateur ou les mainteneurs, selon la politique GitHub | Hors dépôt ; DPA et politique GitHub à vérifier |
| Scraper auto-hébergé | Cookie jar remplacé au scrape suivant ; une sauvegarde ; pas de TTL automatique | `server/infrastructure/jar-store.ts` |
| Application de partage choisie | Selon l'application de destination ; hors du contrôle de l'app | Notice utilisateur à rédiger |

## Suppression, portabilité et changement de compte

### Déconnexion et session morte

`PairingRepository.logoutBlocking()` exécute la purge orchestrée
(`AccountPurgeMode.LOGOUT` ; même inventaire pour `SESSION_DEAD`). Elle efface :
session, liste des comptes, cache hors-ligne, cahier de cours, fil professeur,
préférences matières, manuel (contenu du compte), pièces jointes, photos, état
de lecture et cache WebView (hors thème et schéma). Elle **conserve par
conception** : la clé LLM, le consentement et l'attestation IA, l'adresse du
serveur de manuels, le drapeau `prompt_seen`, les réglages d'interface et les
exports. Une purge incomplète
rend `false` et interdit de publier le compte suivant.

### Changement de compte

`AccountPurgeMode.ACCOUNT_SWITCH` purge les mêmes stores de compte, mais
remplace la session et la liste des comptes au lieu de les effacer. La purge
précède la publication du nouveau client ; une écriture en vol de l'ancien
compte est refusée (I16). Les exports restent, comme à la déconnexion.

### « Supprimer toutes mes données »

`AccountPurgeMode.DELETE_ALL` reprend le même orchestrateur et y ajoute la clé
LLM, le consentement et l'attestation IA, l'adresse du serveur et les exports. La confirmation affiche l'inventaire
complet et un échec partiel nomme les stores restants
(`web/src/features/settings/deleteAll.ts`, `DeleteAllCard.tsx`). Restent après
cette suppression : les réglages d'interface (`settings`, thème/schéma) et le
drapeau `prompt_seen` — ce sont des préférences, pas des données de compte.

### Ce qui ne peut pas être supprimé depuis l'app

- Une copie d'export déjà partagée vers un autre service : elle est hors du
  contrôle de l'app.
- Les données détenues par l'établissement, OpenRouter, GitHub ou un
  destinataire du partage : la demande doit aller à ce destinataire.
- Les journaux ou copies de sauvegarde d'un fournisseur.

### Portabilité

L'écran Réglages propose « Exporter mes données » : un JSON local (format
`veryslopnynotes.data-export`, schéma 1) partagé par la feuille Android. Il
contient les notes, le cahier de cours, les fiches de révision, le fil
professeur, le manuel, les préférences matières et l'état de lecture. Il
**exclut** le jeton de session, la clé LLM, l'adresse du serveur, l'URL source
du manuel et les identifiants (`DataExport.WITHHELD`). Les pièces jointes, les
photos et le cache brut ne sont pas inclus ; les fiches peuvent être exportées
séparément en PDF. Un export demandé avant une purge est proposé par l'écran de
suppression.

### Sauvegarde et transfert d'appareil

Aucune sauvegarde cloud ni transfert appareil-à-appareil : `allowBackup="false"`
et les deux sections de `data_extraction_rules.xml` excluent tous les domaines.
Une copie cloud échapperait à la purge de compte (I33).

## Droits des personnes et runbook DSR

Le projet ne reçoit pas les données scolaires. Une demande d'accès, de
rectification ou d'effacement portant sur ces données se traite donc **sur
l'appareil**, **auprès de l'établissement** ou **auprès du fournisseur choisi**,
pas par une recherche dans une base du projet. Les mainteneurs ne doivent
jamais demander le jeton Pronote, le PIN, la clé OpenRouter ou une capture
d'écran de notes pour « vérifier » une demande.

| Droit | Où et comment l'exercer | Ce que le projet peut faire |
|---|---|---|
| Accès | Exporter le JSON depuis Réglages ; consulter l'établissement pour la source ; OpenRouter pour son compte | Expliquer le chemin ; traiter une demande qui porte sur des données GitHub |
| Portabilité | Exporter le JSON ; exporter une fiche en PDF ; export GitHub pour les données de compte GitHub | Fournir le format et les limites ; pas de transfert serveur |
| Rectification | Modifier dans l'app ce qui est local ; corriger à la source auprès de l'établissement | Corriger un contenu GitHub si la demande porte sur une issue/PR |
| Effacement | « Supprimer toutes mes données » ou déconnexion ; désinstaller ; supprimer l'export partagé ; révoquer la clé OpenRouter ; demander à l'établissement | Supprimer un commentaire/une issue GitHub si applicable |
| Limitation / opposition | Ne pas utiliser l'IA ou le manuel ; retirer la clé ; se déconnecter ; ne pas partager d'export ; ne pas ouvrir d'issue | Aucun profilage central à arrêter ; répondre à la demande GitHub |
| Retrait du consentement | Retirer la clé LLM, supprimer les photos, oublier le manuel, se déconnecter | Rappeler que le consentement porte sur l'usage de l'app, pas sur une base du projet |
| Réclamation | Autorité de contrôle compétente (à identifier selon le ressort) | Donner les faits vérifiables ; ne pas inventer de contact |

### Procédure pas à pas

1. **Qualifier la demande et localiser la donnée.** Appareil (notes, cache,
   photos, session), GitHub (issue, PR, release) ou tiers (établissement,
   OpenRouter, scraper, destination d'un partage). Ne pas demander de secret
   pour identifier la personne.
2. **Vérifier l'identité seulement si nécessaire.** Pour GitHub, le compte
   suffit. Pour l'appareil, la possession de l'appareil est le contrôle
   d'accès ; l'app n'a pas de compte projet. Ne pas collecter de pièce
   d'identité pour une donnée que le projet ne détient pas.
3. **Exécuter le chemin du tableau.** Pour une demande appareil, guider vers
   « Exporter mes données » ou « Supprimer toutes mes données ». Pour une
   donnée scolaire, rediriger vers l'établissement. Pour OpenRouter, vers le
   compte OpenRouter.
4. **Répondre sans données de tiers.** Ne pas recopier de notes, messages,
   photos ou identifiants dans la réponse ou dans une issue. Décrire le
   chemin, les limites et ce qui a été fait.
5. **Consigner a minima.** Date, canal, portée et issue de la demande, sans
   donnée scolaire. Le format et la durée de ce registre restent à définir avec
   le conseil (question ouverte).
6. **Escalader au conseil** si la demande concerne un mineur, une donnée de
   santé, une obligation de l'établissement ou un transfert hors EEE.

Le délai de réponse, le registre des demandes et le point de contact public ne
sont pas fixés par ce document : ils dépendent du responsable et du droit
applicable (questions ouvertes).

## Mineurs

L'app est destinée à des élèves et peut traiter des données de mineurs :
notes, absences, sanctions, messages, photos d'énoncés, éventuellement des
éléments de santé ou de vie scolaire selon ce que publie l'établissement. Elle
ne collecte ni date de naissance ni âge, ne crée pas de compte chez le projet,
n'affiche ni publicité ni profil public et ne vend rien.

Points de vigilance :

- L'IA et le manuel sont **facultatifs** et déclenchés par un geste. Les photos
  ne partent jamais automatiquement ; elles peuvent contenir des visages ou des
  documents d'identité si l'utilisateur les choisit.
- L'autorisation parentale ou de l'établissement, l'âge minimal et la mention
  « public adolescent » sont des décisions humaines, pas des constantes du
  code. Pour l'IA, une attestation déclarative 18+ ou autorisation parentale
  est exigée avant l'enregistrement de la clé (version 2) ; elle ne vérifie pas
  l'âge et ne remplace pas la décision juridique (DEC-04). L'app ne bloque pas
  l'usage non-IA par un mineur non accompagné.
- Un représentant légal peut exercer les droits sur l'appareil (export,
  suppression, retrait de la clé) et auprès de l'établissement. Pour GitHub, le
  compte est la seule identité vérifiable.
- Le projet ne doit pas demander à un mineur de publier des notes, une photo ou
  un identifiant dans une issue de support.

## Crible DPIA (AIPD)

Ce crible n'est pas une DPIA et ne tranche pas l'obligation. Il liste les
critères généralement examinés et ce que le code permet de constater.

| Critère | Constat | Conséquence |
|---|---|---|
| Évaluation ou profilage systématique | Pas de scoring, pas de profil public, pas de décision automatisée ; l'IA produit une suggestion, jamais un effet métier | Critère non rempli au niveau du projet |
| Décision automatisée à effet juridique ou significatif | Aucune : une écriture Pronote part d'un geste ; une sortie IA est validée et n'écrit pas | Critère non rempli |
| Surveillance systématique | Pas d'analytics, pas de tracking, pas de notifications ; la synchro de fond rafraîchit les données de l'utilisateur | Critère non rempli au niveau du projet |
| Données sensibles ou très personnelles | Notes, absences, sanctions, messages, photos ; des motifs peuvent révéler la santé ou la vie privée | Critique possible selon les payloads de l'établissement ; à qualifier |
| Grande échelle | Pas de traitement central par le projet ; traitement local par appareil, mais déploiement potentiel sur de nombreux élèves | Le projet ne traite pas à grande échelle ; un établissement peut le faire |
| Personnes vulnérables | Public scolaire, mineurs probables | Critère rempli ou à confirmer |
| Technologie nouvelle / IA | LLM texte et vision, fournisseur externe, contenu non fiable | Critère rempli |
| Combinaison de données | L'app combine localement devoirs, cours, manuel, pages web et pièces pour l'IA | À documenter dans l'AIPD de l'établissement |
| Transfert hors EEE | OpenRouter et GitHub selon le compte et le fournisseur | À qualifier avec le DPA et les garanties |
| Exclusion ou refus de service | Pas de décision automatisée bloquante ; une panne IA ou app ne prive pas de l'accès Pronote | Critère non rempli |

Conclusion de crible, **à valider par le conseil** : le projet ne paraît pas
traiter lui-même à grande échelle ni exercer une surveillance, mais il outille
un traitement de données de mineurs, avec IA et transferts possibles. Une AIPD
d'établissement est plausible ; une AIPD du projet n'est pas écartée. La
décision, le périmètre et le responsable de cette AIPD restent ouverts.

## Mesures techniques pertinentes

- Session et clé LLM chiffrées au repos par le Keystore (AES256-GCM maître,
  AES256-SIV/GCM pour les préférences) ; un Keystore indisponible échoue
  fermé et le signale, jamais de secret en clair (I18).
- Les autres données locales sont en clair dans l'espace privé de l'app ; la
  protection repose sur le bac à sable Android, pas sur un chiffrement de
  fichier. Un appareil déverrouillé, rooté ou instrumenté peut les lire.
- Pas de sauvegarde cloud ni de transfert appareil-à-appareil (I33).
- `FLAG_SECURE` en release pour l'aperçu des récents et les captures ; le build
  debug en est exempté.
- TLS obligatoire vers Pronote, OpenRouter et le scraper distant ; le clair est
  réservé à la boucle locale du build debug (`ServerConfig.kt`,
  `network_security_config.xml`). La release refuse tout clair.
- Aucun secret dans les logs, les erreurs ou les `toString()` ; la clé ne part
  que dans `Authorization` vers OpenRouter. Le prompt est contrôlé contre les
  formes de secrets et le contenu externe est marqué non fiable (I4, I6).
- Aucune télémétrie, publicité ou rapport de crash constaté dans le code.

## Questions ouvertes à trancher avec le conseil

1. **Entité et responsable.** Quelle entité juridique édite le projet, où est-
   elle établie, et quel rôle (responsable, responsable conjoint, simple
   éditeur de logiciel) lui attribuer pour le traitement local ? Le dépôt ne
   nomme ni adresse, ni société, ni représentant.
2. **Contact vie privée.** Quelle adresse ou quel canal public pour les
   demandes, et qui y répond ? Aucun contact ne doit être inventé.
3. **Bases légales.** Valider les bases proposées, en particulier pour les
   données scolaires, les motifs d'absence/sanction (santé ou discipline), les
   photos et les prompts IA. La base peut dépendre de l'établissement.
4. **Rôle d'OpenRouter.** Est-ce un responsable indépendant, un sous-traitant
   de l'utilisateur ou un sous-traitant du projet ? Quelles conditions, quelles
   garanties de transfert, quelle rétention et quel usage des modèles gratuits ?
5. **Rôle de GitHub.** DPA, sous-traitance, transferts et durée de conservation
   des issues/PR et des logs de release.
6. **Support.** Peut-on demander à un utilisateur de coller une capture ou un
   payload dans une issue ? La réponse proposée est non ; la règle et le
   nettoyage des issues existantes restent à formaliser.
7. **Exports.** La conservation d'un export après déconnexion ou changement de
   compte est une exception de code. Est-elle acceptable, ou faut-il la purger
   avec le compte ?
8. **Mineurs.** Attestation 18+ ou autorisation parentale en place pour l'IA
   (version 2) ; validation juridique, âge minimal, information des
   représentants légaux et mention d'âge sur le store restent à trancher
   (DEC-04).
9. **AIPD.** Une AIPD projet est-elle requise ? Qui la porte : projet,
   établissement, les deux ? Le crible ci-dessus doit être daté et signé.
10. **Scraper.** Responsabilités de l'opérateur d'une instance partagée,
    conditions des sites sources, `robots.txt` et attribution
    ([manual-scraper.md](manual-scraper.md)).
11. **Registre DSR.** Format, durée et responsable du registre minimal des
    demandes, sans donnée scolaire.
12. **Politique publique.** La notice de confidentialité est rédigée dans
    [`PRIVACY.md`](../../PRIVACY.md) et les conditions d’utilisation dans
    [`TERMS.md`](../../TERMS.md) ; elles restent à valider par le conseil, sans
    promettre plus que le code ne fait.

## Références de code

Les chemins ci-dessous sont des repères de lecture, pas des liens de
documentation : `android/data/` est le seul écrivain du disque de compte
(loi 2), `android/core/` reste pur, `web/` n'a pas de réseau.

- Purge et inventaire : `android/data/AccountPurge.kt`,
  `android/data/AccountPurgeFactory.kt`, `android/data/CacheScope.kt`,
  `android/data/LocalDataStore.kt`.
- Stockage : `android/data/SessionStore.kt`, `android/data/LlmKeyStore.kt`,
  `android/data/AccountStore.kt`, `android/data/ServerStore.kt`,
  `android/data/Manuals.kt`, `android/data/OfflineCache.kt`,
  `android/data/OfflineArtifacts.kt`, `android/data/DownloadedFiles.kt`,
  `android/data/LessonNotesStore.kt`, `android/data/TeacherChatStore.kt`,
  `android/data/SubjectPrefs.kt`.
- Réseau et IA : `android/data/OpenRouterLlm.kt`, `android/data/LlmPolicy.kt`,
  `android/pronote/`, `server/infrastructure/jar-store.ts`.
- Export et suppression : `android/data/DataExport.kt`,
  `android/app/src/main/java/fr/veryslopnynotes/app/VsnBridgeDataExport.kt`,
  `web/src/features/settings/deleteAll.ts`.
- Sauvegarde : `android/app/src/main/AndroidManifest.xml`,
  `android/app/src/main/res/xml/data_extraction_rules.xml`.
