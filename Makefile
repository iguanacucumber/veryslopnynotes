.PHONY: check check-fast watch lint typecheck unit architecture contracts check-kotlin android-compile web web-typecheck web-build web-test web-smoke runServer buildDebugApk buildRelApk updateApkToPhone build shot papillonRef

# Découverte JDK/SDK partagée par android-compile, buildDebugApk, buildRelApk :
# une seule implémentation, sinon une des trois finit par oublier la borne 17-21.
ANDROID_ENV = . agents/runtime/android-env.sh

check:
	bun run agents/runtime/check.ts

# Boucle interne : tout sauf la compilation Gradle (~2,1 s à chaud). Le build
# Vite est inclus ; ce n'est PAS le gate de merge — `make check` ajoute
# android-compile, le seul contrôle des symboles Kotlin.
check-fast:
	CHECK_TARGETS="lint typecheck unit architecture contracts check-kotlin web-typecheck web-test web-build" bun run agents/runtime/check.ts

# TDD : relance les tests au moindre changement. `make watch T=tests/unit/foo.test.ts`
# cible un fichier ; par défaut unitaires + web (~2,1 s). Pas de `bun test --changed` :
# les scans d'architecture lisent les sources, pas les imports, donc ils seraient ratés.
watch:
	bun test --watch $(if $(T),$(T),tests/unit tests/web)

lint:
	bun run agents/runtime/check-secrets.ts

typecheck:
	bun run typecheck

# Frontend React : typecheck + build local + tests. Le build écrit dans
# `android/app/src/main/assets/web/` (gitignoré) ; Gradle le refait à chaque
# `preBuild` (c'est l'interface de l'APK, ADR-004).
web-typecheck:
	bun run typecheck:web

web-build:
	bun run build:web

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

architecture: architecture-test

architecture-test:
	bun run agents/runtime/check-architecture.ts
	bun test tests/architecture --parallel

contracts:
	bun test tests/contracts --parallel

# android/**/*.kt : garde-fou structurel, sans SDK ni réseau. Le vrai
# compilateur est `make android-compile` (ci-dessous, appelé par `make check`).
# Voir le en-tête de check-kotlin.ts.
check-kotlin:
	bun run agents/runtime/check-kotlin.ts

# Compile Kotlin RÉELLE (`android-compile`) — le SEUL filet qui voit une
# résolution de symbole, un import manquant ou une surcharge ambiguë : les miroirs
# TS et check-kotlin ne les voient pas (piège réel : `MAX_LABEL_CHARS` non
# qualifié dans core/Homework.kt, invisible côté TS).
# Outillage absent = SKIP bruyant, jamais un faux vert : `make check` dit alors
# ce qu'il n'a pas fait. Les commandes APK (buildDebugApk/buildRelApk) échouent
# au lieu de sauter : un APK demandé en silence n'en est pas un.
#
# --offline d'ABORD : versions figées + cache local = la configuration ne doit
# rien au réseau (95 s perdus sinon ici : le JVM ne reçoit jamais la réponse de
# dl.google.com, 3 × 28 s de SocketTimeout pendant que curl y répond en 0,9 s —
# pb d'environnement JVM/réseau, cf. docs/HUMAN_INPUTS.md). Cache froid = échec
# explicite puis repli EN LIGNE : jamais de blocage silencieux.
#
# -x buildWebUi : `:app:compileDebugKotlin` tire `preBuild`, donc Gradle lançait
# un Vite complet. `make check` exécute déjà `web-build` en parallèle : deux Vite
# concurrents sur le même outDir (emptyOutDir) pouvaient se marcher dessus.
android-compile:
	@$(ANDROID_ENV); \
	jdk=$$(android_jdk); sdk=$$(android_sdk); \
	if [ -z "$$jdk" ]; then \
	  echo "android-compile SKIP : aucun JDK 17-21."; \
	  echo "  compile Kotlin NON vérifiée — seul check-kotlin (structurel) a tourné."; \
	elif [ -z "$$sdk" ]; then \
	  echo "android-compile SKIP : SDK Android absent (ANDROID_HOME ou android/local.properties)."; \
	  echo "  compile Kotlin NON vérifiée — seul check-kotlin (structurel) a tourné."; \
	else \
	  echo "android-compile : JDK $$jdk, SDK $$sdk"; \
	  cd android && { \
	    JAVA_HOME="$$jdk" ANDROID_HOME="$$sdk" ./gradlew --offline --console=plain -x buildWebUi \
	      :core:compileDebugKotlin :data:compileDebugKotlin :pronote:compileDebugKotlin :app:compileDebugKotlin || \
	    { echo "android-compile : REPLI EN LIGNE (cache Gradle incomplet — hors-ligne refusé)."; \
	      JAVA_HOME="$$jdk" ANDROID_HOME="$$sdk" ./gradlew --console=plain -x buildWebUi \
	        :core:compileDebugKotlin :data:compileDebugKotlin :pronote:compileDebugKotlin :app:compileDebugKotlin; }; \
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

# Scraper manuels (#209) : HTTPS sur 0.0.0.0:8080 (l'app Android refuse le
# clairtext hors émulateur, cf. android/app/src/main/res/xml/network_security_config.xml).
# SANS auth (décision utilisateur du 2026-10-11, risque accepté documenté dans
# server/infrastructure/http.ts) : le process ne sert QUE GET /v1/health +
# POST /v1/manuals/scrape. Credentials portail injectés par l'appelant dans le
# corps, jamais en env ni commités. Le certificat auto-signé est généré HORS du
# dépôt et seulement s'il manque (agents/runtime/dev-tls.sh) ; TLS_CERT_FILE /
# TLS_KEY_FILE fournies par ailleurs (mkcert, Let's Encrypt) sont respectées
# telles quelles, PORT/HOST restent surchargeables.
runServer:
	@. agents/runtime/dev-tls.sh; dev_tls; \
	PORT=8080 HOST=0.0.0.0 bun run server/infrastructure/http.ts

# Frames de RÉFÉRENCE Papillon (`make papillonRef`) : les démonstrations
# publiques de l'application de référence, rechargées depuis papillon.bzh.
# Réseau = échec bruyant, et RIEN de tout ça n'est requis par `make check` :
# une référence unavailable n'a pas à faire tomber une vérification locale.
papillonRef:
	agents/runtime/papillon-ref.sh

build:
	bun run agents/runtime/check-secrets.ts
	docker build -t veryslopnynotes-server:local -f Dockerfile.server . || echo "skip docker (daemon absent)"
	@if [ -d android/app ]; then echo "APK : make buildDebugApk / make buildRelApk (custom hors repo, repli debug #297)"; fi
