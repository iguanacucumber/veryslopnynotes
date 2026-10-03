.PHONY: check lint typecheck unit architecture contracts security architecture-test integration integration-pronote integration-pairing integration-push integration-api e2e e2e-grades e2e-assignments e2e-manuals e2e-revision serve build

check: lint typecheck unit architecture contracts security

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
