// Le build d'image, le scan Trivy et le healthcheck n'existent qu'en CI : aucun
// démon Docker n'est requis pour vérifier le câblage. Le scan de source est donc
// le seul contrôle possible (même raison que ci-security-scan).
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");
const WORKFLOW = readFileSync(join(ROOT, ".github", "workflows", "security-scan.yml"), "utf8");
const DOCKERFILE = readFileSync(join(ROOT, "Dockerfile.server"), "utf8");

function job(name: string): string {
  const marker = `\n  ${name}:\n`;
  const start = WORKFLOW.indexOf(marker);
  if (start === -1) throw new Error(`job CI absent : ${name}`);
  const rest = WORKFLOW.slice(start + marker.length);
  const end = rest.search(/\n {2}[a-z][\w-]*:\n/);
  return end === -1 ? rest : rest.slice(0, end);
}

function step(name: string): string {
  const marker = `- name: ${name}\n`;
  const start = WORKFLOW.indexOf(marker);
  if (start === -1) throw new Error(`étape CI absente : ${name}`);
  const rest = WORKFLOW.slice(start + marker.length);
  const end = rest.indexOf("\n      - name: ");
  return end === -1 ? rest : rest.slice(0, end);
}

describe("CI : image serveur (#920)", () => {
  test("le job construit le Dockerfile et scanne CETTE image", () => {
    const image = job("server-image");
    expect(step("Image serveur")).toContain("docker build -t veryslopnynotes-server:scan -f Dockerfile.server .");
    const scan = step("Scan de l'image");
    expect(scan).toContain("veryslopnynotes-server:scan");
    expect(scan).toContain("--severity HIGH,CRITICAL");
    expect(scan).toContain("--ignore-unfixed");
    expect(scan).toContain("--exit-code 1");
    // Aucune indulgence sur les étapes qui rendent le verdict.
    expect(step("Image serveur")).not.toContain("continue-on-error");
    expect(scan).not.toContain("continue-on-error");
    expect(image).toContain("timeout-minutes:");
  });

  test("le conteneur démarre en TLS + jeton hors loopback", () => {
    expect(step("TLS de test")).toContain("openssl req -x509");
    const run = step("Conteneur serveur");
    // Port publié sur la boucle locale du runner uniquement.
    expect(run).toContain("-p 127.0.0.1:3000:3000");
    // 0.0.0.0 sans ALLOW_PUBLIC/jeton est refusé au démarrage par le serveur :
    // les trois vont ensemble ou le smoke ne prouve rien.
    expect(run).toContain("-e HOST=0.0.0.0");
    expect(run).toContain("-e ALLOW_PUBLIC=1");
    expect(run).toContain("-e SCRAPER_TOKEN");
    expect(run).toContain("-e TLS_CERT_FILE=/tls/cert.pem");
    expect(run).toContain("-e TLS_KEY_FILE=/tls/key.pem");
    // Matériel TLS monté en lecture seule ; le conteneur reste non-root
    // (l'image déclare USER vsn) et sans privilèges.
    expect(run).toContain('-v "$RUNNER_TEMP/tls:/tls:ro"');
    expect(run).toContain("--read-only");
    expect(run).toContain("--cap-drop=ALL");
    expect(run).toContain("--security-opt no-new-privileges");
    expect(run).toContain("veryslopnynotes-server:scan");
  });

  test("la disponibilité est sondée avec jeton et refuse l'anonyme", () => {
    const ready = step("Disponibilité");
    expect(ready).toContain("https://127.0.0.1:3000/v1/ready");
    expect(ready).toContain("Authorization: Bearer");
    expect(ready).toContain('"401"');
    expect(ready).toContain("/v1/health");
    // Une attente BORNÉE : pas de boucle infinie qui consomme le timeout du job.
    expect(ready).toContain("SECONDS + 120");
    expect(ready).toContain("exit 1");
  });

  test("le HEALTHCHECK de l'image doit être healthy, pas seulement joignable", () => {
    expect(DOCKERFILE).toMatch(/^HEALTHCHECK[\s\S]*?\/v1\/ready/m);
    const health = step("Santé du conteneur");
    expect(health).toContain(".State.Health.Status");
    expect(health).toContain('"healthy"');
    // `starting` n'est pas un verdict : la boucle est bornée puis échoue.
    expect(health).toContain("SECONDS + 90");
    expect(health).toContain("exit 1");
  });

  test("journaux et nettoyage tournent même en échec", () => {
    expect(step("Journaux du conteneur")).toContain("if: always()");
    const cleanup = step("Nettoyage du conteneur");
    expect(cleanup).toContain("if: always()");
    expect(cleanup).toContain("docker rm -f vsn-server-image");
    expect(cleanup).toContain("docker volume rm vsn-ci-jar");
  });

  test("les actions tierces restent épinglées par SHA", () => {
    for (const [, ref] of job("server-image").matchAll(/uses: [^@\s]+@(\S+)/g)) {
      expect(ref).toMatch(/^[0-9a-f]{40}$/);
    }
  });
});
