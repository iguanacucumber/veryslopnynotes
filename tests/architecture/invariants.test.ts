import { describe, expect, test } from "bun:test";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { listFiles } from "../../agents/runtime/check-architecture";
import {
  codeOnly,
  hasDirectFetch,
  httpRe,
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
  // I1 repointé #200 puis #205 : seul `android/pronote/` parle Pronote en
  // direct ; depuis #205, `data`/`app` manipulent les TYPES du client local
  // (dépendance `project(":pronote")`, ADR-003) — câblage sanctionné, pas un
  // hôte. Le mot reste interdit partout ailleurs dans `android/` ; la
  // déclaration du module dans `settings.gradle.kts` est l'unique mention
  // tolérée hors module. Prose (INVARIANTS, AGENTS.md) en #211.
  test("I1: android sans hote Pronote", () => {
    const files = listFiles(join(ROOT, "android")).filter((f) => {
      if (f.endsWith(".md")) return false;
      if (f.includes("/android/pronote/")) return false;
      try {
        let code = codeOnly(readFileSync(f, "utf8"));
        if (f.endsWith("settings.gradle.kts")) code = code.replace(/^include\(.*\)$/m, "");
        code = code
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

  test("I3: android/core sans sqlite ni framework HTTP", () => {
    const files = listFiles(join(ROOT, "android/core")).filter((f) => {
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
    const server = listFiles(join(ROOT, "server"));
    const directFetch = server.filter((f) => hasDirectFetch(codeOnly(readFileSync(f, "utf8"))));
    expect(directFetch).toEqual([]);
    // Côté app, tout accès réseau Pronote passe par l'unique `Client` dans
    // `android/pronote/` (ADR-003) ; aucun autre module ne fait de réseau.
    const pronote = listFiles(join(ROOT, "android", "pronote"));
    expect(pronote.filter((f) => f.endsWith(".kt")).length).toBeGreaterThan(0);
    // `Client` est `open` depuis #475 (le harnais de parité en dérive un
    // client au stub) : le compte reste UN SEUL client Android.
    const clients = pronote.filter((f) => /^(?:open )?class Client\(/m.test(codeOnly(readFileSync(f, "utf8"))));
    expect(clients.map((f) => f.replace(ROOT, ""))).toHaveLength(1);
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

  // I9 (#172) : AUCUN CODE MORT dans `android/`.
  //
  // Le défaut qu'il traque, sans exception tolérée : un `fun`/`class` de premier
  // niveau dont le nom n'apparaît nulle part ailleurs dans le code Kotlin. C'est
  // ce que laisse une refonte quand elle remplace un composant ou un paramètre :
  // le code compile, il est lu, il est relu à chaque revue, et il n'arrive
  // JAMAIS à l'écran. Le cutover WebView (#333) a fait tomber les helpers qui
  // n'existaient que pour Compose (`enumFr`, `dayLabelFr`, écrans…) : ils sont
  // supprimés avec `android/ui/`, pas ajoutés à la liste.
  //
  // `parseQrPayload` est toléré parce qu'il est un MIROIR TS testé par
  // `android-pairing-sse.test.ts` : supprimer la fonction supprimerait ce que le
  // miroir vérifie. Les noms restants sont les points d'entrée du port Kotlin
  // encore rejoués par les miroirs `tests/unit/android-*.test.ts` (jobs, IA,
  // moyennes) : la liste les garde jusqu'à leur branchement applicatif.
  test("I9: android sans code mort (aucun fun/class jamais appele)", () => {
    const files = listFiles(join(ROOT, "android")).filter((f) => f.endsWith(".kt"));
    const code = files.map((f) => codeOnly(readFileSync(f, "utf8"))).join("\n");
    const tolere = new Set([
      "MainActivity",
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
      // Polish Papillon (dates longues #192) : l'affichage utilise `longDateFr`,
      // mais la chaîne relative reste une logique pure rejouée par les miroirs
      // (`android-discussions.test.ts`, `android-attendance.test.ts`). Pas des
      // restes de refonte : supprimer ces fonctions supprimerait ce qu'elles
      // vérifient (même statut que `lessonBadgeLabel` ci-dessus).
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
    for (const f of listFiles(join(ROOT, "server"))) {
      const src = codeOnly(readFileSync(f, "utf8"));
      for (const m of src.matchAll(/envValue\(\s*env\s*,\s*"([^"]+)"\s*\)/g)) keys.add(m[1]!);
    }
    expect([...keys].sort()).toEqual([...allowed].sort());
  });

  test("I3 Kotlin (#242): core sans OkHttp/Room/SQLite plateforme", () => {
    const extra = /okhttp3|HttpURLConnection|URL\s*\(\s*"https?|android\.net\.|androidx\.room|Room\.databaseBuilder|@Entity|@Dao|SQLiteOpenHelper|android\.database\.sqlite/i;
    const files = listFiles(join(ROOT, "android/core")).filter((f) => extra.test(codeOnly(readFileSync(f, "utf8"))));
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
    expect(bridge).toMatch(/RevisionAi\.requestRevisionFiche\(/);
    // …avec la cle de l'app relayee…
    expect(bridge).toMatch(/requestRevisionFiche\([^\n]*apiKey/);
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

  test("I2 surface (#242): hors pronote/, Client et types protocoles seuls", () => {
    const allowedImports = new Set([
      "Client",
      "ClientOptions",
      "ClientLike",
      "PronoteClientLike",
      "JVal",
      "MFAError",
      // G=22 : l'objet d'une session précédente. `data/` doit savoir le
      // distinguer d'une session MORTE (par TYPE, pas par motif : le message
      // de G=22 contient le mot « session ») — même nature que `MFAError` et
      // `QRCodeDecryptError`, des erreurs de protocole.
      "ExpiredObject",
      "QrCode",
      "QRCodeDecryptError",
      "QrLoginOptions",
    ]);
    const bad: string[] = [];
    for (const mod of ["app", "core", "data"]) {
      for (const f of listFiles(join(ROOT, "android", mod))) {
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
    // `Client` est `open` depuis #475 : le harnais de parité en dérive un
    // client dont l'envoi est un stub (aucun réseau).
    const pronote = listFiles(join(ROOT, "android", "pronote")).filter((f) => f.endsWith(".kt"));
    const src = pronote.map((f) => codeOnly(readFileSync(f, "utf8"))).join("\n");
    expect((src.match(/^(?:open )?class Client\(/gm) ?? []).length).toBe(1);
    expect((src.match(/^open class ClientBase\(/gm) ?? []).length).toBe(1);
    // `ClientInfo` = simple porteuse de données (pas de transport), tolérée.
    expect(src).not.toMatch(/^(?:open )?class (?!Client\(|ClientBase\(|ClientInfo\()\w*Client\w*\(/m);
  });

  // #418 : le bundle Vite est écrit PENDANT le gate (`web-build` écrit dans
  // `android/app/src/main/assets/web/`, et `check.ts` lance les étapes en
  // parallèle) : un parcours qui le liste voit le dossier disparaître sous
  // ses pieds (flake). Le parcours ROBUSTE partagé l'exclut, et les tests
  // d'architecture n'ont plus de parcours « maison » — sans les garde-fous de
  // `listFiles` (exclusion des artefacts, erreur gérée FICHIER PAR FICHIER),
  // le flake revient.
  test("#418: aucun parcours de test ne liste android/app/src/main/assets", () => {
    const artefacts = listFiles(join(ROOT, "android")).filter((f) =>
      f.includes(join("app", "src", "main", "assets")),
    );
    expect(artefacts).toEqual([]);
    // Aucun test d'architecture ne se fabrique sa propre traversée de
    // `android/` : elle n'aurait ni l'exclusion des artefacts, ni la gestion
    // d'erreur par fichier (le `catch` global avalait tout le répertoire).
    // Le motif est assemblé PIÈCE par pièce : écrit en clair, ce fichier se
    // détecterait LUI-MÊME.
    const traverse = new RegExp(["readdir", "Sync|readdir", "\\("].join(""));
    const menages = listFiles(join(ROOT, "tests", "architecture"))
      .filter((f) => {
        const code = codeOnly(readFileSync(f, "utf8"));
        const surAndroid = /join\([^)]*["']android["']/.test(code);
        return traverse.test(code) && surAndroid;
      })
      .map((f) => f.replace(ROOT, ""));
    expect(menages).toEqual([]);
  });

  // #394 : le pont ne laisse JAMAIS une promesse sans réponse. Un `Error`
  // (et non une `Exception`) doit donc être capturé PARTOUT où le pont
  // répond : sinon le fil du worker meurt SANS `resolve` ni `reject`, la
  // promesse JS pend (pour `pairing.scanQr`, dont le délai JS est 0 : pour
  // TOUJOURS) et l'interface bloque sur un chargement infini, sans message.
  test("#394: les réponses du pont capturent Throwable, pas seulement Exception", () => {
    const APP = join(ROOT, "android", "app", "src", "main", "java", "fr", "veryslopnynotes", "app");
    const bridge = codeOnly(readFileSync(join(APP, "VsnBridge.kt"), "utf8"));
    const errors = codeOnly(readFileSync(join(APP, "BridgeErrors.kt"), "utf8"));

    // 1. Le filet : la traduction pure attrape TOUT, `Error` compris.
    expect(errors).toMatch(/fun\s+bridgeCallOutcome/);
    expect(errors).toMatch(/catch\s*\(\s*\w+\s*:\s*Throwable\s*\)/);

    // 2. Le pont passe par ce filet : plus de `catch (Exception)` qui
    //    laisserait un `Error` s'échapper du fil du worker.
    expect(bridge).toContain("bridgeCallOutcome");

    // 3. Tout `catch` du pont qui RÉPOND attrape `Throwable`. Les autres
    //    (`catch (Exception)` d'un repli local : cache en mémoire, photo
    //    absente…) sont des dégradations, pas des réponses : un `Error` y
    //    est repris plus haut, par le filet.
    const repondants = catchBlocks(bridge).filter((b) => /reject\(|resolve\(/.test(b.body));
    expect(repondants.length).toBeGreaterThan(0); // la règle n'est pas vide
    for (const bloc of repondants) {
      expect({ type: bloc.type }).toEqual({ type: "Throwable" });
    }

    // 4. La LIVRAISON de la réponse ne peut pas échouer non plus.
    for (const signature of [
      "private fun reject(",
      "private fun postJs(",
      "private fun cancelRequest(",
    ]) {
      expect(corps(bridge, signature)).toMatch(/catch\s*\(\s*_\s*:\s*Throwable\s*\)/);
    }
  });

  // #539 : toute ENTRÉE du pont répond EXACTEMENT une fois. Deux branches
  // sortaient SANS répondre (identifiant d'appel mal formé, pont fermé) : la
  // promesse JS pendait — pour TOUJOURS sur `pairing.scanQr`, dont le délai
  // JS est 0.
  test("#539: aucune sortie de runCall sans réponse (resolve ou reject)", () => {
    const APP = join(ROOT, "android", "app", "src", "main", "java", "fr", "veryslopnynotes", "app");
    const bridge = codeOnly(readFileSync(join(APP, "VsnBridge.kt"), "utf8"));
    const body = corps(bridge, "private fun runCall(");
    expect(body.length).toBeGreaterThan(0);
    // Chaque `return` de la fonction est précédé d'une réponse — même quand il
    // est en fin de ligne (`if (x) return`). Les retours ÉTIQUETÉS
    // (`return@execute`) ne sortent pas de la fonction : l'appel a été
    // ANNULÉ par le JS, qui a déjà lâché sa promesse.
    const lignes = body.split("\n");
    const sansReponse: string[] = [];
    lignes.forEach((l, i) => {
      if (!/\breturn\b/.test(l) || /\breturn@/.test(l)) return;
      const precedent = lignes.slice(0, i).reverse().find((p) => p.trim() !== "") ?? "";
      if (!/resolve\(|reject\(/.test(precedent)) sansReponse.push(l.trim());
    });
    expect(sansReponse).toEqual([]);
  });
});

/** Un bloc `catch` du Kotlin : le type attrapé et son corps (accolades). */
function catchBlocks(src: string): { type: string; body: string }[] {
  const out: { type: string; body: string }[] = [];
  const re = /catch\s*\(\s*(?:_\s*:\s*|\w+\s*:\s*)([\w.]+)\s*\)/g;
  for (const m of src.matchAll(re)) {
    const suite = src.slice(m.index + m[0].length);
    const debut = suite.indexOf("{");
    let profondeur = 0;
    let fin = suite.length;
    for (let i = debut; i < suite.length; i++) {
      if (suite[i] === "{") profondeur++;
      else if (suite[i] === "}") {
        profondeur--;
        if (profondeur === 0) {
          fin = i + 1;
          break;
        }
      }
    }
    out.push({ type: m[1]!, body: suite.slice(debut, fin) });
  }
  return out;
}

/** Le corps d'une fonction Kotlin, jusqu'à l'accolade qui la ferme. */
function corps(src: string, signature: string): string {
  const debut = src.indexOf(signature);
  if (debut === -1) return "";
  let profondeur = 0;
  for (let i = src.indexOf("{", debut); i < src.length; i++) {
    if (src[i] === "{") profondeur++;
    else if (src[i] === "}") {
      profondeur--;
      if (profondeur === 0) return src.slice(debut, i + 1);
    }
  }
  return "";
}
