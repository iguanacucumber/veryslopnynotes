.PHONY: check lint typecheck unit architecture contracts security check-kotlin android-check architecture-test integration integration-pronote integration-pairing integration-push integration-api e2e e2e-grades e2e-assignments e2e-manuals e2e-revision serve build

check: lint typecheck unit architecture contracts security check-kotlin

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

# android/**/*.kt : garde-fou structurel, sans SDK ni réseau. Vrai compilateur
# = `make android-check` (ci-dessous). Voir le en-tête de check-kotlin.ts.
check-kotlin:
	bun run agents/runtime/check-kotlin.ts

# Compile Kotlin via Gradle quand l'outillage EST là : android/gradlew (absent
# du repo, wrapper non commité) ou `gradle` au PATH, ET un SDK Android
# (ANDROID_HOME / ANDROID_SDK_ROOT / ~/Android/Sdk). Sinon message + skip, sans
# faire échouer `make check` : ici android/ n'a jamais été compilé (#114).
# Dès que les deux sont présents : une erreur Kotlin fait échouer la cible.
android-check:
	@GRADLE=""; \
	if [ -x android/gradlew ]; then GRADLE=./gradlew; \
	elif command -v gradle >/dev/null 2>&1; then GRADLE=gradle; fi; \
	SDK="$${ANDROID_HOME:-$${ANDROID_SDK_ROOT:-$$HOME/Android/Sdk}}"; \
	if [ -z "$$GRADLE" ]; then \
		echo "android-check SKIP : ni android/gradlew ni gradle (wrapper non commité)."; \
		echo "  compile Kotlin NON vérifiée — seul check-kotlin (structurel) a tourné."; \
	elif [ ! -d "$$SDK" ]; then \
		echo "android-check SKIP : SDK Android absent (ANDROID_HOME/ANDROID_SDK_ROOT)."; \
		echo "  compile Kotlin NON vérifiée — seul check-kotlin (structurel) a tourné."; \
	else \
		echo "android-check : $$GRADLE (SDK $$SDK)"; \
		cd android && $$GRADLE :core:compileDebugKotlin :data:compileDebugKotlin :ui:compileDebugKotlin :app:compileDebugKotlin; \
	fi

integration integration-pronote integration-pairing integration-push integration-api:
	@if [ ! -f .env.local ]; then echo "skip $@ (pas de .env.local)"; else bun test tests/integration; fi

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

# Serveur local : branchement complet (env -> session Pronote -> routes).
# Sans .env.local il démarre quand même, lectures vides et écritures en 501.
serve:
	@if [ ! -f .env.local ]; then echo "aucun .env.local : lectures vides (écritures 501)"; fi
	bun run server/infrastructure/http.ts

build:
	bun run agents/runtime/check-secrets.ts
	docker build -t veryslopnynotes-server:local -f Dockerfile.server . || echo "skip docker (daemon absent)"
	@if [ -d android/app ]; then echo "APK: voir android/README.md (assembleDebug, cle hors repo)"; fi
