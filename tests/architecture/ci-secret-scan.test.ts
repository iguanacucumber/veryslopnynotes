// Un secret retiré par un commit ultérieur reste dans l'historique : `make
// lint` ne voit que l'arbre courant, donc la CI doit rejouer TOUS les commits.
// Un fichier YAML n'a pas de comportement à tester, le scan de source est ici
// le seul contrôle possible (même raison que ci-permissions.test.ts).
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");
const WORKFLOW = readFileSync(join(ROOT, ".github", "workflows", "secret-scan.yml"), "utf8");
const CONFIG = readFileSync(join(ROOT, ".gitleaks.toml"), "utf8");

function step(name: string): string {
  const marker = `- name: ${name}\n`;
  const start = WORKFLOW.indexOf(marker);
  if (start === -1) throw new Error(`étape CI absente : ${name}`);
  const rest = WORKFLOW.slice(start + marker.length);
  const end = rest.indexOf("\n      - name: ");
  return end === -1 ? rest : rest.slice(0, end);
}

describe("CI : scan de l'historique complet (#903)", () => {
  test("le scan tourne sur chaque PR et sur main", () => {
    const on = /^on:\n([\s\S]*?)(?=\npermissions:)/m.exec(WORKFLOW)?.[1] ?? "";
    expect(on).toMatch(/^ {2}pull_request:$/m);
    expect(on).toMatch(/^ {2}push:\n {4}branches: \[main\]$/m);
  });

  test("le checkout récupère tout l'historique", () => {
    const checkout = step("Code (historique complet)");
    expect(checkout).toContain("fetch-depth: 0");
    expect(checkout).toContain("persist-credentials: false");
  });

  test("gitleaks parcourt toutes les branches et tous les tags", () => {
    const scan = step("Scan de l'historique complet");
    expect(scan).toMatch(/gitleaks"?\s+git \./);
    expect(scan).toContain("--log-opts=--all");
    expect(scan).toContain("--config .gitleaks.toml");
  });

  test("une trouvaille échoue le job", () => {
    const scan = step("Scan de l'historique complet");
    expect(scan).toContain("--exit-code 1");
    expect(scan).not.toContain("--exit-code 0");
    expect(WORKFLOW).not.toContain("continue-on-error");
  });

  test("le binaire est épinglé et vérifié avant exécution", () => {
    const install = step("Gitleaks épinglé");
    const version = /version=(\d+\.\d+\.\d+)/.exec(install)?.[1];
    expect(version).toBe("8.30.1");
    expect(install).toContain("/releases/download/v${version}");
    expect([...install.matchAll(/\b[0-9a-f]{64}\b/g)]).toHaveLength(1);
    const check = install.indexOf("sha256sum -c");
    const extract = install.indexOf("tar -xzf");
    expect(check).toBeGreaterThan(-1);
    expect(extract).toBeGreaterThan(check);
    // Toute action tierce est un SHA de commit, jamais un tag mutable.
    for (const [, ref] of WORKFLOW.matchAll(/uses: [^@\s]+@(\S+)/g)) {
      if (ref!.includes("/")) continue; // sous-chemin local, pas une action
      expect(ref).toMatch(/^[0-9a-f]{40}$/);
    }
  });

  test("aucun secret n'est lu par le scan", () => {
    expect(WORKFLOW).not.toContain("${{ secrets.");
    expect(WORKFLOW).not.toMatch(/GITLEAKS_LICENSE\s*:/);
    expect(WORKFLOW).toMatch(/^permissions:\n {2}contents: read$/m);
    expect(WORKFLOW).not.toMatch(/^\s+\w[\w-]*:\s*write\s*$/m);
  });

  test("l'allowlist ne saute jamais un fichier entier", () => {
    // Une allowlist `paths` globale fait ignorer le fichier AVANT analyse :
    // un vrai secret dans `tests/` passerait. Seules des valeurs exactes sont
    // excusées.
    expect(CONFIG).toContain("useDefault = true");
    expect(CONFIG).not.toMatch(/^disabledRules/m);
    expect(CONFIG).not.toMatch(/^paths =/m);
    const values = [...CONFIG.matchAll(/'''(\^[^']+\$)\*?'''/g)].map((m) => m[1]!);
    expect(values.length).toBeGreaterThan(0);
    for (const value of values) expect(value).toMatch(/^\^.*\$$/);
  });
});
