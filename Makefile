.PHONY: check check-run check-fast watch lint audit typecheck unit architecture contracts android-compile web web-typecheck web-build web-test web-smoke runServer buildDebugApk buildRelApk updateApkToPhone build shot papillonRef

# Découverte JDK/SDK partagée par android-compile, buildDebugApk, buildRelApk :
# une seule implémentation, sinon une des trois finit par oublier la borne 17-21.
ANDROID_ENV = . agents/runtime/android-env.sh

# Le gate de merge : 9 étapes, TOUJOURS. `CHECK_HARNESS=` vide l'opt-in
# même si le shell en exporte un : personne ne rétrécit le gate par
# l'environnement (agents/ship.sh hérite de l'env du shell). Un `CHECK_TARGETS`
# resté dans l'environnement est REFUSÉ et signalé par check.ts.
#
# `ALLOW_SKIP_ANDROID=` : même traitement — elle lançait un SKIP de la
# compilation Kotlin, donc le gate pouvait être vert SANS résolution de
# symbole (le filet unique qui la voit).
#
# `REQUIRE_KOTLIN_TOOLCHAIN=1` : le gate exige la chaîne Kotlin (`kotlinc` +
# `java`). Sans elle, toute la parité TS <-> Kotlin SAUTE et le gate est vert
# sans une ligne de production Kotlin exécutée (I4/I5/I6/I12/I14/I16/I18/
# I19/I20/I21 non vérifiées) — un faux vert. L'itération (`check-fast`, `watch`)
# garde le SKIP bruyant : le gate est strict, la boucle reste rapide.
#
# `MAKEFLAGS=` : `-i` (ou `MAKEFLAGS=-i`) fait IGNORER l'échec d'une RECETTE
# par make — un gate ROUGE devenait VERT (#523). Le harnais repart d'un
# environnement sans options make, et neutralise la même variable pour SES
# make enfants (une étape par enfant).
#
# LE GATE EST EN DEUX PHASES (`check-run` puis `check`). `-i` ignore l'échec
# d'une recette, mais PAS une erreur de MAKE : `check-run` lance le harnais
# et ÉCRIT son code de sortie, `check` REFUSE tout code ≠ 0 par `$(error)`.
# Donc `MAKEFLAGS=-i make check` sort NON-ZÉRO si le gate est rouge, et
# `agents/ship.sh` (en `set -e`) s'arrête avant d'écrire « `make check` : OK ».
#
# Le statut est EFFACÉ avant chaque run : un statut resté d'un gate VERT ne
# peut pas valider un gate qui n'a pas tourné (pas de statut = ÉCHEC).
GATE_STATUS = $(CURDIR)/node_modules/.cache/gate-status

# Phase 1 : le harnais tourne, son code de sortie est ÉCRIT. La recette se
# termine par `echo` (succès) : make n'y voit aucun échec, mais le code est
# là, et c'est lui qui décide (phase 2).
check-run:
	@mkdir -p $(dir $(GATE_STATUS)); rm -f $(GATE_STATUS); \
	 MAKEFLAGS= CHECK_HARNESS= ALLOW_SKIP_ANDROID= REQUIRE_KOTLIN_TOOLCHAIN=1 bun run agents/runtime/check.ts; \
	 echo $$? > $(GATE_STATUS)

# Phase 2 : le VERDICT. `$(error)` est une erreur de MAKE, pas de recette :
# `-i` ne l'ignore pas. Sans statut, le gate n'A PAS TOURNÉ — c'est un
# ÉCHEC, jamais un vert.
check: check-run
	$(if $(wildcard $(GATE_STATUS)),,$(error gate NON EXÉCUTÉ : aucun statut — le gate n'a pas tourné))
	$(if $(filter 0,$(shell cat $(GATE_STATUS))),,$(error gate ROUGE : code de sortie $(shell cat $(GATE_STATUS))))

# Boucle interne : tout sauf la compilation Gradle (~2,1 s à chaud). Le build
# Vite est inclus (tiré par `architecture`, cf. plus bas) ; ce n'est PAS le
# gate de merge — `make check` ajoute android-compile, le seul contrôle des
# symboles Kotlin.
# CHECK_HARNESS=1 : opt-in EXPLICITE qui autorise `check.ts` à remplacer sa
# liste d'étapes par `CHECK_TARGETS` (usage interne du harnais). Sans lui,
# `CHECK_TARGETS` est refusé et les étapes par défaut s'imposent (#368).
check-fast:
	CHECK_HARNESS=1 CHECK_TARGETS="lint typecheck unit architecture contracts web-typecheck web-test" bun run agents/runtime/check.ts

# TDD : relance les tests au moindre changement. `make watch T=tests/unit/foo.test.ts`
# cible un fichier ; par défaut unitaires + web (~7 s, SÉQUENTIEL : `--parallel`
# casserait la boucle, voir #471). Pas de `bun test --changed` :
# les scans d'architecture lisent les sources, pas les imports, donc ils seraient ratés.
watch:
	bun test --watch $(if $(T),$(T),tests/unit tests/web)

lint:
	bun run agents/runtime/check-secrets.ts

# Audit des dépendances (AGENTS.md : toute nouvelle dépendance doit être
# épinglée, auditée avec `bun audit`, compatible MIT). L'audit demande le
# réseau : un registre injoignable fait ÉCHOUER l'étape (on ne déclare pas
# « aucune vulnérabilité » quand on n'a rien demandé).
audit:
	bun audit

typecheck:
	bun run typecheck

# Frontend React : typecheck + build local + tests. Le build écrit dans
# `android/app/src/main/assets/web/` (gitignoré) ; Gradle le refait à chaque
# `preBuild` (c'est l'interface de l'APK, ADR-004).
web-typecheck:
	bun run typecheck:web

web-build:
	bun run build:web
# #654 : le gate n'appelle plus web-build comme ÉTAPE autonome — `architecture`
# le tire (ci-dessus) et web-mock vérifie l'artefact réellement produit.

web-test:
	bun test tests/web tests/architecture/web.test.ts

web: web-typecheck web-test web-build

# Smoke navigateur du frontend (Chromium requis). Hors `make check`.
web-smoke: web-build
	bun run agents/runtime/web-smoke.ts

# --parallel : les 37 fichiers sur les 16 cœurs, un isolat par fichier (6,6 s →
# 4,1 s). Les étapes lourdes sont des SOUS-PROCESSUS (shot.sh, kotlinc, java)
# : c'est eux qui coûtaient, pas le runner — d'où le shim `sleep` du harnais.
unit:
	bun test tests/unit --parallel

# #654 : le bundle Vite est construit UNE fois par le gate. `architecture`
# tire `web-build` AVANT `architecture-test` : le test web-mock vérifie
# l'ARTEFACT RÉEL qui part dans l'APK (`android/app/src/main/assets/web/`),
# pas une copie rejouée dans un dossier jetable — un seul Vite par `make
# check`, les autres étapes restent en parallèle. Seul ce couple est
# sérialisé : le bundle doit être complet avant d'être contrôlé.
architecture: web-build architecture-test

architecture-test:
	bun run agents/runtime/check-architecture.ts
	bun test tests/architecture --parallel

contracts:
	bun test tests/contracts --parallel

# Compile Kotlin RÉELLE (`android-compile`) — le SEUL filet qui voit une
# résolution de symbole, un import manquant ou une surcharge ambiguë : les
# miroirs TS ne les voient pas (piège réel : `MAX_LABEL_CHARS` non
# qualifié dans core/Homework.kt, invisible côté TS). La MÊME invocation lance
# `:app:lintDebug` (#627) : Android Lint passe dans le gate, sans daemon
# Gradle supplémentaire (une seule JVM pour compile + lint).
#
# Outillage absent = ÉCHEC, pas un SKIP silencieux (#368) : la compilation
# Kotlin est la SEULE vérification du gate qui résout les symboles, donc un
# `make check` vert sans elle est un faux vert. ALLOW_SKIP_ANDROID=1 reste
# l'opt-in EXPLICITE pour assumer ce SKIP hors merge (poste sans outillage) —
# et le SKIP reste bruyant. Les commandes APK (buildDebugApk/buildRelApk)
# échouent de la même façon : un APK demandé en silence n'en est pas un.
#
# La découverte du JDK/SDK passe par agents/runtime/android-env.sh (borne
# 17-21) — une seule implémentation, cf. ANDROID_ENV plus haut.
#
# --offline d'ABORD : versions figées + cache local = la configuration ne doit
# rien au réseau (95 s perdus sinon ici : le JVM ne reçoit jamais la réponse de
# dl.google.com, 3 × 28 s de SocketTimeout pendant que curl y répond en 0,9 s —
# pb d'environnement JVM/réseau, cf. docs/HUMAN_INPUTS.md). Cache froid = échec
# explicite puis repli EN LIGNE : jamais de blocage silencieux.
#
# La CI met les dépendances ET les transformations en cache (cf.
# .github/workflows/ci.yml) : sa jambe `--offline` passe donc du premier coup
# (139 s à froid → 28 s), et le build cache Gradle en est VOLONTAIREMENT
# absent — la compilation doit TOURNER, pas être servie par un cache.
#
# -x buildWebUi : `:app:compileDebugKotlin` tire `preBuild`, donc Gradle lançait
# un Vite complet. Le gate construit déjà le bundle (`architecture` tire
# `web-build`) : deux Vite concurrents sur le même outDir (emptyOutDir)
# pouvaient se marcher dessus.
android-compile:
	@$(ANDROID_ENV); \
	jdk=$$(android_jdk); sdk=$$(android_sdk); \
	if [ -z "$$jdk" ] || [ -z "$$sdk" ]; then \
	  echo "android-compile : outillage ABSENT (JDK=$${jdk:-aucun}, SDK=$${sdk:-aucun}) — la compile Kotlin n'a PAS tourné."; \
	  if [ "$${ALLOW_SKIP_ANDROID:-0}" = "1" ]; then \
	    echo "android-compile SKIP (ALLOW_SKIP_ANDROID=1) : compile Kotlin NON vérifiée."; \
	  else \
	    echo "  ÉCHEC : le gate exige la compilation Kotlin (seul filet qui résout les symboles)."; \
	    echo "  ALLOW_SKIP_ANDROID=1 pour assumer explicitement ce SKIP (usage hors merge)."; \
	    exit 1; \
	  fi; \
	else \
	  echo "android-compile : JDK $$jdk, SDK $$sdk"; \
	  cd android && { \
	    JAVA_HOME="$$jdk" ANDROID_HOME="$$sdk" ./gradlew --offline --console=plain -x buildWebUi \
	      :core:compileDebugKotlin :data:compileDebugKotlin :pronote:compileDebugKotlin :app:compileDebugKotlin :app:lintDebug || \
	    { echo "android-compile : REPLI EN LIGNE (cache Gradle incomplet — hors-ligne refusé)."; \
	      JAVA_HOME="$$jdk" ANDROID_HOME="$$sdk" ./gradlew --console=plain -x buildWebUi \
	        :core:compileDebugKotlin :data:compileDebugKotlin :pronote:compileDebugKotlin :app:compileDebugKotlin :app:lintDebug; }; \
	  }; \
	fi

# Capture d'écran sur téléphone réel (#133) : `make shot ROUTE=grades`.
# shot.sh construit l'APK debug AVANT toute capture (#151 : Gradle est l'autorité,
# une comparaison de mtimes annonçait « à jour » sur un APK plus vieux que les
# sources), l'installe si l'appareil ne fait pas tourner cette empreinte, ouvre
# `veryslopnynotes://<route>` (deep link DU VARIANT DEBUG seulement) et dépose
# la capture dans shots/<date-UTC>/. Sort en erreur si l'appareil manque, si
# l'écran rend noir ou si l'app atterrit ailleurs que sur la route demandée :
# une capture non vérifiée ne sert à rien.
# `make shot ROUTE=index SHOT_ARGS="--theme dark"` force le thème de l'APPAREIL
# avant la capture (#179 : le pas d'encre de matière est sensible au thème, donc la
# recette sombre doit être rejouable) ; le nom du fichier porte le thème.
# `make shot ROUTE=index SHOT_ARGS=--no-build`
# recapture le MÊME APK sans reconstruire (reprise d'une capture ratée ; le
# script prévient bruyamment que la capture peut être périmée). La découverte
# JDK/SDK est celle d'android-env.sh, comme les autres cibles Gradle.
shot:
	@$(ANDROID_ENV); \
	jdk=$$(android_jdk); sdk=$$(android_sdk); \
	if [ -z "$$jdk" ] || [ -z "$$sdk" ]; then \
	  echo "shot : outillage absent (JDK=$${jdk:-aucun}, SDK=$${sdk:-aucun})."; \
	  android_toolchain_hint; exit 1; \
	fi; \
	if [ -z "$(ROUTE)" ]; then \
	  echo "usage : make shot ROUTE=<route>   (index, calendar, grades, tasks, profile, ...)"; exit 1; \
	fi; \
	JAVA_HOME="$$jdk" ANDROID_HOME="$$sdk" agents/runtime/shot.sh $(ROUTE) $(SHOT_ARGS)

# APK debug : clé de signature de debug (hors repo, générée par Gradle).
# `preBuild` lance `bun run build:web` : l'APK embarque toujours web/ à jour.
buildDebugApk:
	@$(ANDROID_ENV); \
	jdk=$$(android_jdk); sdk=$$(android_sdk); \
	if [ -z "$$jdk" ] || [ -z "$$sdk" ]; then \
	  echo "buildDebugApk : outillage absent (JDK=$${jdk:-aucun}, SDK=$${sdk:-aucun})."; \
	  android_toolchain_hint; exit 1; \
	fi; \
	cd android && JAVA_HOME="$$jdk" ANDROID_HOME="$$sdk" ./gradlew --console=plain assembleDebug && \
	echo "APK debug : android/app/build/outputs/apk/debug/app-debug.apk"

# Mise à jour du téléphone de dev : construit l'APK debug (même cible que
# buildDebugApk, donc même découverte JDK/SDK) puis l'installe avec `adb install
# -r` : les données de l'app — session appairée comprise — sont CONSERVÉES.
# Un seul appareil prêt, sinon `ANDROID_SERIAL=<série>` lève l'ambiguïté.
# Jamais de désinstallation : une signature différente échoue bruyamment plutôt
# que d'effacer la session (même règle que shot.sh).
updateApkToPhone: buildDebugApk
	@command -v adb >/dev/null 2>&1 || { \
	  echo "updateApkToPhone : « adb » absent du PATH — APK construit, rien installé."; \
	  exit 1; \
	}
	@serial="$${ANDROID_SERIAL:-}"; \
	if [ -z "$$serial" ]; then \
	  ready=$$(adb devices | sed -n 's/^\([^\t]*\)\tdevice$$/\1/p'); \
	  n=$$(printf '%s\n' "$$ready" | grep -c . || true); \
	  if [ "$$n" -ne 1 ]; then \
	    echo "updateApkToPhone : $$n appareil(s) prêt(s) — brancher un seul téléphone ou poser ANDROID_SERIAL=<série>. Rien installé."; \
	    exit 1; \
	  fi; \
	  serial=$$ready; \
	fi; \
	echo "updateApkToPhone : installation sur $$serial (données conservées)…"; \
	adb -s "$$serial" install -r android/app/build/outputs/apk/debug/app-debug.apk

# APK release : signé custom SI les credentials de signature sont dans
# l'environnement (STORE_FILE + mots de passe/alias — JAMAIS dans le repo,
# voir docs/RELEASE.md), signé debug sinon (#297 : APK public sideload
# installable sans cert custom). Gradle ne le dit pas toujours : le rappel
# ci-dessous est obligatoire pour que personne ne croie avoir un APK store.
# Produit AUSSI l'AAB Play Store (#301, même buildType release = mêmes
# règles de signature) : un seul build, deux artefacts à distribuer.
buildRelApk:
	@$(ANDROID_ENV); \
	jdk=$$(android_jdk); sdk=$$(android_sdk); \
	if [ -z "$$jdk" ] || [ -z "$$sdk" ]; then \
	  echo "buildRelApk : outillage absent (JDK=$${jdk:-aucun}, SDK=$${sdk:-aucun})."; \
	  android_toolchain_hint; exit 1; \
	fi; \
	cd android && JAVA_HOME="$$jdk" ANDROID_HOME="$$sdk" ./gradlew --console=plain assembleRelease bundleRelease && \
	echo "APK release : android/app/build/outputs/apk/release/ (signé custom si STORE_FILE présent, sinon signé debug #297)" && \
	echo "AAB release : android/app/build/outputs/bundle/release/app-release.aab (Play : upload key custom recommandée)"

# Scraper manuels (#209) : HTTPS (l'app Android refuse le clairtext hors
# émulateur, cf. android/app/src/main/res/xml/network_security_config.xml).
# SANS auth (décision utilisateur du 2026-10-11, risque accepté documenté dans
# server/infrastructure/http.ts) : le process ne sert QUE GET /v1/health +
# POST /v1/manuals/scrape. Plateforme + URL de depart injectees par
# l'appelant dans le corps, jamais en env ni commites ; les identifiants du
# portail sont REFUSES (#526 : le scraper ne s'authentifie pas, la session est
# son cookie jar). Le certificat auto-signé est généré HORS du
# dépôt et seulement s'il manque (agents/runtime/dev-tls.sh) ; TLS_CERT_FILE /
# TLS_KEY_FILE fournies par ailleurs (mkcert, Let's Encrypt) sont respectées
# telles quelles.
#
# `&&` ET NON `;` (#421) : un point-virgule laissait l'exécution CONTINUER
# quand la préparation TLS échouait (script déplacé, `dev_tls` en échec) —
# donc le serveur démarrait SANS TLS_CERT_FILE/TLS_KEY_FILE, c'est-à-dire en
# HTTP (server/infrastructure/http.ts retombe sur HTTP si les variables TLS
# manquent). Un service sans auth (I8) affiché comme un « succès » en clair :
# le pire des deux mondes. Ici, un échec de préparation ARRÊTE le lancement.
#
# PORT/HOST : surchargeables DEPUIS L'ENVIRONNEMENT (`PORT=9090 make
# runServer`), pas une recette en dur (#418). HOST par défaut sur la boucle
# locale (#421) : le scraper est sans auth (I8), donc pas d'écoute sur toutes
# les interfaces sans demande explicite. Pour joindre le scraper depuis un
# téléphone : `make runServer HOST=0.0.0.0` (réseau de confiance).
runServer:
	@. agents/runtime/dev-tls.sh && dev_tls && \
	PORT="$${PORT:-8080}" HOST="$${HOST:-127.0.0.1}" bun run server/infrastructure/http.ts

# Frames de RÉFÉRENCE Papillon (`make papillonRef`) : les démonstrations
# publiques de l'application de référence, rechargées depuis papillon.bzh.
# Réseau = échec bruyant, et RIEN de tout ça n'est requis par `make check` :
# une référence unavailable n'a pas à faire tomber une vérification locale.
papillonRef:
	agents/runtime/papillon-ref.sh

# Image serveur (#209) + scan de secrets. Le build Docker ne se MASQUE plus
# (#418) : le daemon absent est un SKIP BRUYANT (poste sans Docker), mais un
# build EN ÉCHEC est un ÉCHEC de la cible — avant, le `|| echo` avalait
# TOUTE erreur (Dockerfile cassé, lockfile manquant, OOM) et l'image `:local`
# d'un build précédent était réutilisée puis testée comme neuve.
build:
	bun run agents/runtime/check-secrets.ts
	@if ! command -v docker >/dev/null 2>&1; then \
	  echo "build : « docker » absent du PATH — image serveur NON construite (SKIP explicite)."; \
	elif ! docker info >/dev/null 2>&1; then \
	  echo "build : daemon Docker ABSENT ou inaccessible — image serveur NON construite (SKIP explicite)."; \
	else \
	  docker build -t veryslopnynotes-server:local -f Dockerfile.server . || { \
	    echo "build : build Docker EN ÉCHEC — l'image veryslopnynotes-server:local"; \
	    echo "  n'a PAS été reconstruite : l'image d'un build précédent ne compte pas."; \
	    exit 1; }; \
	fi
	@if [ -d android/app ]; then echo "APK : make buildDebugApk / make buildRelApk (custom hors repo, repli debug #297)"; fi
