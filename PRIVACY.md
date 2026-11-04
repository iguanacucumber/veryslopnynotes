# Notice de confidentialité

**Notice version 1 — 4 novembre 2026**

> **Version de travail — revue juridique en attente.** Cette notice décrit ce
> que le code fait à la date indiquée. Elle ne constitue pas un avis juridique
> et ne remplace ni la notice de l’établissement, ni les conditions de Pronote
> ou d’OpenRouter. Les points qui dépendent d’une décision humaine ou d’une
> qualification juridique sont listés en [section 15](#15-points-ouverts-avant-la-release-publique).

Cette notice s’applique à l’application Android **VerySlopyNyNotes** et au
dépôt GitHub qui la distribue. Elle complète les
[conditions d’utilisation](TERMS.md). Le détail vérifiable par le code
(chemins, constantes, tests) est dans la
[carte des données](docs/legal/DATA-MAP.md).

## 1. Responsable du traitement et contact

Le projet est un logiciel libre maintenu publiquement par le compte GitHub
**`iguanacucumber`** :
<https://github.com/iguanacucumber/veryslopnynotes>.

À la date de cette version, le projet ne publie **ni entité juridique, ni
adresse postale, ni adresse e-mail dédiée**, et aucun délégué à la protection
des données (DPO) n’est désigné. La désignation formelle du responsable du
traitement et d’un point de contact vie privée est donc **ouverte** (issue
[#831](https://github.com/iguanacucumber/veryslopnynotes/issues/831)) et doit
être complétée avant une release publique. GitHub est le seul canal public
disponible à ce jour.

Pour une question de confidentialité, n’ouvre pas d’issue contenant des notes,
des messages, une photo, un identifiant, un QR, un PIN ou une clé. Pour une
faille de sécurité, ne crée pas d’issue publique : suis
[`SECURITY.md`](SECURITY.md).

## 2. Ce que fait l’application

L’application est **locale d’abord** : elle ne crée aucun compte chez le projet
et n’envoie aucune donnée scolaire à un serveur du projet. Les seuls flux
réseau sont :

- l’**établissement** (Pronote), pour lire et écrire les données du compte
  scolaire ;
- **OpenRouter**, uniquement quand tu utilises l’assistant IA avec ta clé ;
- le **scraper de manuels facultatif**, seulement si tu configures l’adresse
  d’un serveur que tu choisis ;
- **GitHub**, pour télécharger une release ou participer au dépôt.

Les notes, devoirs, emploi du temps, absences, sanctions, actualités, menus,
messages, pièces jointes et le profil sont lus depuis l’établissement et
stockés sur ton téléphone. Ils ne passent par aucun serveur du projet. Ils
peuvent toutefois être envoyés à l’établissement (requêtes authentifiées), à
OpenRouter si tu demandes une aide IA qui les inclut, au scraper si tu ajoutes
une page, ou à l’application que tu choisis pour un export.

Le projet n’est ni édité, ni approuvé, ni parrainé par Pronote, Index Éducation,
OpenRouter ou un établissement scolaire.

## 3. Données traitées, finalités et bases légales

Les bases indiquées ci-dessous sont **proposées par le projet** ; elles doivent
être validées par un conseil et, pour les données scolaires, par
l’établissement. Lorsque l’établissement est responsable du traitement, c’est sa
propre base légale et sa propre notice qui s’appliquent à la collecte d’origine.

| Catégorie | Exemples | Finalité | Base proposée | Destinataire |
|---|---|---|---|---|
| Session et comptes appairés | URL du client, identifiant, jeton tourné, UUID d’appareil, identifiant client, liste des comptes | Ouvrir et restaurer la session sans rescanner le QR ; gérer plusieurs comptes | Exécution du service demandé ; intérêt légitime à sécuriser la session | Établissement (requêtes authentifiées) ; jamais le projet |
| Données scolaires | Notes, devoirs, emploi du temps, absences et retards, sanctions, actualités, menus, messages, pièces jointes, profil | Afficher et mettre à jour le compte scolaire, y compris hors-ligne | Exécution du service demandé ; intérêt légitime à la continuité du service ; collecte d’origine sous la responsabilité de l’établissement | Établissement ; OpenRouter seulement si tu demandes une aide IA qui inclut ces données ; application choisie pour un partage |
| Contenus que tu crées | Cahier de cours, fiches de révision, fil du professeur, manuel enregistré, préférences de matières, état de lecture | Garder tes contenus, les afficher et les utiliser comme sources si tu le demandes | Consentement pour les fonctions facultatives ; exécution du service pour le stockage local | OpenRouter seulement quand tu demandes une aide IA ; application choisie pour un export |
| Données envoyées à l’IA | Question, consigne, cours, extraits de manuel ou de page web, pièces jointes, photos, historique du fil, clé OpenRouter, métadonnées de requête | Répondre à ta demande d’aide ou de fiche | Consentement explicite, versionné et retirable | OpenRouter et les fournisseurs de modèles qu’il route |
| Exports | JSON portable (notes, cahier, fiches, fil professeur, manuel, préférences, état de lecture) et PDF de fiche | Portabilité et partage | Obligation d’accès et de portabilité ; exécution du service demandé | Application choisie dans la feuille de partage Android ; le projet ne reçoit rien |
| Données GitHub | Compte GitHub, contenu d’une issue ou d’une pull request, logs de téléchargement d’une release | Distribution du code et des releases, support | Intérêt légitime pour le support et la distribution ; consentement lorsque tu publies | GitHub, hébergeur du dépôt |
| État technique | Horodatage de cooldown, marqueurs de synchronisation | Respecter le débit de l’établissement et reprendre un travail interrompu | Intérêt légitime (sécurité et disponibilité) | Aucun ; pas de donnée scolaire |

Les données scolaires peuvent révéler des éléments de vie privée ou de santé
(par exemple un motif d’absence). L’application ne les analyse pas pour prendre
une décision et ne les envoie pas au projet. Si tu utilises l’IA, les sources
prévues par l’app (cours de la matière, pièces jointes lues, manuel activé)
peuvent entrer dans le contexte ; l’aperçu du consentement les liste avant
l’accord.

## 4. Destinataires

| Destinataire | Ce qu’il reçoit | Quand | Rôle et limite |
|---|---|---|---|
| Établissement / Pronote | Identifiants de session et requêtes de notes, devoirs, emploi du temps, messages, pièces jointes, profil | À chaque synchronisation ou action dans l’app | Responsable du traitement des données qu’il héberge ; sa politique de rétention s’applique |
| OpenRouter | Prompt, consigne, cours, extraits de manuel ou de page, pièces jointes, photos, historique du fil, clé API, métadonnées | Uniquement quand tu utilises l’assistant avec ton accord | Fournisseur choisi par toi ; il route les demandes vers des fournisseurs de modèles. Son rôle exact (responsable indépendant ou sous-traitant) et ses garanties restent à confirmer |
| GitHub | Compte, contenu des issues et pull requests, logs de téléchargement des releases | Quand tu utilises GitHub ou télécharges une release | Hébergeur du dépôt et du support ; sa politique et son DPA s’appliquent. L’app n’envoie rien à GitHub toute seule |
| Scraper facultatif | URL de manuel ou de page, plateforme ; pages publiques récupérées | Quand tu configures un serveur de manuels et demandes un scrape | Service auto-hébergé, souvent sur ton réseau local. Il ne reçoit jamais la session Pronote. Son cookie jar local sert aux sites sources, pas à Pronote |
| Application de partage | Export JSON ou PDF | Quand tu choisis « partager » | Application choisie par toi (mail, cloud, messagerie…). La copie sort du contrôle de l’app |
| Serveur du projet | — | — | **Aucun** : le projet n’exploite pas de serveur qui reçoit les données de l’app |

## 5. Transferts hors EEE

Le projet n’exploite aucun serveur qui reçoit tes données. Les transferts hors
EEE possibles concernent :

- **OpenRouter** et les fournisseurs de modèles qu’il route, selon ton compte,
  le modèle et la région d’hébergement ;
- **GitHub**, pour le dépôt, les releases et le support ;
- l’**application de partage** que tu choisis, si sa destination est hors EEE ;
- l’**établissement**, selon son propre hébergement.

L’application ne fixe pas les clauses contractuelles types, les décisions
d’adéquation ou les garanties de ces destinataires. Vérifie leurs politiques et
leurs accords de traitement avant de les utiliser. Aucune garantie de transfert
n’est affirmée par cette notice.

## 6. Durées de conservation

Les durées ci-dessous sont celles du code à la date de cette version. Les TTL
du cache sont des **indicateurs de fraîcheur**, pas des minuteries de
suppression : une entrée périmée est effacée à la prochaine écriture de la même
ressource, ou par la purge du compte. Il n’existe pas de tâche qui supprime une
entrée à l’instant exact de son TTL.

| Donnée | Conservation locale |
|---|---|
| Session, comptes appairés | Jusqu’à la déconnexion, une session morte ou « Supprimer toutes mes données » ; pas d’expiration automatique |
| Cache scolaire (notes, devoirs, emploi du temps, actualités, menus, absences, sanctions, capacités, liste des fils, alertes) | TTL de fraîcheur de 15 min à 24 h selon la ressource ; suppression à la prochaine écriture de la même ressource ou purge du compte ; plafond global 2 Mio |
| Messages Pronote | Liste des fils : cache de 15 min et purge du compte. Corps d’un fil : mémoire seule, effacé à la déconnexion ou à la mort du processus |
| Cahier de cours, fiches de révision, fil du professeur, manuel, préférences de matières | Jusqu’à suppression par toi, déconnexion ou suppression totale ; pas de purge par ancienneté |
| Pièces jointes | LRU de 24 fichiers et 32 Mio par dossier, 10 Mio par fichier ; purge du compte |
| Photos de cours | Copie locale effacée dès la préparation, à la déconnexion et lors de la création d’une nouvelle activité ; l’original de galerie n’est pas conservé |
| Exports | Jusqu’à « Supprimer toutes mes données » ou LRU de 24 fichiers et 32 Mio ; un export survit à une déconnexion ou à un changement de compte |
| Clé LLM | Jusqu’à « oublier la clé », la déconnexion, un changement de compte ou « Supprimer toutes mes données ». Elle reste chiffrée après un redémarrage tant que la session est active |
| Consentement et attestation IA | Jusqu’au retrait ou suppression totale ; ils survivent à une déconnexion |
| Adresse du serveur de manuels | Jusqu’à modification ou suppression totale |
| Réglages d’interface, thème, schéma, drapeau `prompt_seen` | Jusqu’à la désinstallation ; conservés après une déconnexion et après une suppression totale |
| État technique (cooldown) | Écrasé au prochain passage ; pas de donnée scolaire |

Hors de l’appareil :

| Destinataire | Conservation |
|---|---|
| Établissement / Pronote | Selon la politique de l’établissement ; l’app n’en fixe aucune |
| OpenRouter et fournisseurs de modèles | Selon leurs conditions et le réglage de ton compte. L’app ne peut garantir ni leur suppression, ni l’absence d’entraînement |
| GitHub | Selon la politique de GitHub, jusqu’à suppression par toi ou par les mainteneurs |
| Scraper auto-hébergé | Cookie jar local remplacé au scrape suivant, avec une sauvegarde ; pas de TTL automatique. Les logs serveur ne contiennent ni URL ni contenu |
| Application de partage choisie | Selon l’application de destination ; hors du contrôle de l’app |

## 7. Suppression, portabilité et changement de compte

### Déconnexion et session morte

La déconnexion efface la session, la liste des comptes, la clé LLM, le cache
hors-ligne, le cahier de cours, le fil du professeur, les préférences de
matières, le contenu du manuel, les pièces jointes, les photos, l’état de
lecture et le cache WebView. Elle **conserve par conception** le consentement
et l’attestation IA, l’adresse du serveur de manuels, le drapeau `prompt_seen`,
les réglages d’interface et les exports. Une purge incomplète est signalée et
interdit de publier le compte suivant.

### Changement de compte

Le changement de compte purge les mêmes données de compte, puis remplace la
session et la liste des comptes. Les exports restent, comme à la déconnexion.

### « Supprimer toutes mes données »

Cette action reprend la même purge et y ajoute le consentement et l’attestation
IA, l’adresse du serveur et les exports. La confirmation liste
l’inventaire complet et un échec partiel nomme les éléments restants. Après cette suppression, il
reste les réglages d’interface, le thème, le schéma et le drapeau `prompt_seen`
— des préférences, pas des données de compte.

### Ce qui ne peut pas être supprimé depuis l’app

- Une copie d’export déjà partagée vers un autre service : elle est hors du
  contrôle de l’app.
- Les données détenues par l’établissement, OpenRouter, GitHub ou un
  destinataire du partage : la demande doit aller à ce destinataire.
- Les journaux ou copies de sauvegarde d’un fournisseur.

La désinstallation efface les données locales de l’app ; elle n’efface pas les
copies déjà partagées.

### Portabilité

L’écran Réglages propose « Exporter mes données » : un JSON local (format
`veryslopnynotes.data-export`, schéma 1) partagé par la feuille Android. Il
contient les notes, le cahier de cours, les fiches de révision, le fil du
professeur, le manuel, les préférences de matières et l’état de lecture. Il
**exclut** le jeton de session, la clé LLM, l’adresse du serveur, l’URL source
du manuel et les identifiants de connexion. Les pièces jointes, les photos et
le cache brut ne sont pas inclus ; les fiches peuvent être exportées
séparément en PDF. Un export demandé avant une purge est proposé par l’écran de
suppression.

## 8. Mineurs

L’application s’adresse à des élèves et peut traiter des données de mineurs :
notes, absences, sanctions, messages, photos d’énoncés, éventuellement des
éléments de vie scolaire ou de santé selon ce que publie l’établissement. Elle
ne collecte ni date de naissance ni âge, ne crée pas de compte chez le projet,
n’affiche ni publicité ni profil public et ne vend rien.

- Un mineur utilise l’app avec l’accord de son représentant légal et dans le
  cadre autorisé par son établissement. L’app **ne vérifie pas l’âge déclaré**
  et ne bloque pas l’usage non-IA par un mineur non accompagné.
- Pour l’assistant IA, l’app demande avant toute clé une attestation explicite :
  avoir 18 ans ou plus, ou, si tu es mineur, disposer de l’autorisation de ton
  représentant légal et d’un compte OpenRouter géré par un adulte. Sans cette
  attestation, aucune clé ne peut être enregistrée et aucun appel IA n’est
  possible. L’attestation est déclarative : elle ne prouve pas l’âge et sa
  validation juridique reste ouverte (DEC-04).
- OpenRouter exige d’avoir au moins 18 ans au moment de la rédaction de ce
  texte. Un adulte responsable doit ouvrir le compte et gérer la clé ; ne lui
  emprunte pas sa clé sans son accord.
- Les photos peuvent contenir des visages ou des documents d’identité si tu les
  choisis. N’envoie que ce qui est nécessaire et jamais sans ton geste.
- Ne publie jamais de notes, de messages, de photo ou d’identifiant dans une
  issue GitHub. Le projet ne doit pas demander à un mineur de le faire.
- Un représentant légal peut exercer les droits sur l’appareil (export,
  suppression, retrait de la clé) et auprès de l’établissement. Pour GitHub, le
  compte est la seule identité vérifiable.

## 9. Tes droits et la CNIL

Selon le traitement, tu disposes des droits d’accès, de rectification,
d’effacement, de limitation, d’opposition, de portabilité et de retrait du
consentement. Le projet ne reçoit pas les données scolaires : une demande qui
les concerne se traite sur l’appareil, auprès de l’établissement ou auprès du
fournisseur choisi, pas par une recherche dans une base du projet.

| Droit | Où et comment l’exercer |
|---|---|
| Accès | Exporter le JSON depuis Réglages ; consulter l’établissement pour la source ; OpenRouter pour son compte ; GitHub pour les données GitHub |
| Rectification | Modifier dans l’app ce qui est local ; corriger à la source auprès de l’établissement ; GitHub pour une issue ou une pull request |
| Effacement | « Supprimer toutes mes données » ou déconnexion ; désinstaller ; supprimer un export partagé ; révoquer la clé OpenRouter ; demander à l’établissement ou à GitHub |
| Portabilité | Exporter le JSON ; exporter une fiche en PDF ; export GitHub pour les données de compte GitHub |
| Limitation / opposition | Ne pas utiliser l’IA ou le manuel ; retirer la clé ; se déconnecter ; ne pas partager d’export ; ne pas ouvrir d’issue |
| Retrait du consentement | Retirer le consentement et l’attestation dans Réglages > Assistant : l’IA est désactivée, la clé et le fil du professeur sont effacés. Les cours, les fiches et le manuel restent sur l’appareil |
| Réclamation | Autorité de contrôle compétente : la CNIL en France (<https://www.cnil.fr>), ou l’autorité de ton pays de résidence |

À ce jour, aucun canal privé dédié, aucun registre des demandes et aucun délai
de réponse ne sont publiés. C’est une lacune assumée de cette version, listée en
[section 15](#15-points-ouverts-avant-la-release-publique). Les droits ci-dessus
restent exerçables sur l’appareil et auprès des destinataires qui détiennent
les données.

## 10. Publicité, télémétrie et rapport de crash

Le code de l’app ne contient **ni SDK publicitaire, ni analytics, ni outil de
mesure d’audience, ni SDK de rapport de crash, ni identifiant d’installation**.
Aucune télémétrie n’est envoyée au projet. Le projet ne vend ni ne loue de
données.

GitHub peut journaliser les téléchargements de releases et l’activité du dépôt
selon sa propre politique ; ce n’est pas de la télémétrie embarquée dans
l’app.

## 11. Assistant IA : ce qui part, ce qui reste, et les limites

L’assistant est **facultatif**. Il ne part qu’après un accord explicite,
enregistré sur l’appareil avec la version du texte, du périmètre et de
l’attestation affichés. Sans attestation d’âge ou d’autorisation parentale,
aucune clé ne peut être enregistrée et aucun appel IA n’est possible. Un refus,
un retrait ou un enregistrement illisible laisse l’IA désactivée. L’attestation
reste sur l’appareil ; elle n’est pas envoyée à OpenRouter.

Quand tu utilises l’assistant, l’aperçu de consentement liste les catégories
envoyées à OpenRouter :

- le prompt et la consigne ;
- tes cours et tes notes ;
- les pièces jointes (texte extrait, ou image si une image est jointe) ;
- les photos que tu envoies, ré-encodées en JPEG (max. 1600 px et 2 Mo) ;
- le manuel et les pages web ajoutés comme sources ;
- l’historique du fil du professeur ;
- ta clé OpenRouter, dans l’en-tête `Authorization` ;
- le fournisseur, qui reçoit la demande et la route vers des fournisseurs de
  modèles.

Limites à connaître :

- Une réponse peut être fausse, incomplète ou inventée. Elle ne remplace ni un
  cours, ni une note, ni une appréciation, ni une décision de l’établissement.
- Une sortie de l’assistant est une donnée : elle est validée et ne déclenche
  aucun effet métier. Tu restes devant chaque envoi et chaque modification.
- OpenRouter et les fournisseurs de modèles qu’il route **peuvent conserver**
  les demandes selon leurs propres politiques. L’app ne peut garantir ni leur
  suppression, ni l’absence d’entraînement.
- Les photos passent par des endpoints ZDR sans collecte demandés par la
  requête. Selon la politique d’OpenRouter, ces endpoints ne les conservent pas
  après traitement et ne les utilisent pas pour l’entraînement, hors contenu
  signalé pour le contrôle CSAM ou obligation légale. L’app ne peut garantir
  cette politique au-delà de la configuration demandée.
- Les messages Pronote ne font pas partie des sources envoyées à l’IA.
- Chaque demande utilise tes crédits OpenRouter et peut être facturée.
- L’assistant n’est ni un service officiel de l’établissement, ni un correcteur
  officiel.

Le consentement IA est un réglage de l’appareil, pas du compte : il survit à
une déconnexion et il est effacé par « Supprimer toutes mes données ». La
version actuelle est la **version 4** : elle inclut l’attestation d’âge ou
d’autorisation parentale, la durée de vie locale de la clé et la règle de
rétention des photos. Un changement **matériel** (catégorie de données ajoutée
ou retirée, destinataire ou règle de conservation modifiée, usage élargi,
attestation ajoutée ou modifiée) incrémente cette version et redemande
l’accord et l’attestation ; l’IA reste désactivée jusque-là. Une reformulation
sans effet sur les données ne change pas la version. Un accord d’une autre
version, ou sans attestation, n’est jamais réutilisé.

## 12. Cookies et stockage local

L’app n’utilise **aucun cookie publicitaire ou de mesure d’audience** et
n’intègre pas de contenu tiers de suivi. Elle stocke ses données dans l’espace
privé Android (fichiers, `SharedPreferences`, stockage chiffré pour la session
et la clé LLM).

La WebView qui affiche l’interface charge des assets locaux. Elle conserve dans
son stockage local le thème, le schéma, l’état de lecture et l’état de session
de l’interface. À la déconnexion, l’état de lecture, le cache et les cookies de
la WebView sont vidés ; le thème et le schéma restent. Les réglages d’interface
restent aussi après « Supprimer toutes mes données ».

Le scraper de manuels facultatif utilise, sur le serveur que tu configures, un
cookie jar local pour les sites sources. Ce fichier est en `0600` dans un
répertoire `0700`, remplacé au scrape suivant, avec une sauvegarde et sans TTL
automatique. Il ne contient pas la session Pronote.

## 13. Sécurité

- La session Pronote et la clé LLM sont chiffrées au repos par le Keystore
  Android (AES256-GCM maître, AES256-SIV/GCM pour les préférences). Un Keystore
  indisponible échoue fermé et le signale ; aucun secret n’est écrit en clair.
- Les autres données locales sont en clair dans l’espace privé de l’app. Leur
  protection repose sur le bac à sable Android, pas sur un chiffrement de
  fichier : un appareil déverrouillé, rooté ou instrumenté peut les lire.
- Aucune sauvegarde cloud ni transfert appareil-à-appareil : `allowBackup` est
  désactivé et les règles d’extraction excluent les données de l’app.
- TLS est obligatoire vers Pronote, OpenRouter et un scraper distant. Le clair
  est réservé à la boucle locale du build debug ; la release refuse tout clair.
- `FLAG_SECURE` est actif en release pour l’aperçu des récents et les captures.
  Le build debug en est exempté.
- Les journaux, erreurs et `toString()` ne contiennent ni clé, ni jeton, ni
  identifiant de session.
- Aucune sécurité n’est absolue. Un appareil compromis, une application
  malveillante avec les droits root ou un destinataire choisi par toi peuvent
  lire les données.

## 14. Modification de cette notice

La version applicable est celle publiée avec la release que tu utilises. Une
modification **matérielle** de cette notice (catégorie de données, finalité,
base légale, destinataire, transfert ou durée de conservation) incrémente sa
version et est signalée dans les notes de release. Une reformulation sans effet
sur les données ne change pas la version.

Pour l’IA, le mécanisme de re-consentement est distinct et décrit en
[section 11](#11-assistant-ia--ce-qui-part-ce-qui-reste-et-les-limites) : un
changement matériel du texte ou du périmètre incrémente la version du
consentement et redemande l’accord. Aucun accord d’une version antérieure n’est
réutilisé.

## 15. Points ouverts avant la release publique

Ces points ne changent pas ce que le code fait ; ils changent la qualification
juridique, le contact ou la portée de la notice. Ils doivent être tranchés avec
un conseil et, pour certains, avec l’établissement.

1. **Entité et responsable.** Quelle entité juridique édite le projet, où est-
   elle établie, et quel rôle lui attribuer pour le traitement local ? Le dépôt
   ne nomme ni société, ni adresse, ni représentant (issue
   [#831](https://github.com/iguanacucumber/veryslopnynotes/issues/831)).
2. **Contact vie privée.** Quelle adresse ou quel canal privé pour les demandes,
   et qui y répond ? Aucun contact ne doit être inventé.
3. **Bases légales.** Valider les bases proposées, en particulier pour les
   données scolaires, les motifs d’absence ou de sanction, les photos et les
   prompts IA. La base peut dépendre de l’établissement.
4. **Rôle d’OpenRouter.** Responsable indépendant, sous-traitant de
   l’utilisateur ou sous-traitant du projet ? Conditions, garanties de
   transfert, rétention et usage des modèles gratuits à vérifier.
5. **Rôle de GitHub.** DPA, sous-traitance, transferts et durée de conservation
   des issues, pull requests et logs de release.
6. **Mineurs.** L’attestation 18+ ou autorisation parentale est requise pour
   l’IA (version 4). Sa validation juridique, la règle d’éligibilité et la
   mention d’âge sur le store restent ouvertes (DEC-04, issue
   [#829](https://github.com/iguanacucumber/veryslopnynotes/issues/829)).
7. **Registre et délai des demandes.** Format, durée et responsable du registre
   minimal des demandes, sans donnée scolaire.
8. **Durée de vie de la clé LLM.** Le code l’efface à la déconnexion, au
   changement de compte et à la mort de session. Cette règle conservatrice
   convient-elle, ou une clé par appareil peut-elle survivre à la session avec
   un verrou applicatif (DEC-04, issue
   [#906](https://github.com/iguanacucumber/veryslopnynotes/issues/906)) ?
9. **Exports.** La conservation d’un export après déconnexion ou changement de
   compte est une exception du code. Est-elle acceptable, ou faut-il la purger
   avec le compte ?
10. **AIPD.** Une analyse d’impact est-elle requise ? Qui la porte : projet,
    établissement, ou les deux ?
11. **Scraper.** Responsabilités de l’opérateur d’une instance partagée,
    conditions des sites sources, `robots.txt` et attribution
    ([`docs/legal/manual-scraper.md`](docs/legal/manual-scraper.md)).
12. **Publication dans l’app.** Cette notice est le fichier de référence. Son
    rendu dans l’écran À propos / Confidentialité est suivi séparément (issue
    [#847](https://github.com/iguanacucumber/veryslopnynotes/issues/847)) ; il
    doit afficher la même version.
