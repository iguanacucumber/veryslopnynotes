.PHONY: help check check-run check-fast coverage watch lint audit typecheck unit architecture contracts android-compile web web-typecheck web-build web-test web-smoke runServer buildDebugApk buildRelApk updateApkToPhone build shot papillonRef

# `##` est la description lue par `make help` : la ligne de cible reste la
# source unique, sans table à maintenir.
help: ## affiche cette aide
	@awk -F':.*## ' '/^[a-zA-Z][a-zA-Z0-9_-]*:.*## / { printf "  %-20s %s\n", $$1, $$2 }' $(MAKEFILE_LIST)

# JDK/SDK partagé (borne 17–21).
ANDROID_ENV = . agents/runtime/android-env.sh

# Cause gardée, bruit borné, code de sortie de bun conservé.
TEST_OUTPUT = bun run agents/runtime/test-output.ts

# Gate strict : CHECK_HARNESS/ALLOW_SKIP_ANDROID neutralisés,
# REQUIRE_KOTLIN_TOOLCHAIN=1, MAKEFLAGS ignoré. Pas de version allégée.
# Chemin de statut UNIQUE par run : deux gates concurrents dans le même arbre
# ne peuvent pas lire le verdict de l'autre. `:=` fige la valeur AU PARSE, donc
# `check-run` (écriture) et `check` (lecture) partagent le même fichier.
# `GATE_STATUS=…` en ligne de commande reste prioritaire (tests).
GATE_STATUS := $(shell mktemp -u "$(CURDIR)/node_modules/.cache/gate-status.XXXXXX")

check-run: ## phase interne du gate : exécute et consigne le code de sortie
	@mkdir -p $(dir $(GATE_STATUS)); rm -f $(GATE_STATUS); \
	 MAKEFLAGS= CHECK_HARNESS= ALLOW_SKIP_ANDROID= REQUIRE_KOTLIN_TOOLCHAIN=1 bun run agents/runtime/check.ts; \
	 echo $$? > $(GATE_STATUS)

check: check-run ## gate de merge : 9 étapes, sans version allégée
	$(if $(wildcard $(GATE_STATUS)),,$(error gate NON EXÉCUTÉ : aucun statut — le gate n'a pas tourné))
	$(if $(filter 0,$(shell cat $(GATE_STATUS))),,$(error gate ROUGE : code de sortie $(shell cat $(GATE_STATUS))))

check-fast: ## boucle rapide : gate sans compilation Kotlin ni audit
	CHECK_HARNESS=1 CHECK_TARGETS="lint typecheck unit architecture contracts web-typecheck web-test" bun run agents/runtime/check.ts

# Couverture (#895) : DEUX mesures, une exécution. Bun lit les lignes touchées
# par les tests ; JaCoCo instrumente le port de parité Kotlin (les modules
# Android n'ont pas de `test/` Gradle). Hors `make check` : doubler la suite
# n'a pas sa place dans le gate. Seuil explicite dans `coverage-baseline.json`.
coverage: ## couverture Bun + JaCoCo et seuil (hors gate)
	bun run agents/runtime/coverage.ts prepare
	rm -rf coverage
	REQUIRE_KOTLIN_TOOLCHAIN=1 \
	JACOCO_AGENT_JAR="$$(bun run agents/runtime/coverage.ts agent)" \
	JACOCO_DIR="$(CURDIR)/coverage/jacoco-raw" \
	$(TEST_OUTPUT) coverage tests/unit tests/web tests/contracts --parallel \
	  --coverage --coverage-reporter=lcov --coverage-dir "$(CURDIR)/coverage/bun"
	bun run agents/runtime/coverage.ts report
	bun run agents/runtime/coverage.ts check

# `T=<fichier>` cible un test ; séquentiel exprès.
watch: ## tests unitaires et web en continu
	bun test --watch $(if $(T),$(T),tests/unit tests/web)

lint: ## scan anti-secrets
	bun run agents/runtime/check-secrets.ts

# Réseau requis : registre injoignable = échec.
audit: ## audit des dépendances (réseau requis)
	bun audit

typecheck: ## typecheck TypeScript à la racine
	bun run --silent typecheck

unit: ## tests unitaires
	$(TEST_OUTPUT) unit tests/unit --parallel

web-typecheck: ## typecheck du web
	bun run --silent typecheck:web

web-build: ## build du bundle web
	bun run build:web

web-test: ## tests du web et de l'architecture web
	$(TEST_OUTPUT) web-test tests/web tests/architecture/web.test.ts

web: web-typecheck web-test web-build ## typecheck, tests et build du web

web-smoke: web-build ## smoke navigateur Playwright et captures (hors gate)
	bun run agents/runtime/web-smoke.ts
	bun run test:visual

# `web-build` une seule fois par gate.
architecture: web-build architecture-test ## scans et tests d'architecture

architecture-test:
	bun run agents/runtime/check-architecture.ts
	bun test tests/architecture --parallel

contracts: ## tests de contrats
	bun test tests/contracts --parallel

# Outillage absent = ÉCHEC, pas de skip silencieux. Journal fixe, affiché par
# kotlin-errors.ts uniquement.
android-compile: ## compile Kotlin + Android Lint (JDK/SDK requis)
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
	  log="$(CURDIR)/node_modules/.cache/gate-logs/android-compile.log"; \
	  mkdir -p "$$(dirname "$$log")"; \
	  echo "android-compile : JDK $$jdk, SDK $$sdk"; \
	  cd android && { \
	    JAVA_HOME="$$jdk" ANDROID_HOME="$$sdk" ./gradlew --offline --console=plain -x buildWebUi \
	      :core:compileDebugKotlin :data:compileDebugKotlin :pronote:compileDebugKotlin :app:compileDebugKotlin :app:lintDebug >"$$log" 2>&1 || \
	    { echo "android-compile : REPLI EN LIGNE (cache Gradle incomplet — hors-ligne refusé)."; \
	      JAVA_HOME="$$jdk" ANDROID_HOME="$$sdk" ./gradlew --console=plain -x buildWebUi \
	        :core:compileDebugKotlin :data:compileDebugKotlin :pronote:compileDebugKotlin :app:compileDebugKotlin :app:lintDebug >>"$$log" 2>&1; }; \
	  }; code=$$?; \
	  bun run "$(CURDIR)/agents/runtime/kotlin-errors.ts" "$$log" "$$code"; s=$$?; \
	  [ "$$code" -eq 0 ] || exit "$$code"; \
	  exit "$$s"; \
	fi

shot: ## capture sur téléphone réel (ROUTE=<route>)
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

# `preBuild` lance `bun run build:web` : l'APK embarque le web à jour.
buildDebugApk: ## APK debug (JDK/SDK requis)
	@$(ANDROID_ENV); \
	jdk=$$(android_jdk); sdk=$$(android_sdk); \
	if [ -z "$$jdk" ] || [ -z "$$sdk" ]; then \
	  echo "buildDebugApk : outillage absent (JDK=$${jdk:-aucun}, SDK=$${sdk:-aucun})."; \
	  android_toolchain_hint; exit 1; \
	fi; \
	cd android && JAVA_HOME="$$jdk" ANDROID_HOME="$$sdk" ./gradlew --console=plain assembleDebug && \
	echo "APK debug : android/app/build/outputs/apk/debug/app-debug.apk"

# Un seul appareil prêt, sinon ANDROID_SERIAL=<série>. Jamais de désinstallation.
updateApkToPhone: buildDebugApk ## installe l'APK debug sur le téléphone branché
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

buildRelApk: ## APK release (JDK/SDK requis)
	@$(ANDROID_ENV); \
	jdk=$$(android_jdk); sdk=$$(android_sdk); \
	if [ -z "$$jdk" ] || [ -z "$$sdk" ]; then \
	  echo "buildRelApk : outillage absent (JDK=$${jdk:-aucun}, SDK=$${sdk:-aucun})."; \
	  android_toolchain_hint; exit 1; \
	fi; \
	cd android && JAVA_HOME="$$jdk" ANDROID_HOME="$$sdk" ./gradlew --console=plain assembleRelease && \
	echo "APK release : android/app/build/outputs/apk/release/ (signé avec la clé release configurée ; échec sans clé)"

# HTTPS sans auth (I8) ; boucle locale par défaut.
runServer: ## serveur scraper HTTPS local
	@. agents/runtime/dev-tls.sh && dev_tls && \
	PORT="$${PORT:-8080}" HOST="$${HOST:-127.0.0.1}" bun run server/infrastructure/http.ts

# Hors `make check` ; réseau absent = échec bruyant.
papillonRef: ## frames de référence Papillon (réseau requis)
	agents/runtime/papillon-ref.sh

# Docker absent = SKIP explicite ; build Docker échoué = échec.
build: ## image Docker du serveur + scan de secrets
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
	@if [ -d android/app ]; then echo "APK : make buildDebugApk / make buildRelApk (release : clé hors repo requise)"; fi
