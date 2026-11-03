// Couverture (#895) : le workflow, le seuil et le câblage JaCoCo n'ont pas de
// comportement exécutable dans un test de produit. On verrouille donc la
// DÉCLARATION : le job CI existe, il rejoue `make coverage`, les rapports
// partent en artefact, et le seuil vient de la mesure — pas d'un chiffre
// inventé. Les fonctions de lecture (lcov, JaCoCo, marge) sont exercées ici.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  JACOCO_AGENT_SHA256,
  JACOCO_CLI_SHA256,
  JACOCO_VERSION,
  lineCoverageFromJacocoXml,
  lineCoverageFromLcov,
  thresholdFor,
} from "../../agents/runtime/coverage";

const ROOT = join(import.meta.dir, "..", "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const CI = read(".github/workflows/ci.yml");
const MAKEFILE = read("Makefile");
const BUILD = read("docs/architecture/BUILD.md");
const COVERAGE = read("agents/runtime/coverage.ts");
const HARNESS = read("tests/unit/fixtures/kotlin-harness.ts");

interface Baseline {
  measuredAt: string;
  scope: string;
  headroomPoints: number;
  bun: { lines: number };
  kotlin: { lines: number };
}
const BASELINE = JSON.parse(read("coverage-baseline.json")) as Baseline;

/** Lignes d'un job YAML, jusqu'au job suivant (clé à l'indentation 2). */
function jobBlock(yaml: string, name: string): string {
  const lines = yaml.split("\n");
  const start = lines.findIndex((line) => new RegExp(`^  ${name}:\\s*$`).test(line));
  if (start < 0) return "";
  const end = lines.findIndex((line, i) => i > start && /^  [A-Za-z][\w-]*:\s*$/.test(line));
  return lines.slice(start, end < 0 ? lines.length : end).join("\n");
}

/** Recette YAML sans ses commentaires : on teste l'exécution, pas la prose. */
function recipes(block: string): string {
  return block
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("#"))
    .join("\n");
}

/** Bloc d'une étape nommée, jusqu'à l'étape suivante. */
function step(block: string, name: string): string {
  const start = block.indexOf(`- name: ${name}`);
  if (start < 0) return "";
  const next = block.indexOf("\n      - name:", start + 1);
  return block.slice(start, next < 0 ? block.length : next);
}

describe("CI : job de couverture (#895)", () => {
  const job = jobBlock(CI, "coverage");

  test("le job existe, hors du gate, et rejoue UNE cible", () => {
    expect(job).not.toBe("");
    const body = recipes(job);
    expect(body.match(/\bmake coverage\b/g)?.length).toBe(1);
    expect(body).not.toMatch(/\bmake check\b/);
    // Le gate lui-même ne double pas la suite de couverture.
    expect(recipes(jobBlock(CI, "check"))).not.toContain("make coverage");
    expect(job).toMatch(/timeout-minutes:\s*\d+/);
  });

  test("une baisse sous le seuil rougit le job", () => {
    const couverture = step(job, "Couverture");
    expect(couverture).not.toBe("");
    expect(couverture).not.toContain("continue-on-error");
    expect(couverture).not.toContain("|| true");
    // Aucun `if:` qui neutraliserait l'échec du seuil.
    expect(couverture).not.toMatch(/^\s+if:/m);
  });

  test("les rapports partent en artefact, même en échec", () => {
    const upload = step(job, "Rapports de couverture");
    expect(upload).toContain("if: always()");
    expect(upload).toContain("name: coverage");
    expect(upload).toMatch(/path:\s*coverage\s*$/m);
    expect(upload).toMatch(/retention-days:\s*7/);
    expect(upload).toContain("if-no-files-found: ignore");
  });

  test("la parité tourne avec le compilateur ÉPINGLÉ", () => {
    expect(job).toMatch(/KOTLIN_VERSION:\s*"[\d.]+"/);
    expect(job).toContain("kotlinc-${{ env.KOTLIN_VERSION }}");
    expect(job).toContain('version="$KOTLIN_VERSION"');
  });
});

describe("seuil : mesuré, expliqué, reproductible", () => {
  test("la base porte une mesure datée et son périmètre", () => {
    expect(BASELINE.measuredAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(BASELINE.scope).toMatch(/tests\/unit/);
    expect(BASELINE.scope).toMatch(/parité/i);
    for (const value of [BASELINE.bun.lines, BASELINE.kotlin.lines]) {
      expect(value).toBeGreaterThan(0);
      expect(value).toBeLessThan(100);
    }
  });

  test("seuil = plancher(mesure - marge), jamais une cible inventée", () => {
    expect(BASELINE.headroomPoints).toBe(2);
    expect(thresholdFor(BASELINE.bun.lines, BASELINE.headroomPoints)).toBe(
      Math.floor((BASELINE.bun.lines - 2) * 10) / 10,
    );
    expect(thresholdFor(BASELINE.kotlin.lines, BASELINE.headroomPoints)).toBe(
      Math.floor((BASELINE.kotlin.lines - 2) * 10) / 10,
    );
    // Une base à 0 % ne prouverait rien : la marge ne peut pas créer un seuil.
    expect(thresholdFor(1, 2)).toBe(0);
  });

  test("BUILD.md documente la mesure, la marge et la baisse assumée", () => {
    expect(BUILD).toContain("## Couverture");
    const section = BUILD.slice(BUILD.indexOf("## Couverture"));
    expect(section).toMatch(/JaCoCo/);
    expect(section).toMatch(/coverage-baseline\.json/);
    expect(section).toMatch(/2 points/);
    expect(section).toMatch(/diff explicite/);
  });
});

describe("mesures : lecture bornée", () => {
  test("lcov : LF/LH cumulés, null sans lignes", () => {
    expect(lineCoverageFromLcov("SF:a.ts\nLF:10\nLH:5\nend_of_record\n")).toBe(50);
    expect(lineCoverageFromLcov("SF:a.ts\nLF:3\nLH:3\nSF:b.ts\nLF:1\nLH:1\n")).toBe(100);
    expect(lineCoverageFromLcov("TN:\n")).toBeNull();
  });

  test("JaCoCo : dernier compteur LINE = total, null sans compteur", () => {
    const xml =
      '<report><class><counter type="LINE" missed="9" covered="1"/></class>' +
      '<counter type="LINE" missed="3" covered="1"/></report>';
    expect(lineCoverageFromJacocoXml(xml)).toBe(25);
    expect(lineCoverageFromJacocoXml("<report/>")).toBeNull();
  });
});

describe("JaCoCo et harnais : épinglés, inactifs hors mesure", () => {
  test("version et empreintes sont des littéraux vérifiés au téléchargement", () => {
    expect(JACOCO_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(JACOCO_AGENT_SHA256).toMatch(/^[0-9a-f]{64}$/);
    expect(JACOCO_CLI_SHA256).toMatch(/^[0-9a-f]{64}$/);
    expect(COVERAGE).toContain("createHash(\"sha256\")");
    expect(COVERAGE).toContain("empreinte JaCoCo INVALIDE");
    expect(COVERAGE).toContain(`org.jacoco.agent-\${JACOCO_VERSION}-runtime.jar`);
    expect(COVERAGE).toContain(`org.jacoco.cli-\${JACOCO_VERSION}-nodeps.jar`);
  });

  test("le harnais n'instrumente que sur demande, avec un fichier par JVM", () => {
    expect(HARNESS).toContain('process.env["JACOCO_AGENT_JAR"]');
    expect(HARNESS).toContain('process.env["JACOCO_DIR"]');
    expect(HARNESS).toContain("randomUUID()");
    expect(HARNESS).toContain("append=false");
    // Hors variables : aucun argument ajouté à la ligne `java`.
    expect(HARNESS).toMatch(/if \(!agent \|\| !dir\) return null;/);
  });

  test("la cible make produit lcov, rapport Kotlin et vérifie le seuil", () => {
    const target = /^coverage:(?: ## [^\n]*)?\n((?:\t.*\n)+)/m.exec(MAKEFILE)?.[1] ?? "";
    expect(target).not.toBe("");
    expect(target).toContain("--coverage-reporter=lcov");
    expect(target).toContain("JACOCO_DIR=");
    expect(target).toContain("REQUIRE_KOTLIN_TOOLCHAIN=1");
    expect(target).toContain("coverage.ts report");
    expect(target).toContain("coverage.ts check");
    // Hors gate : pas de cible `check` qui tire la couverture.
    const check = /^check-fast:(?: ## [^\n]*)?\n((?:\t.*\n)+)/m.exec(MAKEFILE)?.[1] ?? "";
    expect(check).not.toContain("coverage");
    expect(read(".gitignore")).toContain("coverage/");
  });
});
