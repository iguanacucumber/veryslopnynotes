import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { codeOnly, hasDirectFetch, httpRe, pronoteHost, sqliteRe } from "../../agents/runtime/source-guards";

const ROOT = join(import.meta.dir, "..", "..");

function list(dir: string): string[] {
  const out: string[] = [];
  if (!existsSync(dir)) return out;
  const walk = (d: string) => {
    for (const e of readdirSync(d)) {
      const p = join(d, e);
      if (statSync(p).isDirectory()) {
        if ([".git", "node_modules"].includes(e)) continue;
        walk(p);
      } else if (/\.(ts|tsx|kt|kts|java)$/.test(e)) out.push(p);
    }
  };
  walk(dir);
  return out;
}

describe("invariants", () => {
  // I1 repointé #200 puis #205 : seul `android/pronote/` parle Pronote en
  // direct ; depuis #205, `data`/`ui` manipulent les TYPES du client local
  // (dépendance `project(":pronote")`, ADR-003) — câblage sanctionné, pas un
  // hôte. Le mot reste interdit partout ailleurs dans `android/` ; la
  // déclaration du module dans `settings.gradle.kts` est l'unique mention
  // tolérée hors module. Prose (INVARIANTS, AGENTS.md) en #211.
  test("I1: android sans hote Pronote", () => {
    const files = list(join(ROOT, "android")).filter((f) => {
      if (f.endsWith(".md")) return false;
      if (f.includes("/android/pronote/")) return false;
      try {
        let code = codeOnly(readFileSync(f, "utf8"));
        if (f.endsWith("settings.gradle.kts")) code = code.replace(/^include\(.*\)$/m, "");
        code = code
          // #213 : pré-remplissage appairage = URL réelle de NOTRE
          // établissement (choix utilisateur explicite). Exception nominative.
          .replace("https://9741050y.index-education.net/pronote", "")
          .replace(/project\(":pronote"\)/g, "")
          .replace(/PronoteSession|PronoteClientProvider/g, "")
          .replace(/fr\.veryslopnynotes\.pronote/g, "");
        return pronoteHost.test(code);
      } catch {
        return false;
      }
    });
    expect({ files }).toEqual({ files: [] });
  });

  test("I1: le module direct est déclaré une fois, et il existe", () => {
    const settings = readFileSync(join(ROOT, "android", "settings.gradle.kts"), "utf8");
    expect(settings).toContain('include(":app", ":core", ":data", ":ui", ":pronote")');
    expect(list(join(ROOT, "android", "pronote")).filter((f) => f.endsWith(".kt")).length).toBeGreaterThan(0);
  });

  test("I1 FP: commentaires et docs ignorés", () => {
    expect(pronoteHost.test(codeOnly("// voir pronote\nconst a = 1;"))).toBe(false);
    expect(pronoteHost.test(codeOnly("/* https://pronote.example */\nconst a = 1;"))).toBe(false);
    expect(pronoteHost.test(codeOnly("const a = 1; // pronote"))).toBe(false);
    expect(pronoteHost.test(codeOnly('const url = "https://api.example.fr/x";'))).toBe(false);
    expect(pronoteHost.test(codeOnly('const url = "https://pronote.example.fr/";'))).toBe(true);
  });

  test("I3: android/core sans sqlite ni framework HTTP", () => {
    const files = list(join(ROOT, "android/core")).filter((f) => {
      const code = codeOnly(readFileSync(f, "utf8"));
      return sqliteRe.test(code) || httpRe.test(code);
    });
    expect(files).toEqual([]);
  });

  test("I3 FP: block/javadoc ignorés, multi-lignes détecté", () => {
    expect(sqliteRe.test(codeOnly("/* import sqlite */\nconst a = 1;"))).toBe(false);
    expect(sqliteRe.test(codeOnly("* import sqlite\nconst a = 1;"))).toBe(false);
    expect(httpRe.test(codeOnly('// from "hono"\nconst a = 1;'))).toBe(false);
    expect(sqliteRe.test(codeOnly('import {\n Database\n} from "bun:sqlite";'))).toBe(true);
    expect(httpRe.test(codeOnly('import { Hono } from "hono";'))).toBe(true);
    expect(sqliteRe.test(codeOnly('const a = 1; // sqlite'))).toBe(false);
  });

  test("I2: serveur sans accès Pronote + un seul Client android", () => {
    const server = list(join(ROOT, "server"));
    const directFetch = server.filter((f) => hasDirectFetch(codeOnly(readFileSync(f, "utf8"))));
    expect(directFetch).toEqual([]);
    // Côté app, tout accès réseau Pronote passe par l'unique `Client` dans
    // `android/pronote/` (ADR-003) ; aucun autre module ne fait de réseau.
    const pronote = list(join(ROOT, "android", "pronote"));
    expect(pronote.filter((f) => f.endsWith(".kt")).length).toBeGreaterThan(0);
    const clients = pronote.filter((f) => /^class Client\(/m.test(codeOnly(readFileSync(f, "utf8"))));
    expect(clients.map((f) => f.replace(ROOT, ""))).toHaveLength(1);
  });

  test("I2 FP: fetch hors Pronote ignoré, accès direct détecté", () => {
    // FP: mot pronote + fetch sur lignes différentes, sans URL → ignoré
    expect(hasDirectFetch(codeOnly("const p = pronoteProvider;\nawait fetch(apiUrl);"))).toBe(false);
    // FP: commentaire seul → ignoré
    expect(hasDirectFetch(codeOnly("// fetch pronote\nconst a = 1;"))).toBe(false);
    // vrai positif: même ligne
    expect(hasDirectFetch(codeOnly('await fetch("https://pronote.example.fr/x");'))).toBe(true);
    // vrai positif: URL Pronote + réseau ailleurs
    expect(
      hasDirectFetch(codeOnly('const u = "https://pronote.example.invalid/eleve/";\nawait fetch(u);')),
    ).toBe(true);
  });

  test("I4/I5: IA android sans reseau/secrets/outils (server/ai supprimé en #210)", () => {
    // #210 : `server/ai/` est supprimé (module porté sur le téléphone, #204).
    // Mêmes scans sur le module IA Kotlin (`android/core/`, sans dépendance).
    // L'appel HTTP fournisseur (`data/OpenRouterLlm.kt`) est hors scan ici :
    // piné par tests/unit/android-homework.test.ts.
    expect(existsSync(join(ROOT, "server", "ai"))).toBe(false);
    const ANDROID_AI = ["Untrusted.kt", "LlmGuard.kt", "AiPrompts.kt", "HomeworkAi.kt", "RevisionAi.kt", "Humanize.kt"].map(
      (f) => join(ROOT, "android", "core", "src", "main", "java", "fr", "veryslopnynotes", "core", f),
    );
    for (const f of ANDROID_AI) expect(existsSync(f)).toBe(true);
    const secretRe =
      /sk-or-v1-|OPENROUTER_API_KEY|MASTER_KEY|PRONOTE_PASSWORD|BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY/;
    for (const f of ANDROID_AI) {
      const c = codeOnly(readFileSync(f, "utf8"));
      expect({ file: f, kind: "secret" }).toEqual({ file: f, kind: "secret" });
      expect(c).not.toMatch(secretRe);
      expect(c).not.toMatch(/Bun\.env|process\.env/);
      expect(c).not.toMatch(/fetch\(|XMLHttpRequest|WebSocket|Bun\.serve/);
      expect(c).not.toMatch(/tools\s*[:=]\s*\[[^\]]*[^\s\]]/);
    }
  });

  test("I8 (0.7.0): le serveur ne lit AUCUN credential dans l'environnement", () => {
    // Le serveur ne détient rien : `PORT`/`HOST` (écoute) et les deux CHEMINS TLS
    // sont les SEULES variables lues, et uniquement dans `start()`. Un chemin de
    // certificat local n'est pas un credential : il n'authentifie rien, et la clé
    // qu'il désigne vit hors du dépôt (agents/runtime/dev-tls.sh). Tout ce qui
    // s'authentifie (QR de l'établissement, clé LLM) vient du client, à la demande.
    const allowedRead = /envValue\(env,\s*"(PORT|HOST|TLS_CERT_FILE|TLS_KEY_FILE)"\)/;
    const hits: string[] = [];
    for (const f of list(join(ROOT, "server"))) {
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
    expect(list(join(ROOT, "server")).filter((f) => /\.(pem|key)$/.test(f))).toEqual([]);

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

  // I9 (#172) : AUCUN CODE MORT dans `android/`.
  //
  // Le défaut qu'il traque, sans exception tolérée : un `fun`/`class` de premier
  // niveau dont le nom n'apparaît nulle part ailleurs dans le code Kotlin. C'est
  // ce que laisse une refonte quand elle remplace un composant (`HomeworkHelpButton`
  // mort depuis #161) ou un paramètre (`AppNav.loadAlerts`, mort depuis #144) :
  // le code compile, il est lu, il est relu à chaque revue, et il n'arrive
  // JAMAIS à l'écran.
  //
  // Trois noms sont tolérés, et chacun est un MIROIR TS testé ailleurs :
  // `lessonBadgeLabel`/`timetableDayLabel` rejoués par `android-timetable.test.ts`,
  // `parseQrPayload` par `android-pairing-sse.test.ts`. Supprimer ces trois
  // fonctions supprimerait ce qu'elles vérifient : c'est la LISTE qui est
  // gardée, pas le code.
  //
  // Quatre noms de plus, et chacun est le POINT D'ENTRÉE du port Kotlin (#203),
  // rejoué par les miroirs `tests/unit/android-*.test.ts` (la parité
  // différentielle `kotlin-domain-parity` est supprimée en #210 avec le
  // serveur) : leurs appelants applicatifs arrivent avec #205 (repositories
  // locaux). Ce ne sont pas des restes de refonte, c'est du code vivant sans
  // appelant remarqué — la liste les garde jusqu'au branchement.
  test("I9: android sans code mort (aucun fun/class jamais appele)", () => {
    const files = list(join(ROOT, "android")).filter((f) => f.endsWith(".kt"));
    const code = files.map((f) => codeOnly(readFileSync(f, "utf8"))).join("\n");
    const tolere = new Set([
      "MainActivity",
      "lessonBadgeLabel",
      "timetableDayLabel",
      "parseQrPayload",
      // Port Kotlin #203 : points d'entrée rejoués par les miroirs, branchés en #205.
      "subjectAverage",
      "providedAveragesFor",
      "computeAverages",
      "CapabilityProbe",
      // Port Kotlin #207 : jobs + PDF, points d'entrée rejoués par les miroirs
      // (diff notes, détection DS, notifs, fiches ; parité supprimée en #210).
      // La consommation applicative (repositories locaux, export) arrive après.
      "fingerprint",
      "diffGrades",
      "detectExams",
      "notifyGradeEvents",
      "notifySyncResult",
      "absenceFingerprint",
      "newAbsences",
      "formatAbsencePush",
      "assembleRevisionSheet",
      "notifyRevisionSheets",
      "saveRevisionSheet",
      "loadRevisionSheet",
      "listRevisionSheets",
      "RevisionPdf",
      // Port Kotlin #200/#201 : surface du protocole rejouée par la parité
      // (`kotlin-pronote-parity`, `kotlin-pronote-client-parity`). `enleverAlea`
      // seul attend un appelant (désentrelacement QR/ENT, #205 ou client futur).
      "enleverAlea",
      // Port Kotlin #204 (IA, garde-fous I4/I5/I6) : points d'entrée rejoués par
      // les miroirs `tests/unit/android-homework.test.ts` (parité exécutée
      // supprimée en #210), appelants applicatifs à venir avec le câblage sur
      // l'appareil. `OpenRouterHomework` seul n'est pas rejoué (pas de réseau
      // en miroir) : il est piné par android-homework (clé relue du store,
      // jamais loggée ni en URL).
      "generateGuarded",
      "buildHomeworkPrompt",
      "RevisionAi",
      "Humanize",
      "OpenRouterHomework",
    ]);
    const morts: string[] = [];
    for (const f of files) {
      const src = codeOnly(readFileSync(f, "utf8"));
      // Déclarations de premier niveau seulement : une fonction locale est
      // visible dans son bloc, donc elle n'est pas « morte » du tout.
      const declarations = [
        ...src.matchAll(/^(?:internal |public )?fun ([A-Za-z]\w*)\(/gm),
        ...src.matchAll(/^(?:internal |public )?(?:data |sealed |abstract )?(?:class|object|interface) ([A-Za-z]\w*)/gm),
      ];
      for (const d of declarations) {
        const nom = d[1]!;
        if (tolere.has(nom)) continue;
        const usages = (code.match(new RegExp(`\\b${nom}\\b`, "g")) ?? []).length;
        // 1 = la déclaration elle-même : personne d'autre ne l'a nommé.
        if (usages <= 1) morts.push(`${f.slice(f.lastIndexOf("/") + 1)} : ${nom}`);
      }
    }
    expect({ morts }).toEqual({ morts: [] });
  });

  test("I7: pas de jobs serveur, jobs device sans LLM", () => {
    // #210 : `server/jobs/` est supprimé avec le serveur (jobs portés en
    // Kotlin natif, #207). Les jobs device (`android/core/`) ne touchent ni
    // LLM ni réseau : effets sur données structurées uniquement.
    expect(existsSync(join(ROOT, "server", "jobs"))).toBe(false);
    const CORE = join(ROOT, "android/core/src/main/java/fr/veryslopnynotes/core");
    const jobFiles = ["GradeDiff.kt", "ExamDetect.kt", "NotifyFormat.kt", "RevisionSheet.kt", "RevisionAi.kt", "HomeworkAi.kt"].map(
      (f) => join(CORE, f),
    );
    for (const f of jobFiles) expect(existsSync(f)).toBe(true);
    const offenders = jobFiles.filter((f) => {
      const c = codeOnly(readFileSync(f, "utf8"));
      return /fetch\s*\(|XMLHttpRequest|WebSocket/.test(c) || /generate\s*\(/.test(c);
    });
    expect({ offenders }).toEqual({ offenders: [] });
  });

  // #242 : characterization pins — resserrent des trous prouvés, sans changer
  // la sémantique I1–I8. Chacun échoue sur une casse réelle qui passe les
  // tests ci-dessus (voir issue). Ajouts seuls, aucun test existant modifié.
  test("I8 closed (#242): envValue n'ouvre que PORT/HOST/TLS_*", () => {
    const allowed = new Set(["PORT", "HOST", "TLS_CERT_FILE", "TLS_KEY_FILE"]);
    const keys = new Set<string>();
    for (const f of list(join(ROOT, "server"))) {
      const src = codeOnly(readFileSync(f, "utf8"));
      for (const m of src.matchAll(/envValue\(\s*env\s*,\s*"([^"]+)"\s*\)/g)) keys.add(m[1]!);
    }
    expect([...keys].sort()).toEqual([...allowed].sort());
  });

  test("I3 Kotlin (#242): core sans OkHttp/Room/SQLite plateforme", () => {
    const extra = /okhttp3|HttpURLConnection|URL\s*\(\s*"https?|android\.net\.|androidx\.room|Room\.databaseBuilder|@Entity|@Dao|SQLiteOpenHelper|android\.database\.sqlite/i;
    const files = list(join(ROOT, "android/core")).filter((f) => extra.test(codeOnly(readFileSync(f, "utf8"))));
    expect({ files }).toEqual({ files: [] });
  });

  test("I7 pure jobs (#242): GradeDiff/ExamDetect/NotifyFormat/RevisionSheet sans LLM ni OkHttp", () => {
    const CORE = join(ROOT, "android/core/src/main/java/fr/veryslopnynotes/core");
    const pure = ["GradeDiff.kt", "ExamDetect.kt", "NotifyFormat.kt", "RevisionSheet.kt"].map((f) => join(CORE, f));
    for (const f of pure) expect(existsSync(f)).toBe(true);
    const offenders = pure.filter((f) => {
      const c = codeOnly(readFileSync(f, "utf8"));
      return (
        /generate\w*\s*\(/.test(c) ||
        /requestRevisionFiche\s*\(/.test(c) ||
        /fetch\s*\(|XMLHttpRequest|WebSocket|okhttp3|HttpURLConnection|newCall\s*\(/.test(c)
      );
    });
    expect({ offenders }).toEqual({ offenders: [] });
    // Le test prouve qu'il mord : les points d'entrée LLM existent bien, mais
    // uniquement dans la couche IA (hors jobs purs).
    const ai = readFileSync(join(CORE, "HomeworkAi.kt"), "utf8");
    expect(ai).toMatch(/fun generateHomework\s*\(/);
  });

  test("I2 surface (#242): hors pronote/, Client et types protocoles seuls", () => {
    const allowedImports = new Set([
      "Client",
      "ClientOptions",
      "ClientLike",
      "PronoteClientLike",
      "JVal",
      "MFAError",
      "QrCode",
      "QRCodeDecryptError",
      "QrLoginOptions",
    ]);
    const bad: string[] = [];
    for (const mod of ["app", "core", "data", "ui"]) {
      for (const f of list(join(ROOT, "android", mod))) {
        if (!f.endsWith(".kt")) continue;
        const src = codeOnly(readFileSync(f, "utf8"));
        if (/\b(HttpSession|CookieJar|ClientBase)\b/.test(src)) bad.push(`${f.replace(ROOT, "")}: transport direct`);
        for (const m of src.matchAll(/import fr\.veryslopnynotes\.pronote\.([A-Za-z]+)/g)) {
          if (!allowedImports.has(m[1]!)) bad.push(`${f.replace(ROOT, "")}: import ${m[1]}`);
        }
      }
    }
    expect({ bad }).toEqual({ bad: [] });
    // Un seul transport : `class Client(` + sa base `open class ClientBase(`.
    // Un `class Client2(` ou `object XClient(` passerait l'ancien compteur.
    const pronote = list(join(ROOT, "android", "pronote")).filter((f) => f.endsWith(".kt"));
    const src = pronote.map((f) => codeOnly(readFileSync(f, "utf8"))).join("\n");
    expect((src.match(/^class Client\(/gm) ?? []).length).toBe(1);
    expect((src.match(/^open class ClientBase\(/gm) ?? []).length).toBe(1);
    // `ClientInfo` = simple porteuse de données (pas de transport), tolérée.
    expect(src).not.toMatch(/^(?:open )?class (?!Client\(|ClientBase\(|ClientInfo\()\w*Client\w*\(/m);
  });
});
