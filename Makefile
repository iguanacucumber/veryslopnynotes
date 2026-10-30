.PHONY: check check-run check-fast watch lint audit typecheck unit architecture contracts android-compile web web-typecheck web-build web-test web-smoke runServer buildDebugApk buildRelApk updateApkToPhone build shot papillonRef

# Découverte JDK/SDK partagée (borne 17–21, une seule implémentation).
ANDROID_ENV = . agents/runtime/android-env.sh

# `make check` = 9 étapes en parallèle. Détail : docs/architecture/BUILD.md.
# Le gate est strict (CHECK_HARNESS / ALLOW_SKIP_ANDROID neutralisés,
# REQUIRE_KOTLIN_TOOLCHAIN=1, MAKEFLAGS ignoré, deux phases). Pas de version
# allégée, pas de skip silencieux.
GATE_STATUS = $(CURDIR)/node_modules/.cache/gate-status

check-run:
	@mkdir -p $(dir $(GATE_STATUS)); rm -f $(GATE_STATUS); \
	 MAKEFLAGS= CHECK_HARNESS= ALLOW_SKIP_ANDROID= REQUIRE_KOTLIN_TOOLCHAIN=1 bun run agents/runtime/check.ts; \
	 echo $$? > $(GATE_STATUS)

check: check-run
	$(if $(wildcard $(GATE_STATUS)),,$(error gate NON EXÉCUTÉ : aucun statut — le gate n'a pas tourné))
	$(if $(filter 0,$(shell cat $(GATE_STATUS))),,$(error gate ROUGE : code de sortie $(shell cat $(GATE_STATUS))))

# Tout sauf android-compile (~2,1 s à chaud). Saute uniquement la compilation Gradle.
check-fast:
	CHECK_HARNESS=1 CHECK_TARGETS="lint typecheck unit architecture contracts web-typecheck web-test" bun run agents/runtime/check.ts

# `make watch T=tests/unit/foo.test.ts` cible un fichier. Séquentiel exprès.
watch:
	bun test --watch $(if $(T),$(T),tests/unit tests/web)

lint:
	bun run agents/runtime/check-secrets.ts

# `bun audit` (réseau requis : registre injoignable = échec).
audit:
	bun audit

typecheck:
	bun run typecheck

# Frontend React. Le build écrit dans android/app/src/main/assets/web/ (gitignoré).
web-typecheck:
	bun run typecheck:web

web-build:
	bun run build:web

web-test:
	bun test tests/web tests/architecture/web.test.ts

web: web-typecheck web-test web-build

# Smoke navigateur (Chromium). Hors `make check`.
web-smoke: web-build
	bun run agents/runtime/web-smoke.ts

# Bundle Vite construit UNE fois par le gate (`architecture` tire `web-build`).
architecture: web-build architecture-test

architecture-test:
	bun run agents/runtime/check-architecture.ts
	bun test tests/architecture --parallel

contracts:
	bun test tests/contracts --parallel

# Compile Kotlin RÉELLE + Android Lint dans la même invocation Gradle. Seul
# filet qui résout les symboles. Outillage absent = ÉCHEC, pas de skip silencieux.
# Détail (offline d'abord, repli en ligne, -x buildWebUi) : docs/architecture/BUILD.md.
android-compile:
	@$(ANDROID_ENV); \
	jdk=$$(android_jdk); sdk=$$(android_sdk); \
	if [ -z "$$jdk" ] || [ -z "$$sdk" ]; then \
	  echo "android-compile : outillage ABSENT (JDK=$${jdk:-aucun}, SDK=$${sdk:-aucun}) — la compile Kotlin n'a PAS tourné."; \
	  if [ "$${ALLOW_SKIP_ANDROID:-0}" = "1" ]; then \
	    echo "android-compile SKIP (ALLOW_SKIP_ANDROID=1) : compile Kotlin NON vérifiée."; \
	  else \
	    echo "  ÉCHEC : le gate exige la compilation Kotlin (seul filet qui résout les symboles)."; \
	    echo "  ALLOW_SKIP_ANDROID=1 pour assumer explicitement ce SKIP (hors merge)."; \
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

# Capture d'écran sur téléphone réel (`make shot ROUTE=grades`).
# JDK/SDK via android-env.sh. Détail : docs/architecture/BUILD.md.
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

# APK debug. `preBuild` lance `bun run build:web` : l'APK embarque toujours web/ à jour.
buildDebugApk:
	@$(ANDROID_ENV); \
	jdk=$$(android_jdk); sdk=$$(android_sdk); \
	if [ -z "$$jdk" ] || [ -z "$$sdk" ]; then \
	  echo "buildDebugApk : outillage absent (JDK=$${jdk:-aucun}, SDK=$${sdk:-aucun})."; \
	  android_toolchain_hint; exit 1; \
	fi; \
	cd android && JAVA_HOME="$$jdk" ANDROID_HOME="$$sdk" ./gradlew --console=plain assembleDebug && \
	echo "APK debug : android/app/build/outputs/apk/debug/app-debug.apk"

# Construit l'APK debug puis l'installe (`adb install -r`, données conservées).
# Un seul appareil prêt, sinon ANDROID_SERIAL=<série>. Jamais de désinstallation.
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

# APK release (signé custom si STORE_FILE, sinon debug #297) + AAB Play Store.
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

# Scraper de manuels : HTTPS, sans auth (I8), boucle locale ou proxy authentifié.
# Détail (TLS, `&&`, PORT/HOST) : docs/architecture/BUILD.md.
runServer:
	@. agents/runtime/dev-tls.sh && dev_tls && \
	PORT="$${PORT:-8080}" HOST="$${HOST:-127.0.0.1}" bun run server/infrastructure/http.ts

# Frames de référence Papillon. Réseau = échec bruyant, hors `make check`.
papillonRef:
	agents/runtime/papillon-ref.sh

# Image serveur Docker + scan de secrets. Jamais de masquage d'échec.
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
