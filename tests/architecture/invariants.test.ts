import { describe, expect, test } from "bun:test";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { listFiles, moduleBoundaryErrors } from "../../agents/runtime/check-architecture";
import {
  codeOnly,
  hasDirectFetch,
  httpRe,
  platformRe,
  pronoteHost,
  sqliteRe,
  EXECUTABLE_MIME_TYPES,
  parseKotlinStringSet,
  parseMimeTable,
} from "../../agents/runtime/source-guards";
import { readBridgeSource } from "../unit/fixtures/bridge-source";
import {
  expectSourceContains,
  expectSourceMatch,
  expectSourceNotMatch,
} from "../unit/fixtures/source-assert";

const ROOT = join(import.meta.dir, "..", "..");

// Parcours partagé avec le gate : une copie maison ratait les artefacts générés
// (`android/app/src/main/assets/web/`) et flakait sur les dossiers de build.

describe("invariants", () => {
  test("I1: le module direct est déclaré une fois, et il existe", () => {
    const settings = readFileSync(join(ROOT, "android", "settings.gradle.kts"), "utf8");
    expect(settings).toContain('include(":app", ":core", ":data", ":pronote")');
    expect(listFiles(join(ROOT, "android", "pronote")).filter((f) => f.endsWith(".kt")).length).toBeGreaterThan(0);
  });

  test("I1 FP: commentaires et docs ignorés", () => {
    expect(pronoteHost.test(codeOnly("// voir pronote\nconst a = 1;"))).toBe(false);
    expect(pronoteHost.test(codeOnly("/* https://pronote.example */\nconst a = 1;"))).toBe(false);
    expect(pronoteHost.test(codeOnly("const a = 1; // pronote"))).toBe(false);
    expect(pronoteHost.test(codeOnly('const url = "https://api.example.fr/x";'))).toBe(false);
    expect(pronoteHost.test(codeOnly('const url = "https://pronote.example.fr/";'))).toBe(true);
  });

  // `index-education.net` est le domaine RÉEL des établissements PRONOTE
  // (`pronotets`), que `/pronote/i` seul ne reconnaît pas.
  test("I1: l'hôte PRONOTE RÉEL est reconnu (index-education.net)", () => {
    expect(pronoteHost.test(codeOnly('const url = "https://demo.index-education.net/eleve";'))).toBe(true);
    expect(pronoteHost.test(codeOnly('val base = "https://demo.index-education.net/eleve"'))).toBe(true);
    expect(pronoteHost.test(codeOnly('const url = "https://api.example.fr/x";'))).toBe(false);
    expect(
      hasDirectFetch(codeOnly('const u = "https://hubeduconnect.index-education.net/";\nawait fetch(u);')),
    ).toBe(true);
  });

  test("I3 FP: block/javadoc ignorés, multi-lignes détecté", () => {
    expect(sqliteRe.test(codeOnly("/* import sqlite */\nconst a = 1;"))).toBe(false);
    expect(sqliteRe.test(codeOnly("* import sqlite\nconst a = 1;"))).toBe(false);
    expect(httpRe.test(codeOnly('// from "hono"\nconst a = 1;'))).toBe(false);
    expect(sqliteRe.test(codeOnly('import {\n Database\n} from "bun:sqlite";'))).toBe(true);
    expect(httpRe.test(codeOnly('import { Hono } from "hono";'))).toBe(true);
    expect(sqliteRe.test(codeOnly('const a = 1; // sqlite'))).toBe(false);
  });

  test("I3 plateforme: java.net, android.database et androidx.room interdits dans core", () => {
    // Gradle ne voit pas ces imports : le scan étroit de sources les refuse.
    expect(platformRe.test(codeOnly('import java.net.URL'))).toBe(true);
    expect(platformRe.test(codeOnly('import android.database.sqlite.SQLiteDatabase'))).toBe(true);
    expect(platformRe.test(codeOnly('import androidx.room.Room'))).toBe(true);
    expect(platformRe.test(codeOnly('// import java.net.URL\nval a = 1'))).toBe(false);
    expect(platformRe.test(codeOnly('/* import androidx.room.Room */\nval a = 1'))).toBe(false);
  });

  test("I2: la frontière des modules est celle de Gradle", () => {
    // La vérité est dans les quatre `build.gradle.kts` : core/pronote sans
    // dépendance, data -> core+pronote, app -> core+data.
    expect(moduleBoundaryErrors(ROOT)).toEqual([]);
  });

  test("I2 FP: fetch hors Pronote ignoré, accès direct détecté", () => {
    expect(hasDirectFetch(codeOnly("// fetch pronote\nconst a = 1;"))).toBe(false);
    expect(hasDirectFetch(codeOnly('await fetch("https://pronote.example.fr/x");'))).toBe(true);
    expect(
      hasDirectFetch(codeOnly('const u = "https://pronote.example.invalid/eleve/";\nawait fetch(u);')),
    ).toBe(true);
  });

  // Le mot `pronote`/`index-education` est déjà interdit hors de
  // `android/pronote/` (I1) : sa présence + un appel réseau dans le MÊME
  // fichier suffit, la forme de l'URL importe peu.
  test("I2: l'hôte PRONOTE est détecté même assemblé à l'exécution", () => {
    expect(
      hasDirectFetch(
        codeOnly('const h = "index-education" + ".net";\nawait fetch("https://" + h);'),
      ),
    ).toBe(true);
    expect(hasDirectFetch(codeOnly('const h = "pronote";\nawait fetch("https://" + h);'))).toBe(true);
    expect(
      hasDirectFetch(
        codeOnly('const a = "hubeduconnect";\nconst b = "index-education.net";\nawait fetch(a + b);'),
      ),
    ).toBe(true);
    expect(hasDirectFetch(codeOnly('const h = "index-education.net";\nconst a = 1;'))).toBe(false);
    expect(hasDirectFetch(codeOnly("const p = apiProvider;\nawait fetch(apiUrl);"))).toBe(false);
  });

  test("I8 (0.7.0): le serveur ne lit AUCUN credential dans l'environnement", () => {
    // Le serveur ne détient aucun credential : `PORT`/`HOST` et les chemins TLS
    // sont les seules variables lues, dans `start()` ; la clé du certificat vit
    // hors du dépôt. Tout ce qui s'authentifie vient du client.
    const allowedRead = /envValue\(env,\s*"(PORT|HOST|TLS_CERT_FILE|TLS_KEY_FILE)"\)/;
    const hits: string[] = [];
    for (const f of listFiles(join(ROOT, "server"))) {
      for (const line of codeOnly(readFileSync(f, "utf8")).split("\n")) {
        if (!/Bun\.env|process\.env/.test(line)) continue;
        const allowed = allowedRead.test(line) || /= Bun\.env as Record/.test(line);
        if (!allowed) hits.push(`${f.replace(ROOT, "")}: ${line.trim()}`);
      }
    }
    expect(hits).toEqual([]);

    // Vrai positif : la garde doit mordre, pas seulement passer.
    const sneak = 'const k = process.env["OPENROUTER_API_KEY"] ?? "";';
    expect(sneak).toMatch(/process\.env/);
    expect(allowedRead.test(sneak)).toBe(false);

    // La clé privée du certificat reste hors du dépôt (lue à l'exécution).
    expect(listFiles(join(ROOT, "server")).filter((f) => /\.(pem|key)$/.test(f))).toEqual([]);

    expect(existsSync(join(ROOT, ".env.example"))).toBe(false);
    expect(existsSync(join(ROOT, ".env.local"))).toBe(false);
  });

  test("I6: contenu externe marqué UNTRUSTED_DATA dans le port Kotlin", () => {
    // Le marquage est exécuté sur l'appareil, près du prompt qui le consomme.
    const untrusted = join(
      ROOT,
      "android/core/src/main/java/fr/veryslopnynotes/core/Untrusted.kt",
    );
    expectSourceContains(readFileSync(untrusted, "utf8"), "UNTRUSTED_DATA", untrusted);
    expectSourceContains(readFileSync(untrusted, "utf8"), "nonce", untrusted);
    expectSourceContains(readFileSync(untrusted, "utf8"), "createNonce", untrusted);
  });

  // I6 — le contenu externe est une DONNÉE, jamais un programme : le nom d'une
  // pièce jointe vient du serveur, donc son type MIME ne peut pas être exécutable.
  // `WebApp.mimeOfAsset` est hors périmètre (assets locaux, pas une donnée serveur).
  test("I6: la table MIME des pièces jointes ne mappe aucun type exécutable", () => {
    const APP = join(ROOT, "android", "app", "src", "main", "java", "fr", "veryslopnynotes", "app");
    const src = codeOnly(readFileSync(join(APP, "AttachmentMime.kt"), "utf8"));

    const table = parseMimeTable(src);
    expect(table.size).toBeGreaterThan(0);
    const executable = [...table]
      .filter(([, type]) => EXECUTABLE_MIME_TYPES.has(type))
      .map(([ext]) => ext);
    expect({ executable }).toEqual({ executable: [] });

    const refus = parseKotlinStringSet(src, "EXECUTABLE_MIME_TYPES");
    for (const attendu of [
      "text/html",
      "application/xhtml+xml",
      "image/svg+xml",
      "text/xml",
      "application/xml",
      "application/javascript",
    ]) {
      expect([...refus]).toContain(attendu);
    }
    const nonRefuses = [...EXECUTABLE_MIME_TYPES].filter((t) => !refus.has(t));
    expect({ nonRefuses }).toEqual({ nonRefuses: [] });

    const texteSeul = parseKotlinStringSet(src, "TEXT_ONLY_EXTENSIONS");
    for (const ext of ["html", "htm", "svg", "xml"]) {
      expect([...texteSeul]).toContain(ext);
      expect(table.has(ext)).toBe(false);
    }

    const bridge = codeOnly(readBridgeSource());
    expectSourceMatch(
      bridge,
      /openFile\(file,\s*mimeOf\(/,
      join(APP, "VsnBridge.kt"),
    );
  });

  test("I8 closed (#242): envValue n'ouvre que PORT/HOST/TLS_*", () => {
    const allowed = new Set(["PORT", "HOST", "TLS_CERT_FILE", "TLS_KEY_FILE"]);
    const keys = new Set<string>();
    for (const f of listFiles(join(ROOT, "server"))) {
      const src = codeOnly(readFileSync(f, "utf8"));
      for (const m of src.matchAll(/envValue\(\s*env\s*,\s*"([^"]+)"\s*\)/g)) keys.add(m[1]!);
    }
    expect([...keys].sort()).toEqual([...allowed].sort());
  });

  // Un seul endroit décide du prompt et du schéma de la fiche : le pont appelle
  // le point d'entrée public du core, jamais un appel fournisseur à la main.
  test("I5: la fiche de revision passe par le point d'entree public du core", () => {
    const bridge = codeOnly(readBridgeSource());
    const pont = join(
      ROOT,
      "android",
      "app",
      "src",
      "main",
      "java",
      "fr",
      "veryslopnynotes",
      "app",
      "VsnBridge.kt",
    );
    expectSourceMatch(bridge, /RevisionAi\.requestRevisionSheet\(/, pont);
    expectSourceMatch(bridge, /requestRevisionSheet\([^\n]*apiKey/, pont);
    expectSourceNotMatch(bridge, /generateSafe\(/, pont);
    expectSourceNotMatch(bridge, /revisionPromptFor\(/, pont);
    const core = codeOnly(
      readFileSync(
        join(ROOT, "android", "core", "src", "main", "java", "fr", "veryslopnynotes", "core", "RevisionAi.kt"),
        "utf8",
      ),
    );
    expect(core).toMatch(/generateGuardedJson\(provider, SYSTEM_REVISION_JSON/);
  });
});
