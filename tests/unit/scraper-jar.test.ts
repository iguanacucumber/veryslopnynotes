// Jar de session du serveur : répertoire 0700, jar 0600, temporaires nettoyés,
// une seule sauvegarde, et cookies bornés à l'hôte qui les a posés (#945).
// Windows n'a pas les modes POSIX : seuls ces cas sont sautés, jamais sous Linux.
import { afterEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareJarStore, saveJar } from "../../server/infrastructure/jar-store";
import type { JarContext } from "../../server/infrastructure/jar-store";

const POSIX = process.platform !== "win32";
const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "vsn-jar-"));
  dirs.push(dir);
  return dir;
}

function modeOf(path: string): number {
  return statSync(path).mode & 0o777;
}

/** Contexte factice : Playwright écrit le JSON fourni, comme `storageState`. */
function writing(value: unknown): JarContext {
  return {
    storageState: async ({ path }) => {
      writeFileSync(path, JSON.stringify(value));
    },
  };
}

afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe("permissions du jar (#945)", () => {
  test.skipIf(!POSIX)("le répertoire est créé en 0700 et resserré s'il existait", () => {
    const dir = join(tempDir(), "playwright", ".auth");
    const jar = join(dir, "manuals.json");
    const logs: string[] = [];
    prepareJarStore(jar, (message) => logs.push(message));
    expect(modeOf(dir)).toBe(0o700);
    expect(logs).toContain("jar -> repertoire cree (0700)");

    chmodSync(dir, 0o755);
    prepareJarStore(jar, (message) => logs.push(message));
    expect(modeOf(dir)).toBe(0o700);
    expect(logs).toContain("jar -> permissions du repertoire durcies (0700)");
  });

  test.skipIf(!POSIX)("le temporaire est en 0600 AVANT l'écriture, le jar final aussi", async () => {
    const dir = join(tempDir(), "auth");
    const jar = join(dir, "manuals.json");
    const modes: number[] = [];
    const context: JarContext = {
      storageState: async ({ path }) => {
        modes.push(modeOf(path));
        writeFileSync(path, JSON.stringify({ cookies: [], origins: [] }));
      },
    };
    await saveJar(context, jar);
    expect(modes).toEqual([0o600]);
    expect(modeOf(jar)).toBe(0o600);
    expect(readdirSync(dir)).toEqual(["manuals.json"]);
  });

  test.skipIf(!POSIX)("un jar existant en 0644 est resserré au démarrage", () => {
    const dir = join(tempDir(), "auth");
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const jar = join(dir, "manuals.json");
    writeFileSync(jar, "{}", { mode: 0o644 });
    chmodSync(jar, 0o644);
    prepareJarStore(jar);
    expect(modeOf(jar)).toBe(0o600);
  });
});

describe("nettoyage et rotation (#945)", () => {
  test("les temporaires périmés partent, le jar et sa sauvegarde restent", () => {
    const dir = join(tempDir(), "auth");
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const jar = join(dir, "manuals.json");
    writeFileSync(jar, "JAR");
    writeFileSync(`${jar}.bak`, "SAUVEGARDE");
    writeFileSync(`${jar}.tmp-999-1`, "COOKIE-SECRET");
    writeFileSync(`${jar}.bak.tmp-999-1`, "COOKIE-SECRET");
    writeFileSync(join(dir, "autre.json.tmp-999-1"), "GARDE");

    const logs: string[] = [];
    prepareJarStore(jar, (message) => logs.push(message));
    expect(readdirSync(dir).sort()).toEqual([
      "autre.json.tmp-999-1",
      "manuals.json",
      "manuals.json.bak",
    ]);
    expect(logs.some((message) => message.includes("2 temporaire(s)"))).toBe(true);
    // Le nettoyage ne journalise jamais le contenu supprimé.
    expect(logs.join("\n")).not.toContain("COOKIE-SECRET");
  });

  test("la rotation garde une seule sauvegarde et le jar courant", async () => {
    const dir = join(tempDir(), "auth");
    const jar = join(dir, "manuals.json");
    await saveJar(writing({ n: 1 }), jar);
    expect(readdirSync(dir).sort()).toEqual(["manuals.json"]);

    await saveJar(writing({ n: 2 }), jar);
    expect(JSON.parse(readFileSync(jar, "utf8"))).toEqual({ n: 2 });
    expect(JSON.parse(readFileSync(`${jar}.bak`, "utf8"))).toEqual({ n: 1 });

    await saveJar(writing({ n: 3 }), jar);
    expect(JSON.parse(readFileSync(jar, "utf8"))).toEqual({ n: 3 });
    expect(JSON.parse(readFileSync(`${jar}.bak`, "utf8"))).toEqual({ n: 2 });
    expect(readdirSync(dir).sort()).toEqual(["manuals.json", "manuals.json.bak"]);
  });

  test("une écriture ratée laisse le jar précédent intact", async () => {
    const dir = join(tempDir(), "auth");
    const jar = join(dir, "manuals.json");
    await saveJar(writing({ n: 1 }), jar);
    await saveJar(writing({ n: 2 }), jar);
    const logs: string[] = [];
    const failing: JarContext = {
      storageState: async () => {
        throw new Error("disque plein");
      },
    };
    await expect(saveJar(failing, jar, (message) => logs.push(message))).rejects.toThrow("disque plein");
    expect(JSON.parse(readFileSync(jar, "utf8"))).toEqual({ n: 2 });
    expect(JSON.parse(readFileSync(`${jar}.bak`, "utf8"))).toEqual({ n: 1 });
    expect(readdirSync(dir).sort()).toEqual(["manuals.json", "manuals.json.bak"]);
    expect(logs).toContain("jar -> ecriture du jar impossible");
  });

  test("un échec de rotation est journalisé et laisse le jar courant", async () => {
    const dir = join(tempDir(), "auth");
    const jar = join(dir, "manuals.json");
    await saveJar(writing({ n: 1 }), jar);
    // Un répertoire au nom de la sauvegarde empêche le rename de rotation.
    mkdirSync(`${jar}.bak`);
    const logs: string[] = [];
    await expect(saveJar(writing({ n: 2 }), jar, (message) => logs.push(message))).rejects.toThrow();
    expect(JSON.parse(readFileSync(jar, "utf8"))).toEqual({ n: 1 });
    expect(logs).toContain("jar -> rotation de sauvegarde impossible");
    expect(readdirSync(dir).filter((entry) => entry.includes(".tmp-"))).toEqual([]);
  });
});

describe("portée d'hôte du jar (#945)", () => {
  test("un cookie n'est envoyé qu'à l'hôte qui l'a posé", async () => {
    const jar = join(tempDir(), "auth", "manuals.json");
    await saveJar(
      writing({
        cookies: [
          {
            name: "session",
            value: "secret",
            domain: "127.0.0.1",
            path: "/",
            expires: -1,
            httpOnly: true,
            secure: false,
            sameSite: "Lax",
          },
        ],
        origins: [],
      }),
      jar,
    );
    const seen: (string | null)[] = [];
    const server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch(req) {
        seen.push(req.headers.get("cookie"));
        return new Response("ok");
      },
    });
    try {
      const { request } = await import("playwright-core");
      const context = await request.newContext({ storageState: jar });
      try {
        await context.get(`http://127.0.0.1:${server.port}/meme-hote`);
        await context.get(`http://localhost:${server.port}/autre-hote`);
      } finally {
        await context.dispose();
      }
    } finally {
      server.stop(true);
    }
    expect(seen).toEqual(["session=secret", null]);
  });
});
