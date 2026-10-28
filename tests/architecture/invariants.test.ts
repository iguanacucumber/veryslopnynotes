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

const ROOT = join(import.meta.dir, "..", "..");

// #418 : le parcours des fichiers est celui de `agents/runtime/check-architecture.ts`
// (`listFiles`), pas une copie maison. La copie avait deux défauts : elle
// n'excluait pas les ARTEFACTS GÉNÉRÉS (`android/app/src/main/assets/web/`, le
// bundle Vite réécrit pendant le build) ni les dossiers de build Gradle — le
// dossier pouvait disparaître sous les pieds du parcours (flake) —, et une
// entrée illisible faisait abandonner tout le répertoire en silence.

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

  // #489 : `index-education.net` est le domaine RÉEL des établissements PRONOTE
  // (cf. la référence `pronotets`). `/pronote/i` seul ne le voyait pas : un
  // hôte PRONOTE glissé dans `android/data/` passait la garde I1.
  test("I1: l'hôte PRONOTE RÉEL est reconnu (index-education.net)", () => {
    expect(pronoteHost.test(codeOnly('const url = "https://demo.index-education.net/eleve";'))).toBe(true);
    expect(pronoteHost.test(codeOnly('val base = "https://demo.index-education.net/eleve"'))).toBe(true);
    // Un domaine ordinaire ne déclenche rien.
    expect(pronoteHost.test(codeOnly('const url = "https://api.example.fr/x";'))).toBe(false);
    // Et le serveur ne doit pas non plus y joindre un accès direct.
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
    // Gradle ne voit pas ces imports (pas des dépendances de module) : c'est
    // le scan étroit qui les refuse. Un commentaire n'est pas un import.
    expect(platformRe.test(codeOnly('import java.net.URL'))).toBe(true);
    expect(platformRe.test(codeOnly('import android.database.sqlite.SQLiteDatabase'))).toBe(true);
    expect(platformRe.test(codeOnly('import androidx.room.Room'))).toBe(true);
    expect(platformRe.test(codeOnly('// import java.net.URL\nval a = 1'))).toBe(false);
    expect(platformRe.test(codeOnly('/* import androidx.room.Room */\nval a = 1'))).toBe(false);
  });

  test("I2: la frontière des modules est celle de Gradle", () => {
    // La vérité est dans les quatre `build.gradle.kts` : core/pronote sans
    // dépendance, data -> core+pronote, app -> core+data. Toute autre arête
    // échoue sans qu'il faille recopier les types du port dans un scanner.
    expect(moduleBoundaryErrors(ROOT)).toEqual([]);
  });

  test("I2 FP: fetch hors Pronote ignoré, accès direct détecté", () => {
    // FP: commentaire seul → ignoré (une mention en prose n'est pas un accès)
    expect(hasDirectFetch(codeOnly("// fetch pronote\nconst a = 1;"))).toBe(false);
    // vrai positif: même ligne
    expect(hasDirectFetch(codeOnly('await fetch("https://pronote.example.fr/x");'))).toBe(true);
    // vrai positif: URL Pronote + réseau ailleurs
    expect(
      hasDirectFetch(codeOnly('const u = "https://pronote.example.invalid/eleve/";\nawait fetch(u);')),
    ).toBe(true);
  });

  // #535 : l'hôte PRONOTE assemblé à l'exécution passait le scan. Le mot est
  // dans le fichier, mais PAS dans un littéral complet d'URL : l'ancien scan
  // exigeait le mot ET l'appel réseau sur la MÊME ligne, ou une URL littérale
  // entière. Or le mot `pronote`/`index-education` est déjà INTERDIT hors du
  // module `android/pronote/` (I1) : sa présence + un appel réseau dans le
  // MÊME fichier suffit, la forme de l'URL n'a rien à y faire.
  test("I2: l'hôte PRONOTE est détecté même assemblé à l'exécution", () => {
    // Le cas de l'issue : le mot est dans un littéral, l'URL est concaténée,
    // et l'appel réseau est sur une AUTRE ligne.
    expect(
      hasDirectFetch(
        codeOnly('const h = "index-education" + ".net";\nawait fetch("https://" + h);'),
      ),
    ).toBe(true);
    // Le mot seul, sans mot complet dans un seul littéral : la forme la plus
    // naturelle quand on veut passer sous le radar.
    expect(hasDirectFetch(codeOnly('const h = "pronote";\nawait fetch("https://" + h);'))).toBe(true);
    // Sur plusieurs lignes, le mot et l'appel réseau peuvent être éloignés.
    expect(
      hasDirectFetch(
        codeOnly('const a = "hubeduconnect";\nconst b = "index-education.net";\nawait fetch(a + b);'),
      ),
    ).toBe(true);
    // Le signal est le MOT + un appel réseau dans le même fichier : sans appel
    // réseau, un fichier qui mentionne l'hôte n'est pas un accès.
    expect(hasDirectFetch(codeOnly('const h = "index-education.net";\nconst a = 1;'))).toBe(false);
    // FP préservé : aucune mention d'hôte → rien à signaler.
    expect(hasDirectFetch(codeOnly("const p = apiProvider;\nawait fetch(apiUrl);"))).toBe(false);
  });

  test("I8 (0.7.0): le serveur ne lit AUCUN credential dans l'environnement", () => {
    // Le serveur ne détient rien : `PORT`/`HOST` (écoute) et les deux CHEMINS TLS
    // sont les SEULES variables lues, et uniquement dans `start()`. Un chemin de
    // certificat local n'est pas un credential : il n'authentifie rien, et la clé
    // qu'il désigne vit hors du dépôt (agents/runtime/dev-tls.sh). Tout ce qui
    // s'authentifie (QR de l'établissement, clé LLM) vient du client, à la demande.
    const allowedRead = /envValue\(env,\s*"(PORT|HOST|TLS_CERT_FILE|TLS_KEY_FILE)"\)/;
    const hits: string[] = [];
    for (const f of listFiles(join(ROOT, "server"))) {
      for (const line of codeOnly(readFileSync(f, "utf8")).split("\n")) {
        if (!/Bun\.env|process\.env/.test(line)) continue;
        // La lecture de PORT/HOST/TLS est le seul accès autorisé, et il passe par
        // `envValue(env, "…")` avec un littéral — jamais un nom construit.
        const allowed = allowedRead.test(line) || /= Bun\.env as Record/.test(line);
        if (!allowed) hits.push(`${f.replace(ROOT, "")}: ${line.trim()}`);
      }
    }
    expect(hits).toEqual([]);

    // Vrai positif : une lecture de credential doit être signalée, sinon le test
    // ne prouve rien (il doit mordre, pas juste passer).
    const sneak = 'const k = process.env["OPENROUTER_API_KEY"] ?? "";';
    expect(sneak).toMatch(/process\.env/);
    expect(allowedRead.test(sneak)).toBe(false);

    // La clé privée de ce certificat n'a rien à faire dans le dépôt : ni versionnée,
    // ni même présente (le serveur la lit à l'exécution, hors de l'arbre).
    expect(listFiles(join(ROOT, "server")).filter((f) => /\.(pem|key)$/.test(f))).toEqual([]);

    // Et le template d'env n'existe plus du tout (rien à commiter, rien à documenter).
    expect(existsSync(join(ROOT, ".env.example"))).toBe(false);
    expect(existsSync(join(ROOT, ".env.local"))).toBe(false);
  });

  test("I6: contenu externe marqué UNTRUSTED_DATA dans le port Kotlin", () => {
    // Le marquage est exécuté sur l'appareil, près du prompt qui le consomme.
    const kt = readFileSync(
      join(ROOT, "android/core/src/main/java/fr/veryslopnynotes/core/Untrusted.kt"),
      "utf8",
    );
    expect(kt).toContain("UNTRUSTED_DATA");
    expect(kt).toContain("nonce");
    expect(kt).toContain("createNonce");
  });

  // #398 : I6 — le contenu externe est une DONNÉE, jamais un programme. Le
  // nom d'une pièce jointe vient du SERVEUR : le type MIME qui en découle ne
  // peut donc pas être EXÉCUTABLE, sinon `consignes.html` part vers un
  // lecteur tiers comme du HTML exécutable (script) au lieu d'octets inertes.
  //
  // `WebApp.mimeOfAsset` (les assets LOCAUX de l'app, servis à la WebView)
  // est hors périmètre : ce n'est pas une donnée du serveur.
  test("I6: la table MIME des pièces jointes ne mappe aucun type exécutable", () => {
    const APP = join(ROOT, "android", "app", "src", "main", "java", "fr", "veryslopnynotes", "app");
    const src = codeOnly(readFileSync(join(APP, "AttachmentMime.kt"), "utf8"));

    // 1. La table des formats connus ne sort JAMAIS un type exécutable.
    const table = parseMimeTable(src);
    expect(table.size).toBeGreaterThan(0);
    const executable = [...table]
      .filter(([, type]) => EXECUTABLE_MIME_TYPES.has(type))
      .map(([ext]) => ext);
    expect({ executable }).toEqual({ executable: [] });

    // 2. La liste de refus couvre les types exécutables attendus, ET tous
    //    ceux que le test connaît comme exécutables (le garde-fou runtime
    //    refuse au moins tout le catalogue).
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

    // 3. Les extensions à risque sont explicitement neutralisées en texte, et
    //    aucune n'est servie par la table des formats connus.
    const texteSeul = parseKotlinStringSet(src, "TEXT_ONLY_EXTENSIONS");
    for (const ext of ["html", "htm", "svg", "xml"]) {
      expect([...texteSeul]).toContain(ext);
      expect(table.has(ext)).toBe(false);
    }

    // 4. Le pont sert le type de `mimeOf` — jamais un type écrit en dur pour
    //    une pièce jointe nommée par le serveur.
    const bridge = codeOnly(readFileSync(join(APP, "VsnBridge.kt"), "utf8"));
    expect(bridge).toMatch(/openFile\(file,\s*mimeOf\(/);
  });

  // #242 : characterization pins — resserrent des trous prouvés, sans changer
  // la sémantique I1–I8. Chacun échoue sur une casse réelle qui passe les
  // tests ci-dessus (voir issue). Ajouts seuls, aucun test existant modifié.
  test("I8 closed (#242): envValue n'ouvre que PORT/HOST/TLS_*", () => {
    const allowed = new Set(["PORT", "HOST", "TLS_CERT_FILE", "TLS_KEY_FILE"]);
    const keys = new Set<string>();
    for (const f of listFiles(join(ROOT, "server"))) {
      const src = codeOnly(readFileSync(f, "utf8"));
      for (const m of src.matchAll(/envValue\(\s*env\s*,\s*"([^"]+)"\s*\)/g)) keys.add(m[1]!);
    }
    expect([...keys].sort()).toEqual([...allowed].sort());
  });

  // #428 : UN SEUL endroit decide du prompt et du schema de la fiche. Le pont
  // appelle le point d'entree PUBLIC du core ; il ne forge plus son propre
  // appel fournisseur (la cle n'y etait pas transmise : l'appel echouait
  // toujours, avant meme le reseau).
  test("I5: la fiche de revision passe par le point d'entree public du core", () => {
    const bridge = codeOnly(
      readFileSync(
        join(ROOT, "android", "app", "src", "main", "java", "fr", "veryslopnynotes", "app", "VsnBridge.kt"),
        "utf8",
      ),
    );
    // Le point d'entree canonique…
    expect(bridge).toMatch(/RevisionAi\.requestRevisionSheet\(/);
    // …avec la cle de l'app relayee…
    expect(bridge).toMatch(/requestRevisionSheet\([^\n]*apiKey/);
    // …et plus AUCUN appel fournisseur a la main pour la fiche.
    expect(bridge).not.toMatch(/generateSafe\(/);
    expect(bridge).not.toMatch(/revisionPromptFor\(/);
    // Le prompt et le schema sont decideds par le core, pas par le pont.
    const core = codeOnly(
      readFileSync(
        join(ROOT, "android", "core", "src", "main", "java", "fr", "veryslopnynotes", "core", "RevisionAi.kt"),
        "utf8",
      ),
    );
    expect(core).toMatch(/generateGuardedJson\(provider, SYSTEM_REVISION_JSON/);
  });
});
