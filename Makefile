.PHONY: check lint typecheck unit architecture contracts security check-kotlin android-compile architecture-test integration-api e2e e2e-grades e2e-assignments e2e-manuals e2e-revision serve build

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
# Exigences : android/gradlew (dans le repo), un SDK Android, et un JDK 17-21 —
# Gradle 8.7 REFUSE un JDK > 21 (échec opaque). Outillage absent = SKIP bruyant,
# jamais un faux vert : `make check` dit alors explicitement ce qu'il n'a pas fait.
# Installation (une fois) : JDK 17 via Adoptium, puis
#   sdkmanager "platforms;android-34" "build-tools;34.0.0" platform-tools
android-compile:
	@JDK=""; \
	for cand in "$${ANDROID_JDK_HOME}" "$${JAVA_HOME}" "$$HOME/.cache/jdk17"; do \
	  [ -x "$$cand/bin/java" ] || continue; \
	  v=$$("$$cand/bin/java" -version 2>&1 | sed -n 's/.*version "\([0-9][0-9]*\).*/\1/p'); \
	  if [ -n "$$v" ] && [ "$$v" -ge 17 ] && [ "$$v" -le 21 ]; then JDK="$$cand"; break; fi; \
	done; \
	SDK="$${ANDROID_HOME:-$${ANDROID_SDK_ROOT:-}}"; \
	if [ -z "$$SDK" ] && [ -f android/local.properties ]; then \
	  SDK=$$(sed -n 's/^sdk\.dir=//p' android/local.properties); \
	fi; \
	if [ ! -x android/gradlew ]; then \
	  echo "android-compile SKIP : android/gradlew absent (wrapper non commité ?)."; \
	  echo "  compile Kotlin NON vérifiée — seul check-kotlin (structurel) a tourné."; \
	elif [ -z "$$JDK" ]; then \
	  echo "android-compile SKIP : aucun JDK 17-21 (Gradle 8.7 refuse > 21)."; \
	  echo "  compile Kotlin NON vérifiée — seul check-kotlin (structurel) a tourné."; \
	elif [ -z "$$SDK" ] || [ ! -d "$$SDK" ]; then \
	  echo "android-compile SKIP : SDK Android absent (ANDROID_HOME ou android/local.properties)."; \
	  echo "  compile Kotlin NON vérifiée — seul check-kotlin (structurel) a tourné."; \
	else \
	  echo "android-compile : JDK $$JDK, SDK $$SDK"; \
	  cd android && JAVA_HOME="$$JDK" ANDROID_HOME="$$SDK" ./gradlew --console=plain \
	    :core:compileDebugKotlin :data:compileDebugKotlin :ui:compileDebugKotlin :app:compileDebugKotlin; \
	fi

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

# Serveur local : PORT/HOST -> routes. 0.7.0 : aucun credential à fournir, le
# serveur démarre vide et le compte s'ouvre via POST /v1/setup (QR envoyé par l'app).
serve:
	bun run server/infrastructure/http.ts

build:
	bun run agents/runtime/check-secrets.ts
	docker build -t veryslopnynotes-server:local -f Dockerfile.server . || echo "skip docker (daemon absent)"
	@if [ -d android/app ]; then echo "APK: voir android/README.md (assembleDebug, cle hors repo)"; fi
