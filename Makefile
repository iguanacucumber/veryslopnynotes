.PHONY: check lint typecheck unit architecture contracts security architecture-test integration integration-pronote integration-pairing integration-push integration-api e2e e2e-grades e2e-assignments e2e-manuals e2e-revision build

check: lint typecheck unit architecture contracts security

lint:
	bun run agents/runtime/check-secrets.ts

typecheck:
	bunx tsc --noEmit

unit:
	bun test tests/unit

architecture: architecture-test
	bun test tests/architecture

architecture-test:
	bun run agents/runtime/check-architecture.ts
	bun test tests/architecture

contracts:
	bun test tests/contracts

security:
	bun test tests/security

integration: integration-pronote integration-pairing integration-push integration-api

integration-pronote integration-pairing integration-push integration-api:
	@if [ ! -f .env.local ]; then echo "skip $@ (pas de .env.local)"; exit 0; fi
	bun test tests/integration

e2e: e2e-grades e2e-assignments e2e-manuals e2e-revision

e2e-grades e2e-assignments e2e-manuals e2e-revision:
	@if [ ! -f .env.local ]; then echo "skip $@ (pas de .env.local)"; exit 0; fi
	bun test tests/e2e

build:
	bun run agents/runtime/check-secrets.ts
	docker build -t veryslopnynotes-server:local -f Dockerfile.server . || echo "skip docker (daemon absent)"
	@if [ -d android/app ]; then echo "APK: voir android/README.md (assembleDebug, cle hors repo)"; fi
