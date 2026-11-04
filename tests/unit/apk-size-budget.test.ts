// Le budget APK a deux contrats : une taille au-dessus du plafond échoue, et le
// workflow mesure l'artefact release sans reconstruire l'APK. Les tailles de
// test sont des fichiers temporaires : aucun APK réel n'est requis.
import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BASELINE_PATH,
  checkApkSize,
  parseBaseline,
  readBaseline,
  summaryMarkdown,
} from "../../agents/runtime/apk-size";

const ROOT = join(import.meta.dir, "..", "..");
const SCRIPT = join(ROOT, "agents", "runtime", "apk-size.ts");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const WORKFLOW = read(".github/workflows/apk-size.yml");
const RELEASE_DOC = read("docs/RELEASE.md");

function baselineJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    schema: 1,
    unit: "bytes",
    apk: "app-release.apk",
    measuredAt: "2026-11-04",
    measuredOn: "fixture",
    measuredBytes: 1_000,
    budgetBytes: 1_024,
    ...overrides,
  });
}

function runScript(apk: string, baseline: string, record: string, summary: string) {
  return Bun.spawnSync(
    [
      process.execPath,
      SCRIPT,
      "--apk",
      apk,
      "--baseline",
      baseline,
      "--record",
      record,
    ],
    {
      cwd: ROOT,
      env: { ...process.env, GITHUB_STEP_SUMMARY: summary },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
}

describe("seuil du budget APK", () => {
  test("égalité = dans le budget, un octet de plus = échec", () => {
    expect(checkApkSize(1_024, 1_024)).toEqual({
      sizeBytes: 1_024,
      budgetBytes: 1_024,
      headroomBytes: 0,
      ok: true,
    });
    const dépassement = checkApkSize(1_025, 1_024);
    expect(dépassement.ok).toBe(false);
    expect(dépassement.headroomBytes).toBe(-1);
    expect(summaryMarkdown(dépassement)).toContain("AU-DESSUS du plafond");
  });

  test("une taille invalide est refusée, jamais un vert par défaut", () => {
    for (const size of [0, -1, 1.5, Number.NaN]) {
      expect(() => checkApkSize(size, 1_024)).toThrow();
    }
    expect(() => checkApkSize(1, 0)).toThrow();
  });
});

describe("baseline versionnée", () => {
  test("en octets, datée et cohérente avec sa mesure", () => {
    const baseline = readBaseline();
    expect(baseline.unit).toBe("bytes");
    expect(baseline.measuredAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(baseline.measuredBytes).toBeGreaterThan(0);
    expect(baseline.budgetBytes).toBeGreaterThanOrEqual(baseline.measuredBytes);
    expect(baseline.apk).toContain("app-release.apk");
    expect(BASELINE_PATH.endsWith("apk-size-baseline.json")).toBe(true);
  });

  test("une unité fausse ou un plafond sous la mesure est refusé", () => {
    expect(() => parseBaseline(baselineJson({ unit: "Mio" }))).toThrow();
    expect(() => parseBaseline(baselineJson({ budgetBytes: 999 }))).toThrow();
    expect(() => parseBaseline(baselineJson({ measuredBytes: 0 }))).toThrow();
  });
});

describe("script exécutable sur un fichier de taille fixe", () => {
  test("passe à la limite, échoue au-dessus, écrit mesure et résumé", () => {
    const dir = mkdtempSync(join(tmpdir(), "vsn-apk-size-"));
    try {
      const baseline = join(dir, "baseline.json");
      const apk = join(dir, "app-release.apk");
      const record = join(dir, "apk-size.json");
      const summary = join(dir, "summary.md");
      writeFileSync(baseline, baselineJson());

      writeFileSync(apk, Buffer.alloc(1_024));
      const ok = runScript(apk, baseline, record, summary);
      expect(ok.exitCode).toBe(0);
      expect(JSON.parse(readFileSync(record, "utf8"))).toMatchObject({
        sizeBytes: 1_024,
        budgetBytes: 1_024,
        ok: true,
      });
      expect(readFileSync(summary, "utf8")).toContain("sous le plafond");

      writeFileSync(apk, Buffer.alloc(1_025));
      const regression = runScript(apk, baseline, record, summary);
      expect(regression.exitCode).toBe(1);
      expect(JSON.parse(readFileSync(record, "utf8"))).toMatchObject({
        sizeBytes: 1_025,
        ok: false,
      });
      expect(existsSync(record)).toBe(true);
      expect(readFileSync(summary, "utf8")).toContain("régression de taille");
      expect(new TextDecoder().decode(regression.stderr)).toContain("ÉCHEC");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("workflow apk-size (#974)", () => {
  test("consomme release-apk sans reconstruire ni re-signer l'APK", () => {
    expect(WORKFLOW).toContain('workflows: ["release-artifact", "release"]');
    expect(WORKFLOW).toContain("gh run download");
    expect(WORKFLOW).toContain("-n release-apk");
    expect(WORKFLOW).not.toContain("assembleRelease");
    expect(WORKFLOW).not.toContain("gradlew");
    expect(WORKFLOW).not.toContain("apksigner");
    expect(WORKFLOW).not.toContain("secrets.");
  });

  test("taille conservée en résumé et artefact, même en échec", () => {
    expect(WORKFLOW).toContain("apk-size.ts");
    expect(WORKFLOW).toContain("--record");
    expect(WORKFLOW).toContain("GITHUB_STEP_SUMMARY");
    expect(WORKFLOW).toMatch(/name: apk-size\n\s+path:.*apk-size\.json/);
    expect(WORKFLOW).toMatch(/retention-days:\s*90/);
    expect(WORKFLOW).toMatch(/if: always\(\)/);
  });

  test("les changements du budget sont exercés sur fixtures, sans APK", () => {
    expect(WORKFLOW).toMatch(/^ {2}pull_request:\n {4}paths:/m);
    expect(WORKFLOW).toContain("apk-size-baseline.json");
    expect(WORKFLOW).toContain("bun test tests/unit/apk-size-budget.test.ts");
  });

  test("un commit antérieur au budget retombe sur la baseline de main", () => {
    expect(WORKFLOW).toContain("Repli budget de main");
    expect(WORKFLOW).toContain("contents/apk-size-baseline.json?ref=$DEFAULT_BRANCH");
    expect(WORKFLOW).toContain("contents/agents/runtime/apk-size.ts?ref=$DEFAULT_BRANCH");
    // Un seul fichier présent = suppression, pas ancienneté : échec explicite.
    expect(WORKFLOW).toContain("Budget APK incomplet");
  });

  test("permissions read-only et actions épinglées", () => {
    expect(WORKFLOW).toMatch(/^permissions:\n {2}contents: read\n {2}actions: read$/m);
    expect(WORKFLOW).not.toMatch(/^\s+\w[\w-]*:\s*write\s*$/m);
    const actions = WORKFLOW.split("\n").flatMap((line) => {
      const match = /^\s+uses:\s+(\S+)/.exec(line);
      return match ? [match[1]!] : [];
    });
    expect(actions.length).toBeGreaterThan(0);
    for (const action of actions) {
      expect({ action, pinned: /@[0-9a-f]{40}$/.test(action) }).toEqual({ action, pinned: true });
    }
    for (const step of WORKFLOW.split(/\n\s*- name:/).filter((s) => s.includes("actions/checkout@"))) {
      expect(step).toContain("persist-credentials: false");
    }
  });

  test("RELEASE.md documente l'unité, la mesure et la mise à jour", () => {
    const section = RELEASE_DOC.slice(RELEASE_DOC.indexOf("## Budget de taille APK"));
    expect(section).toContain("apk-size-baseline.json");
    expect(section).toMatch(/octets/);
    expect(section).toContain("apk-size.ts");
    expect(section).toContain("budgetBytes");
    expect(section).toMatch(/PR/);
  });
});
