import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// agents/launch.sh + agents/ship.sh (#343) — la boucle agent doit démarrer sur
// origin/main frais et finir par un push vérifié, sans réseau ni téléphone.
// Fixture : dépôt bare local + stubs `bun`/`make`, donc aucun appel GitHub et
// aucun `make check` réel.
const ROOT = join(import.meta.dir, "..", "..");
const LAUNCH = join(ROOT, "agents", "launch.sh");
const SHIP = join(ROOT, "agents", "ship.sh");

const GIT_ENV: Record<string, string | undefined> = {
  ...process.env,
  GIT_AUTHOR_NAME: "test",
  GIT_AUTHOR_EMAIL: "test@example.invalid",
  GIT_COMMITTER_NAME: "test",
  GIT_COMMITTER_EMAIL: "test@example.invalid",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_TERMINAL_PROMPT: "0",
};

interface Result {
  code: number;
  out: string;
  err: string;
}

function run(cmd: string[], cwd: string, env: Record<string, string | undefined> = {}): Result {
  const p = Bun.spawnSync(cmd, { cwd, env: { ...GIT_ENV, ...env }, stdout: "pipe", stderr: "pipe" });
  const text = new TextDecoder();
  return {
    code: p.exitCode ?? -1,
    out: text.decode(p.stdout),
    err: text.decode(p.stderr),
  };
}

function git(cwd: string, ...args: string[]): Result {
  return run(["git", ...args], cwd);
}

function mustGit(cwd: string, ...args: string[]): string {
  const r = git(cwd, ...args);
  if (r.code !== 0) throw new Error(`git ${args.join(" ")} : ${r.err || r.out}`);
  return r.out.trim();
}

function stub(path: string, body: string): void {
  writeFileSync(path, body);
  chmodSync(path, 0o755);
}

interface Fixture {
  base: string;
  seed: string;
  origin: string;
  work: string;
  bin: string;
}

/** Dépôt bare local + clone de travail + stubs bun/make (aucun réseau). */
function fixture(): Fixture {
  const base = mkdtempSync(join(tmpdir(), "vsn-agent-"));
  const seed = join(base, "seed");
  mkdirSync(join(seed, "android"), { recursive: true });
  writeFileSync(join(seed, "a.txt"), "base\n");
  writeFileSync(join(seed, "android", "README.md"), "android\n");
  mustGit(seed, "init", "-b", "main");
  mustGit(seed, "add", ".");
  mustGit(seed, "commit", "-m", "base");

  const origin = join(base, "origin.git");
  mustGit(base, "init", "--bare", "-b", "main", origin);
  mustGit(seed, "remote", "add", "origin", origin);
  mustGit(seed, "push", "-u", "origin", "main");

  const work = join(base, "work");
  mustGit(base, "clone", origin, work);

  const bin = join(base, "bin");
  mkdirSync(bin);
  stub(join(bin, "bun"), '#!/bin/sh\nprintf \'bun %s\\n\' "$*" >> "$HARNESS/bun.log"\nexit 0\n');
  stub(join(bin, "make"), '#!/bin/sh\nprintf \'make %s\\n\' "$*" >> "$HARNESS/make.log"\nexit 0\n');

  return { base, seed, origin, work, bin };
}

function envFor(f: Fixture): Record<string, string> {
  return {
    PATH: `${f.bin}:${process.env["PATH"] ?? ""}`,
    HARNESS: f.base,
  };
}

describe("agents/launch.sh (#343)", () => {
  test("part de origin/main, installe, copie local.properties et pousse le claim", () => {
    const f = fixture();
    // Le main local du clone reste en retard : c'est exactement le piège d'avant.
    writeFileSync(join(f.seed, "b.txt"), "next\n");
    mustGit(f.seed, "add", ".");
    mustGit(f.seed, "commit", "-m", "next");
    mustGit(f.seed, "push");
    const remoteHead = mustGit(f.origin, "rev-parse", "refs/heads/main");

    writeFileSync(join(f.work, "android", "local.properties"), "sdk.dir=/tmp/sdk\n");
    const wt = join(f.base, "wt-7-flow");
    const r = run([LAUNCH, "7", "flow"], f.work, {
      ...envFor(f),
      VSN_ROOT: f.work,
      VSN_WORKTREE_DIR: wt,
    });

    expect(r.code).toBe(0);
    expect(mustGit(wt, "rev-parse", "HEAD")).toBe(remoteHead);
    expect(readFileSync(join(wt, "android", "local.properties"), "utf8")).toContain("/tmp/sdk");
    expect(readFileSync(join(f.base, "bun.log"), "utf8")).toContain("install --frozen-lockfile");
    expect(mustGit(f.origin, "rev-parse", "--verify", "refs/heads/agent/7-flow")).toBe(remoteHead);
  });

  test("refuse un claim déjà pris sans créer de worktree", () => {
    const f = fixture();
    mustGit(f.seed, "push", "origin", "main:refs/heads/agent/8-flow");
    const wt = join(f.base, "wt-8-flow");

    const r = run([LAUNCH, "8", "flow"], f.work, {
      ...envFor(f),
      VSN_ROOT: f.work,
      VSN_WORKTREE_DIR: wt,
    });

    expect(r.code).toBe(1);
    expect(r.err).toContain("claim pris");
    expect(existsSync(wt)).toBe(false);
  });

  test("--in-place crée la branche depuis origin/main sans worktree", () => {
    const f = fixture();
    writeFileSync(join(f.seed, "b.txt"), "next\n");
    mustGit(f.seed, "add", ".");
    mustGit(f.seed, "commit", "-m", "next");
    mustGit(f.seed, "push");
    const remoteHead = mustGit(f.origin, "rev-parse", "refs/heads/main");

    const r = run([LAUNCH, "9", "flow", "--in-place"], f.work, {
      ...envFor(f),
      VSN_ROOT: f.work,
    });

    expect(r.code).toBe(0);
    expect(mustGit(f.work, "branch", "--show-current")).toBe("agent/9-flow");
    expect(mustGit(f.work, "rev-parse", "HEAD")).toBe(remoteHead);
    expect(mustGit(f.origin, "rev-parse", "--verify", "refs/heads/agent/9-flow")).toBe(remoteHead);
  });
});

describe("agents/ship.sh (#343)", () => {
  test("rebase, check, push et écrit le corps de PR", () => {
    const f = fixture();
    mustGit(f.work, "switch", "-c", "agent/42-flow");
    writeFileSync(join(f.work, "a.txt"), "branch\n");
    mustGit(f.work, "commit", "-am", "flow: change a");
    mustGit(f.work, "push", "-u", "origin", "agent/42-flow");

    // main avance sans conflit : le ship doit rebaser dessus avant de pousser.
    writeFileSync(join(f.seed, "b.txt"), "main\n");
    mustGit(f.seed, "add", ".");
    mustGit(f.seed, "commit", "-m", "main: b");
    mustGit(f.seed, "push");

    const r = run([SHIP, "42", "flow: change a"], f.work, envFor(f));

    expect(r.code).toBe(0);
    expect(readFileSync(join(f.base, "make.log"), "utf8")).toContain("check");
    expect(existsSync(join(f.work, "b.txt"))).toBe(true);
    expect(git(f.work, "merge-base", "--is-ancestor", "origin/main", "HEAD").code).toBe(0);
    expect(mustGit(f.origin, "rev-parse", "refs/heads/agent/42-flow")).toBe(mustGit(f.work, "rev-parse", "HEAD"));

    const body = readFileSync(join(f.work, ".git", "vsn-pr-body.md"), "utf8");
    expect(body).toContain("Closes #42");
    expect(body).toContain("- flow: change a");
    expect(body).toContain("Vérifications");
    expect(r.out).toContain("flow: change a");
  });

  test("abort propre sur conflit : branche intacte, rien poussé", () => {
    const f = fixture();
    mustGit(f.work, "switch", "-c", "agent/43-flow");
    writeFileSync(join(f.work, "a.txt"), "branch\n");
    mustGit(f.work, "commit", "-am", "flow: branch");
    const before = mustGit(f.work, "rev-parse", "HEAD");

    writeFileSync(join(f.seed, "a.txt"), "main\n");
    mustGit(f.seed, "commit", "-am", "main: conflict");
    mustGit(f.seed, "push");

    const r = run([SHIP, "43"], f.work, envFor(f));

    expect(r.code).toBe(1);
    expect(r.err).toContain("rebase");
    expect(mustGit(f.work, "rev-parse", "HEAD")).toBe(before);
    expect(git(f.work, "status", "--porcelain").out.trim()).toBe("");
    expect(git(f.origin, "rev-parse", "--verify", "refs/heads/agent/43-flow").code).not.toBe(0);
    expect(existsSync(join(f.work, ".git", "vsn-pr-body.md"))).toBe(false);
    expect(existsSync(join(f.base, "make.log"))).toBe(false);
  });

  test("refuse un arbre sale avant tout fetch/rebase", () => {
    const f = fixture();
    mustGit(f.work, "switch", "-c", "agent/44-flow");
    writeFileSync(join(f.work, "a.txt"), "dirty\n");

    const r = run([SHIP, "44"], f.work, envFor(f));

    expect(r.code).toBe(1);
    expect(r.err).toContain("arbre sale");
    expect(existsSync(join(f.base, "make.log"))).toBe(false);
  });
});
