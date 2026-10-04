.PHONY: check lint typecheck unit architecture contracts security check-kotlin android-compile architecture-test integration-api e2e e2e-grades e2e-assignments e2e-manuals e2e-revision runServer buildDebugApk buildRelApk build shot papillonRef

# Découverte JDK/SDK partagée par android-compile, buildDebugApk, buildRelApk :
# une seule implémentation, sinon une des trois finit par oublier la borne 17-21.
ANDROID_ENV = . agents/runtime/android-env.sh

check: lint typecheck unit architecture contracts security check-kotlin android-compile

lint:
	bun run agents/runtime/check-secrets.ts

typecheck:
	bunx tsc --noEmit

unit:
	bun test tests/unit

architecture: architecture-test

architecture-test:
	bun run agents/runtime/check-architecture.ts
	bun test tests/architecture

contracts:
	bun test tests/contracts

security:
	bun test tests/security

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
android-compile:
	@$(ANDROID_ENV); \
	jdk=$$(android_jdk); sdk=$$(android_sdk); \
	if [ -z "$$jdk" ]; then \
	  echo "android-compile SKIP : aucun JDK 17-21 (Gradle 8.7 refuse > 21)."; \
	  echo "  compile Kotlin NON vérifiée — seul check-kotlin (structurel) a tourné."; \
	elif [ -z "$$sdk" ]; then \
	  echo "android-compile SKIP : SDK Android absent (ANDROID_HOME ou android/local.properties)."; \
	  echo "  compile Kotlin NON vérifiée — seul check-kotlin (structurel) a tourné."; \
	else \
	  echo "android-compile : JDK $$jdk, SDK $$sdk"; \
	  cd android && JAVA_HOME="$$jdk" ANDROID_HOME="$$sdk" ./gradlew --console=plain \
	    :core:compileDebugKotlin :data:compileDebugKotlin :ui:compileDebugKotlin :app:compileDebugKotlin; \
	fi

# Capture d'écran sur téléphone réel (#133) : `make shot ROUTE=grades`.
# shot.sh installe l'APK debug s'il est plus vieux que les sources, ouvre
# `veryslopnynotes://<route>` (deep link DU VARIANT DEBUG seulement) et dépose
# la capture dans shots/<date-UTC>/. Sort en erreur si l'appareil manque, si
# l'écran rend noir ou si l'app atterrit ailleurs que sur la route demandée :
# une capture non vérifiée ne sert à rien. La découverte JDK/SDK est celle
# d'android-env.sh, comme les autres cibles Gradle.
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
	JAVA_HOME="$$jdk" ANDROID_HOME="$$sdk" agents/runtime/shot.sh $(ROUTE)

# APK debug : clé de signature de debug (hors repo, générée par Gradle).
buildDebugApk:
	@$(ANDROID_ENV); \
	jdk=$$(android_jdk); sdk=$$(android_sdk); \
	if [ -z "$$jdk" ] || [ -z "$$sdk" ]; then \
	  echo "buildDebugApk : outillage absent (JDK=$${jdk:-aucun}, SDK=$${sdk:-aucun})."; \
	  android_toolchain_hint; exit 1; \
	fi; \
	cd android && JAVA_HOME="$$jdk" ANDROID_HOME="$$sdk" ./gradlew --console=plain assembleDebug && \
	echo "APK debug : android/app/build/outputs/apk/debug/app-debug.apk"

# APK release : signé SI les credentials de signature sont dans l'environnement
# (STORE_FILE + mots de passe/alias — JAMAIS dans le repo, voir docs/RELEASE.md),
# non signé sinon. Gradle ne le dit pas toujours : le rappel ci-dessous est
# obligatoire pour que personne ne croie avoir un APK publiable.
buildRelApk:
	@$(ANDROID_ENV); \
	jdk=$$(android_jdk); sdk=$$(android_sdk); \
	if [ -z "$$jdk" ] || [ -z "$$sdk" ]; then \
	  echo "buildRelApk : outillage absent (JDK=$${jdk:-aucun}, SDK=$${sdk:-aucun})."; \
	  android_toolchain_hint; exit 1; \
	fi; \
	cd android && JAVA_HOME="$$jdk" ANDROID_HOME="$$sdk" ./gradlew --console=plain assembleRelease && \
	echo "APK release : android/app/build/outputs/apk/release/ (sigNE si STORE_FILE présent, sinon NON signé)"

# tests/integration : API locale sans secret (0.7.0 : plus de .env.local, donc
# plus rien à charger — le serveur ne détient aucun credential).
integration-api:
	bun test tests/integration/api.test.ts

e2e:
	bun test tests/e2e

e2e-grades:
	bun test tests/e2e/grades.test.ts

e2e-assignments:
	bun test tests/e2e/assignments.test.ts

e2e-manuals:
	bun test tests/e2e/manuals.test.ts

e2e-revision:
	bun test tests/e2e/revision.test.ts

# Serveur local : HTTPS sur 0.0.0.0:8080 (l'app Android refuse le clairtext hors
# émulateur, cf. android/app/src/main/res/xml/network_security_config.xml).
# 0.7.0 : aucun credential à fournir, le serveur démarre vide et le compte
# s'ouvre via POST /v1/setup (QR envoyé par l'app). Le certificat auto-signé est
# généré HORS du dépôt et seulement s'il manque (agents/runtime/dev-tls.sh) ;
# TLS_CERT_FILE/TLS_KEY_FILE fournies par ailleurs (mkcert, Let's Encrypt) sont
# respectées telles quelles, PORT/HOST restent surchargeables.
# 0.0.0.0 = LAN exposé : le jeton de device reste exigé sur les routes fermées,
# le TLS ne remplace pas l'appairage.
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
	@if [ -d android/app ]; then echo "APK : make buildDebugApk / make buildRelApk (cle de signature hors repo)"; fi
