// Le sandbox Chromium est une DÉCISION de sécurité, pas un défaut de lib :
// Playwright lance sans sandbox tant que `chromiumSandbox` n'est pas
// explicitement `true`. Ces contrôles statiques rougissent si le code, la
// commande Docker, le profil seccomp ou le modèle de menace revient en arrière.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CHROMIUM_LAUNCH_OPTIONS } from "../../server/infrastructure/manuals-scrape";

const ROOT = join(import.meta.dir, "..", "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

const DOCKERFILE = "Dockerfile.server";
const README = "server/README.md";
const PROFILE = "server/chromium-seccomp.json";
const SOURCE = "server/infrastructure/manuals-scrape.ts";

// Bits de `clone(2)` / `unshare(2)` (Linux) : le profil seccomp les refuse par
// masque. Les noms rendent une régression lisible.
const CLONE_NEWNS = 0x00020000;
const CLONE_NEWCGROUP = 0x02000000;
const CLONE_NEWUTS = 0x04000000;
const CLONE_NEWIPC = 0x08000000;
const CLONE_NEWUSER = 0x10000000;
const CLONE_NEWPID = 0x20000000;
const CLONE_NEWNET = 0x40000000;

interface Arg {
  readonly index: number;
  readonly value: number;
  readonly valueTwo?: number;
  readonly op: string;
}
interface SyscallRule {
  readonly names: readonly string[];
  readonly action: string;
  readonly args?: readonly Arg[];
  readonly comment?: string;
  readonly includes?: { readonly caps?: readonly string[] };
}
interface Profile {
  readonly defaultAction: string;
  readonly syscalls: readonly SyscallRule[];
}

const profile = JSON.parse(read(PROFILE)) as Profile;
const chromiumRules = profile.syscalls.filter((rule) => rule.comment?.startsWith("Chromium"));
const chromiumRule = (name: string): SyscallRule => {
  const found = chromiumRules.filter((rule) => rule.names.includes(name));
  expect(found).toHaveLength(1);
  return found[0]!;
};
const dockerRun = /```sh\n(docker run[\s\S]*?)```/.exec(read(README))?.[1] ?? "";

/**
 * `SCMP_CMP_MASKED_EQ` matche `(arg & value) == valueTwo`. Omettre `valueTwo`
 * vaut 0 ; une valeur non nulle changerait la règle en « au moins un bit
 * interdit présent » (donc ouvrirait les namespaces refusés).
 */
function expectMaskAllowsOnly(rule: SyscallRule): void {
  expect(rule.args?.length).toBeGreaterThan(0);
  for (const arg of rule.args ?? []) {
    expect({ index: arg.index, valueTwo: arg.valueTwo }).toEqual({
      index: arg.index,
      valueTwo: arg.valueTwo === undefined ? undefined : 0,
    });
  }
}

describe("sandbox Chromium — décision explicite", () => {
  test("le lancement impose chromiumSandbox, jamais un défaut implicite", () => {
    expect(CHROMIUM_LAUNCH_OPTIONS.chromiumSandbox).toBe(true);
    expect(CHROMIUM_LAUNCH_OPTIONS.headless).toBe(true);
    // Un `args` brut pourrait réintroduire le contournement.
    expect(CHROMIUM_LAUNCH_OPTIONS).not.toHaveProperty("args");
  });

  test("le code serveur ne passe jamais l'option de contournement", () => {
    expect(read(SOURCE)).not.toContain("--no-sandbox");
  });
});

describe("sandbox Chromium — profil seccomp étroit", () => {
  test("le défaut reste le refus", () => {
    expect(profile.defaultAction).toBe("SCMP_ACT_ERRNO");
  });

  test("clone n'ouvre que user/PID/net ; mount, cgroup, UTS et IPC restent refusés", () => {
    const clone = chromiumRule("clone");
    expect(clone.action).toBe("SCMP_ACT_ALLOW");
    // valueTwo à 0 : la règle n'ouvre que si AUCUN bit interdit n'est posé.
    expectMaskAllowsOnly(clone);
    const mask = clone.args?.[0]?.value ?? 0;
    // Masque de refus : chaque bit présent interdit le drapeau correspondant.
    expect(mask & (CLONE_NEWNS | CLONE_NEWCGROUP | CLONE_NEWUTS | CLONE_NEWIPC)).not.toBe(0);
    expect(mask & (CLONE_NEWUSER | CLONE_NEWPID | CLONE_NEWNET)).toBe(0);
  });

  test("unshare n'ouvre que CLONE_NEWUSER", () => {
    const unshare = chromiumRule("unshare");
    expectMaskAllowsOnly(unshare);
    const mask = unshare.args?.[0]?.value ?? 0;
    expect(mask & CLONE_NEWUSER).toBe(0);
    for (const forbidden of [
      CLONE_NEWNS,
      CLONE_NEWCGROUP,
      CLONE_NEWUTS,
      CLONE_NEWIPC,
      CLONE_NEWPID,
      CLONE_NEWNET,
    ]) {
      expect(mask & forbidden).not.toBe(0);
    }
  });

  test("chroot n'est ouvert que par la règle Chromium", () => {
    const chroot = chromiumRule("chroot");
    expect(chroot.args).toBeUndefined();
    const otherChroots = profile.syscalls.filter(
      (rule) =>
        rule !== chroot && rule.action === "SCMP_ACT_ALLOW" && rule.names.includes("chroot"),
    );
    // Le défaut Docker le conditionne à CAP_SYS_CHROOT, capability retirée.
    expect(otherChroots).toHaveLength(1);
    expect(otherChroots[0]?.includes?.caps).toContain("CAP_SYS_CHROOT");
  });

  test("mount reste conditionné à CAP_SYS_ADMIN (aucune capability dans le conteneur)", () => {
    const mounts = profile.syscalls.filter(
      (rule) => rule.action === "SCMP_ACT_ALLOW" && rule.names.includes("mount"),
    );
    expect(mounts.length).toBeGreaterThan(0);
    for (const mount of mounts) expect(mount.includes?.caps).toContain("CAP_SYS_ADMIN");
  });
});

describe("sandbox Chromium — commande Docker et documentation", () => {
  const dockerfile = read(DOCKERFILE);
  const readme = read(README);

  test("la commande documentée charge le profil seccomp et durcit le conteneur", () => {
    expect(dockerRun).toContain("--security-opt seccomp=./server/chromium-seccomp.json");
    for (const flag of ["--read-only", "--cap-drop=ALL", "no-new-privileges"]) {
      expect(dockerRun).toContain(flag);
    }
    expect(dockerRun).not.toContain("--no-sandbox");
    expect(dockerRun).not.toContain("--privileged");
  });

  test("l'image tourne non-root (le sandbox Chromium l'exige)", () => {
    const users = dockerfile
      .split("\n")
      .filter((line) => /^\s*USER\b/.test(line))
      .map((line) => line.replace(/^\s*USER\s+/, "").trim());
    expect(users.length).toBeGreaterThan(0);
    for (const user of users) expect(user).not.toBe("root");
  });

  test("le README interdit le repli silencieux et ne promet pas une VM", () => {
    expect(readme).toMatch(/sandbox de Chromium est ACTIF/i);
    expect(readme).toMatch(/échoue/i);
    expect(readme).toMatch(/PAS une\s+isolation VM/);
  });

});
