# Changelog

Format : [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/), versions
[SemVer](https://semver.org/lang/fr/). Aucune release n'est publiée : la version
en développement est `0.1.0` (`versionName` Android), et `[Unreleased]` devient
la section `0.1.0` le jour du tag.

## [Unreleased]

### Ajouté

- Protocole de dogfood interne (`docs/DOGFOOD.md`) : 14 jours sur un téléphone
  réel, données de démonstration et synthétiques uniquement, journal quotidien,
  triage P0/P1, règle d'arrêt et checklist signée ; aucun résultat ni
  participant revendiqué (#965).
- Client Android Pronote : QR + PIN lus dans l'app, session chiffrée sur
  l'appareil et purgée à la déconnexion.
- Interface React embarquée, hors-ligne d'abord : cache + TTL par ressource,
  cache affiché avant le réseau.
- Assistant IA local (clé OpenRouter chiffrée) : contenu externe délimité et
  marqué non fiable avant chaque prompt.
- Scraper de manuels facultatif, HTTPS obligatoire, sans authentification.
- Taille du texte réglable (100/125/150 %) et suivi du réglage Android jusqu'à 200 %.
- À propos : versionName et versionCode, empreinte SHA-256 du certificat installé
  lue localement, tag source et notes de version, sans réseau.
- Export local et portable (JSON versionné, manifeste) des notes, du cahier de
  cours, des fiches de révision, du fil du professeur, du manuel mémorisé, des
  préférences matière et de l’état de lecture ; partage Android, sans jeton de
  session, clé LLM ni adresse de serveur.
- Avant une déconnexion, un changement de compte ou une suppression totale,
  l'export des notes, fiches de révision et conversations du professeur est
  proposé, avec la perte définitive expliquée ; continuer sans exporter reste
  possible et l'échec d'export est affiché.
- CI : APK release construit avec une clé éphémère, signature et mapping R8
  vérifiés, APK + mapping en artefact court ; workflow réutilisable par un tag.
- CI : release sur tag `vX.Y.Z` — build réutilisé, signature réelle depuis
  l'environnement protégé `release`, `SHA256SUMS`, archive source GPL et GitHub
  Release ; dry-run manuel sans publication, échec si un secret manque.
- CI : budget de taille APK — taille mesurée sur l'artefact release et
  conservée, dépassement du plafond = échec.
- CI : canal bêta sur tag `vX.Y.Z-beta.N` — pré-release GitHub avec les mêmes
  gates de signature, checksums et source ; `versionCode` monotone, bêta →
  finale sans désinstallation.
- Smoke CI sur émulateur : APK debug installé, appairage démo, accueil vérifié,
  captures et logcat en artefact (non bloquant tant que non stable).
- Tests instrumentés sur émulateur : clé chiffrée, Keystore dégradé puis sain,
  purge complète d'un compte, fichier corrompu et `FLAG_SECURE` (non bloquant
  tant que non stable).
- « Supprimer toutes mes données » : confirmation listant session, cache,
  artefacts hors-ligne, téléchargements, photos, manuel, comptes, WebView,
  état de lecture, clé de l'assistant et serveur, puis purge orchestrée avec
  échec partiel affiché.
- Notices de licence tierces complètes (`THIRD_PARTY_NOTICES.md`) et textes
  intégraux dans `web/public/licenses/`, versions liées à `bun.lock` et au
  catalogue Gradle.
- Conditions d’utilisation (`TERMS.md`) : usage personnel, autorisation
  scolaire, limites de l’IA, intégrité académique, âge, garanties et
  responsabilité ; revue juridique en attente.
- Notice de confidentialité (`PRIVACY.md`), version 1 : responsable et contact,
  catégories, finalités, bases proposées, destinataires, transferts, rétention,
  suppression et portabilité, mineurs, droits et CNIL, absence de publicité et
  de télémétrie, limites de l’IA, stockage local et sécurité ; points ouverts
  signalés avant la release publique.
- Consentement IA versionné : un changement matériel du texte ou du périmètre
  redemande l’accord ; un accord d’une autre version, un refus ou un
  enregistrement illisible ne réactive jamais l’IA.
- Étiquette visible « IA — à vérifier » sur chaque sortie de l'assistant (aide
  devoirs, fiches de révision, professeur, exercices, brouillon de photo),
  conservée à la copie et dans l'export PDF ; action « Signaler » réutilisant le
  diagnostic borné, sans donnée scolaire ni envoi automatique.
- Écrans À propos, Confidentialité, Conditions et Licences, hors ligne et
  atteignables depuis Réglages : version lue au pont, source et contacts GitHub,
  non-affiliation, GPL-3.0-only, notices de tiers et textes intégraux embarqués
  dans l’APK.
- Attestation d’âge ou d’autorisation parentale avant la clé IA : l’écran
  explique 18 ans ou plus, ou représentant légal gérant le compte OpenRouter ;
  sans attestation, aucune clé ni aucun appel, et le retrait avec le
  consentement efface clé et fil. Revue juridique en attente (DEC-04).
- Nom public et `applicationId` actés (`veryslopnynotes`,
  `fr.veryslopnynotes.app`) : vérifications GitHub, Play, F-Droid, DNS/RDAP et
  recherche web sans conflit public détecté, revue de marque formelle encore
  requise (`docs/legal/NAME.md`, #826).
- Dossier de validation juridique et vie privée (`docs/legal/SIGNOFF.md`) :
  sept sujets avec constat vérifiable, questions exactes au conseil, preuves,
  blocs de signature vides et procédure d'archive ; tous les statuts restent
  `pending`, aucune signature n'est revendiquée (#976).
- Dossier de décision sur le responsable du traitement
  (`docs/legal/CONTROLLER.md`) : options personne physique, association ou
  société, champs à décider, représentant UE et DPO, texte de remplacement de
  la notice ; aucune identité n'est inventée (#831).
- Dérogations de release (`docs/RELEASE-WAIVERS.md`) : approbation à deux
  signatures humaines, champs risque/atténuation/propriétaire/expiration,
  interdiction de déroger un `tier:L`, la sécurité, une perte de données ou une
  revendication de confidentialité ; propositions `to-waive` marquées non
  approuvées et blocs de signature vides (#972).
- Bêta privée : kit participant (`docs/BETA.md`) pour rejoindre une pré-release
  `vX.Y.Z-beta.N`, vérifier l'APK signé, mettre à jour vers la finale, donner un
  retour sans donnée scolaire et suivre le triage `known-issues` ; modèle
  d'issue « Retour bêta » (#969).
- Voie de relicence MIT → GPL-3.0-only documentée : texte MIT, ayants droit
  relevés dans Git, politique DCO et provenance Papillon en cours d'inventaire
  (`docs/legal/RELICENSING.md`, #827) ; l'avis du conseil reste suivi en #976.
- Kit d'annonce v1.0.0 (`docs/RELEASE-ANNOUNCEMENT.md`) : brouillon publiable,
  modèle de notes GitHub, limites réelles (rappels, IA, compte/QR, télémétrie,
  non-affiliation), chemins d'installation/vérification/mise à jour,
  placeholders de tag/date/SHA-256/empreinte et conditions de non-annonce ;
  aucun tag, checksum ni release inventé (#978).

### Modifié

- Kit d'annonce v1.0.0 relié aux preuves de release existantes : checklist,
  dérogations, dossier juridique, bêta et dogfood ; les gates humains restants
  (#919, #976, #972, #969, #965) et les champs de signature vides sont nommés
  sans inventer tag, date, checksum, empreinte ni URL (#978).
- Règle d’éligibilité de l’assistant IA consignée (ADR-009) : consentement
  versionné, attestation 18+ ou autorisation parentale et clé fournie par
  l’utilisateur, toutes trois requises ; IA désactivée sinon, retrait qui
  efface clé et fil, re-consentement sur changement matériel. L’arbitrage du
  conseil entre 18 ans stricts et autorisation parentale reste en attente.
- README réécrit pour un visiteur GitHub : installation et vérification de
  l'APK signé (SHA-256, `apksigner`), mises à jour, perte de données à la
  désinstallation, compatibilité, IA et vie privée, support et sécurité,
  non-affiliation, licence et démarrage développeur (#948).
- Durée de vie de la clé IA fixée et affichée : elle reste chiffrée après un
  redémarrage tant que la session est active, puis part à la déconnexion, au
  changement de compte, à la mort de session ou avec « Supprimer toutes mes
  données ». Le consentement IA passe en version 4 et redemande l’accord.
- Copie de confidentialité corrigée : les promesses « aucun entraînement »,
  « reste sur ton téléphone » et « photo supprimée » nomment désormais le
  destinataire (OpenRouter) et la condition (geste, copie locale) ; notice,
  carte des données et interface alignées sur le consentement IA version 4.
- Licence du dépôt actée en GPL-3.0-only (ADR-008) : contributions sous la
  même licence, source correspondante publiée et dérivés Papillon crédités.
- Identité visuelle propre : langage de « copie » retiré, icône et marque de
  barre supérieure remplacées, aucun logo ni capture de Papillon livré,
  non-affiliation nommée et attribution GPL conservée (#843).
- Statut MIT antérieur documenté : relicence au commit `2def868` (2026-11-04),
  aucun APK ni binaire public avant, droits MIT des copies déjà livrées
  préservés (#844).
- Version Android dérivée du tag git `vX.Y.Z` : `versionName` et `versionCode`
  monotone, repli déterministe `0.1.0`/`1` sans tag.
- Release : le parcours public ne produit plus que l'APK sideload signé ;
  `make buildRelApk` n'embarque plus de bundle de publication.
- Fontes SN Pro sous-ensemblées en WOFF2 (graisses réellement utilisées,
  préchargement) et budget gzip vérifié à chaque build.
- Santé de release documentée sans télémétrie : signaux store, CI, issues et
  empreintes, seuils de pause/retrait et suivi d'incident.
- Installation et mises à jour documentées : Obtainium facultatif depuis les
  releases GitHub, mise à jour manuelle de l'APK et continuité de signature.
- Migration debug → release documentée : certificats différents, désinstallation
  obligatoire et données locales effacées, canal bêta réservé aux builds signés
  en release.
- Runbooks d'incident : rupture de protocole, mauvaise release, clé exposée et
  incompatibilité d'établissement, avec triage, communication, correctif et
  retrait.
- `LICENSE` remplacé par le texte GPL-3.0 canonique, `package.json` déclaré
  GPL-3.0-only et README/docs alignés.
- `package.json` identifie le dépôt GitHub réel (`repository`) en plus de la
  licence SPDX ; `docs/REPOSITORY.md` documente licence et URL.
- Modèle vision remplacé par un modèle payant servi par des endpoints ZDR sans
  collecte (`qwen/qwen3-vl-30b-a3b-instruct`), avec repli explicite sans autre
  modèle, avertissement de coût et rétention des photos divulguée.

### Sécurité

- Protection GitHub documentée et durcie : ruleset `main — gate obligatoire`
  conservé, environnement `release` avec relecteur obligatoire et tags `v*`,
  actions épinglées par SHA et allowlist limitée aux actions utilisées.
- Scraper : sandbox Chromium ACTIF dans l'image, confiné par un profil seccomp
  étroit (namespaces user/PID/net seulement) et une commande Docker sans
  capabilities.
- Release sans adresse de serveur par défaut : le défaut émulateur et le HTTP
  en clair restent confinés au variant debug (SEC-01).
- Liens profonds : schéma privé `veryslopnynotes` limité au debug, aucun
  `VIEW`/`BROWSABLE` ni App Link dans la release (SEC-10).
- Démo de l'éditeur limitée au debug (`DEMO_MODE`) : bouton absent en release,
  `pairing.pairDemo` refusée par le pont, session de démo non restaurée et pont
  factice web exclu du bundle de production (DAT-06).
- Contrôle CI des licences : inventaire Bun + Gradle, allowlist explicite,
  échec sur licence inconnue ou incompatible ; MPL-2.0 limitée aux outils
  build/test non distribués (`lightningcss`, `axe-core`).
