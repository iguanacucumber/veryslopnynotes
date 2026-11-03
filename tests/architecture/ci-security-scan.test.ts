// La chaîne d'approvisionnement n'a pas de comportement exécutable dans le
// dépôt : un diff de dépendances, une CVE d'image et une empreinte Gradle ne
// se prouvent que par les jobs CI et le fichier de vérification. Un scan de
// source est ici le seul contrôle possible (même raison que ci-permissions).
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");
const WORKFLOW = readFileSync(join(ROOT, ".github", "workflows", "security-scan.yml"), "utf8");
const CI = readFileSync(join(ROOT, ".github", "workflows", "ci.yml"), "utf8");
const MAKEFILE = readFileSync(join(ROOT, "Makefile"), "utf8");
const METADATA = readFileSync(join(ROOT, "android", "gradle", "verification-metadata.xml"), "utf8");
const GRADLE_PROPERTIES = readFileSync(join(ROOT, "android", "gradle.properties"), "utf8");

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

describe("CI : dépendances et conteneur (#908)", () => {
  test("le scan tourne sur chaque PR et sur main, avec contents: read seulement", () => {
    const on = /^on:\n([\s\S]*?)(?=\npermissions:)/m.exec(WORKFLOW)?.[1] ?? "";
    expect(on).toMatch(/^ {2}pull_request:$/m);
    expect(on).toMatch(/^ {2}push:\n {4}branches: \[main\]$/m);
    expect(WORKFLOW).toMatch(/^permissions:\n {2}contents: read$/m);
    // Aucune permission élargie, à aucun niveau : les scans n'écrivent pas.
    expect(WORKFLOW).not.toMatch(/^\s+\w[\w-]*:\s*write\s*$/m);
  });

  test("dependency review ne s'exécute que sur une PR et échoue à HIGH", () => {
    const review = job("dependency-review");
    expect(review).toContain("if: github.event_name == 'pull_request'");
    expect(step("Revue des dépendances")).toContain("fail-on-severity: high");
    // `warn-only` et `continue-on-error` transformeraient le gate en avis.
    expect(review).not.toContain("warn-only");
    expect(review).not.toContain("continue-on-error");
  });

  test("le repli sans graphe audite HIGH/CRITICAL seulement sur un diff de manifeste", () => {
    const graph = step("Graphe de dépendances");
    expect(graph).toContain("dependency-graph/sbom");
    expect(step("Revue des dépendances")).toContain("steps.graph.outputs.supported == 'true'");
    const fallback = step("Repli bun audit");
    expect(fallback).toContain("steps.graph.outputs.supported != 'true'");
    expect(fallback).toContain("bun audit --audit-level=high");
    expect(fallback).toContain("git diff --name-only");
    expect(fallback).toContain("github.event.pull_request.base.sha");
    for (const manifest of ["package.json", "bun.lock", "android/gradle/libs.versions.toml"]) {
      expect(fallback).toContain(manifest);
    }
  });

  test("Trivy est épinglé et vérifié avant extraction", () => {
    const install = step("Trivy épinglé");
    const version = /version=(\d+\.\d+\.\d+)/.exec(install)?.[1];
    expect(version).toBe("0.76.1");
    expect(install).toContain("/releases/download/v${version}");
    expect([...install.matchAll(/\b[0-9a-f]{64}\b/g)]).toHaveLength(1);
    const check = install.indexOf("sha256sum -c");
    const extract = install.indexOf("tar -xzf");
    expect(check).toBeGreaterThan(-1);
    expect(extract).toBeGreaterThan(check);
  });

  test("chaque action tierce est un SHA de commit, jamais un tag mutable", () => {
    for (const [, ref] of WORKFLOW.matchAll(/uses: [^@\s]+@(\S+)/g)) {
      if (ref!.includes("/")) continue; // sous-chemin local, pas une action
      expect(ref).toMatch(/^[0-9a-f]{40}$/);
    }
  });

  test("un cache Trivy en échec ne décide pas du verdict", () => {
    const cache = step("Cache Trivy");
    expect(cache).toContain("continue-on-error: true");
    // Les étapes qui rendent le verdict n'héritent JAMAIS de cette indulgence.
    for (const name of ["Scan de l'arbre", "Image serveur", "Scan de l'image"]) {
      expect(step(name)).not.toContain("continue-on-error");
    }
  });

  test("les scans Trivy bloquent sur une trouvaille HIGH/CRITICAL corrigeable", () => {
    for (const name of ["Scan de l'arbre", "Scan de l'image"]) {
      const scan = step(name);
      expect(scan).toContain("--severity HIGH,CRITICAL");
      expect(scan).toContain("--exit-code 1");
      expect(scan).not.toContain("--exit-code 0");
      // Sans correctif publié, aucune PR ne peut réparer la CVE : la politique
      // est explicite, pas un `exit-code 0` caché.
      expect(scan).toContain("--ignore-unfixed");
    }
  });

  test("l'image scannée est celle construite dans le job", () => {
    expect(step("Image serveur")).toContain("docker build -t veryslopnynotes-server:scan");
    const scan = step("Scan de l'image");
    expect(scan).toContain("veryslopnynotes-server:scan");
    // Une seule exemption, ciblée : le compilateur TS de développement.
    expect([...scan.matchAll(/--skip-dirs/g)]).toHaveLength(1);
    expect(scan).toContain("--skip-dirs app/node_modules/@typescript");
  });

  test("Gradle vérifie les empreintes d'artefacts dans le gate", () => {
    expect(METADATA).toContain("<verify-metadata>true</verify-metadata>");
    const components = [...METADATA.matchAll(/<component group="[^"]+" name="[^"]+" version="[^"]+">/g)];
    expect(components.length).toBeGreaterThan(100);
    const artifacts = [...METADATA.matchAll(/<artifact name="[^"]+">/g)];
    const sums = [...METADATA.matchAll(/<sha256 value="[0-9a-f]{64}"/g)];
    expect(artifacts.length).toBeGreaterThan(0);
    expect(sums.length).toBeGreaterThanOrEqual(artifacts.length);
    // Aucun contournement : une clé de confiance ou un artefact ignoré
    // accepterait un jar non épinglé sans faire rougir le gate.
    expect(METADATA).not.toContain("<trusted-artifacts>");
    expect(METADATA).not.toContain("<ignored-keys>");
    expect(METADATA).not.toContain("<trusted-keys>");
    // Le mode par défaut est `strict` dès que ce fichier existe ; un mode
    // `lenient` explicite l'annulerait silencieusement.
    expect(GRADLE_PROPERTIES).not.toMatch(/dependency\.verification\.mode/);
    expect(CI).toContain("make check");
    expect(MAKEFILE).toMatch(/cd android && \{ \\\n[\s\S]*?\.\/gradlew/);
  });
});
