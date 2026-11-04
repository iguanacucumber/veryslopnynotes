// Preuves NOMMÉES des promesses de confidentialité (#943). Chaque bloc
// correspond à une promesse du produit et choisit la couche qui peut la
// prouver : Kotlin EXÉCUTÉ par la parité quand le comportement est pur,
// manifeste/Intent/journaux lus à la source quand seul Android les porte.
//
// PRV-04 (#848) / PRV-16 (#860) / PRV-05 (#849) : le consentement et
// l'attestation d'âge sont une porte native versionnée (refus, retrait,
// re-consentement sur changement matériel) ; les preuves ci-dessous couvrent
// le stockage ET l'absence de lecture de clé/appel réseau avant l'accord.
import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { listFiles } from "../../agents/runtime/check-architecture";
import { codeOnly } from "../../agents/runtime/source-guards";
import {
  AI_AGE_ATTESTATION,
  AI_AGE_ATTESTATION_DETAIL,
  AI_CONSENT_ITEMS,
  AI_CONSENT_RETENTION_NOTE,
  AI_CONSENT_VERSION,
} from "../../web/src/features/assistant/consent";
import { BRIDGE_FILES } from "./fixtures/bridge-source";
import { parityToolchain, ROOT, type ParityLink } from "./fixtures/kotlin-harness";

const ANDROID = join(ROOT, "android");
const APP = join(ANDROID, "app", "src", "main", "java", "fr", "veryslopnynotes", "app");
const DATA = join(ANDROID, "data", "src", "main", "java", "fr", "veryslopnynotes", "data");
const CORE = join(ANDROID, "core", "src", "main", "java", "fr", "veryslopnynotes", "core");
const MANIFEST = join(ANDROID, "app", "src", "main", "AndroidManifest.xml");
const DEBUG_MANIFEST = join(ANDROID, "app", "src", "debug", "AndroidManifest.xml");
const RULES = join(ANDROID, "app", "src", "main", "res", "xml", "data_extraction_rules.xml");

const SESSION_DRIVER = join(ROOT, "agents", "runtime", "kotlin-parity", "SessionStoreParityMain.kt");
const DOWNLOADS_DRIVER = join(ROOT, "agents", "runtime", "kotlin-parity", "DownloadedFilesMain.kt");
const EXPORT_DRIVER = join(ROOT, "agents", "runtime", "kotlin-parity", "DataExportMain.kt");
const SECURE_DRIVER = join(ROOT, "agents", "runtime", "kotlin-parity", "SecureWindowParityMain.kt");
const CONSENT_DRIVER = join(ROOT, "agents", "runtime", "kotlin-parity", "AiConsentMain.kt");

const skip = parityToolchain.skipReason !== null;

let sessionLink: ParityLink | null = null;
let downloadsLink: ParityLink | null = null;
let exportLink: ParityLink | null = null;
let secureLink: ParityLink | null = null;
let consentLink: ParityLink | null = null;
if (!skip) {
  sessionLink = await parityToolchain.openParityLink(SESSION_DRIVER);
  downloadsLink = await parityToolchain.openParityLink(DOWNLOADS_DRIVER);
  exportLink = await parityToolchain.openParityLink(EXPORT_DRIVER);
  secureLink = await parityToolchain.openParityLink(SECURE_DRIVER);
  consentLink = await parityToolchain.openParityLink(CONSENT_DRIVER);
}

afterAll(async () => {
  if (!downloadsLink) return;
  try {
    await downloadsLink.ask({ op: "cleanup" });
  } catch {
    // pilote déjà mort : rien à nettoyer.
  }
});

async function ask(link: ParityLink, op: unknown, allowError = false): Promise<any> {
  return JSON.parse(await link.ask(op, { allowError }));
}

function source(path: string): string {
  return codeOnly(readFileSync(path, "utf8"));
}

/** Corps d'une fonction Kotlin, accolades comprises : l'ORDRE des gardes se lit
 *  dans le corps, pas dans le fichier entier. */
function bracesBody(src: string, open: number): string {
  if (open < 0) return "";
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    if (src[i] === "}" && --depth === 0) return src.slice(open + 1, i);
  }
  return "";
}

function functionBody(src: string, signature: string): string {
  const start = src.indexOf(signature);
  if (start < 0) return "";
  return bracesBody(src, src.indexOf("{", start));
}

function appAttrs(xml: string): Map<string, string> {
  const attrs = new Map<string, string>();
  for (const m of (/<application\b([^>]*)>/.exec(xml)?.[1] ?? "").matchAll(
    /android:([A-Za-z]+)="([^"]*)"/g,
  )) {
    attrs.set(m[1]!, m[2]!);
  }
  return attrs;
}

function excludedDomains(xml: string, section: "cloud-backup" | "device-transfer"): Set<string> {
  const body = new RegExp(`<${section}\\b[^>]*>([\\s\\S]*?)</${section}>`).exec(xml)?.[1] ?? "";
  return new Set(
    [...body.matchAll(/<exclude\b[^>]*>/g)]
      .map((tag) => /domain="([^"]+)"/.exec(tag[0])?.[1])
      .filter((domain): domain is string => Boolean(domain)),
  );
}

describe("confidentialité — aucun envoi IA sans clé (#943)", () => {
  test("chaque point d'entrée IA vérifie la clé AVANT de créer l'appel fournisseur", () => {
    // TOUTES les fonctions du pont qui appellent `llmForCall` sont découvertes
    // sur le disque : un nouveau chemin IA sans garde échoue ici, même s'il
    // n'est pas dans la liste d'aujourd'hui. La garde doit être DANS la même
    // fonction et AVANT l'appel : un contrôle dans un helper lointain ne prouve
    // pas que l'envoi est inatteignable sans clé.
    const FUNC = /(?:^|\n)\s*(?:internal|private|public)\s+fun\s+(?:VsnBridge\.)?([A-Za-z0-9_]+)\s*\(/g;
    const offenders: string[] = [];
    let guarded = 0;
    for (const file of BRIDGE_FILES) {
      const code = source(join(APP, file));
      for (const match of code.matchAll(FUNC)) {
        const body = bracesBody(code, code.indexOf("{", match.index ?? 0));
        if (!body.includes("llmForCall")) continue;
        guarded += 1;
        // L'aide devoirs délègue la garde au générateur, prouvée juste après.
        if (match[1] === "askHomework") continue;
        const guard = body.indexOf("MIN_API_KEY_CHARS");
        const call = body.indexOf("llmForCall");
        if (guard < 0 || call < 0 || guard > call) offenders.push(`${file}:${match[1]}`);
      }
    }
    // Sept fonctions aujourd'hui (dont `askHomework`) : le parcours n'a pas pu
    // être vide, et un futur chemin ajouté reste couvert par la boucle.
    expect(guarded).toBeGreaterThanOrEqual(7);
    expect({ offenders }).toEqual({ offenders: [] });
  });

  test("l'aide devoirs relit la clé dans le générateur AVANT de lancer le fil réseau", () => {
    // Ce chemin construit le client puis appelle `generate` : la garde vit dans
    // le générateur, pas dans le pont. Elle doit précéder le fil ET l'envoi.
    const bridge = source(join(APP, "VsnBridgeHomeworkAi.kt"));
    const askHomework = functionBody(bridge, "internal fun VsnBridge.askHomework(");
    expect(askHomework).toContain("OpenRouterHomework(");

    const generator = functionBody(
      source(join(DATA, "OpenRouterLlm.kt")),
      "fun generate(",
    );
    const guard = generator.indexOf("keys.apiKey()");
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(generator.indexOf("Thread {"));
    expect(guard).toBeLessThan(generator.indexOf("HomeworkAi.generateHomework("));
  });

  for (const [name, signature] of [
    ["generateSafe", "override fun generateSafe("],
    ["generateVisionSafe", "override fun generateVisionSafe("],
  ] as const) {
    test(`le client OpenRouter refuse une clé absente avant ${name} -> send()`, () => {
      const body = functionBody(source(join(DATA, "OpenRouterLlm.kt")), signature);
      const guard = body.indexOf("MIN_API_KEY_CHARS");
      expect(guard).toBeGreaterThan(-1);
      expect(guard).toBeLessThan(body.indexOf("send("));
    });
  }
});

describe("confidentialité — consentement IA versionné et attesté (#848, #860, #849)", () => {
  test("la version de copie et la version native ne divergent pas", () => {
    const policy = source(join(CORE, "AiConsent.kt"));
    expect(policy).toContain(`const val AI_CONSENT_VERSION = ${AI_CONSENT_VERSION}`);
    expect(AI_CONSENT_VERSION).toBe(2);
  });

  test("l'attestation nomme l'âge, l'autorisation parentale et l'absence de validation juridique", () => {
    const copy = `${AI_AGE_ATTESTATION} ${AI_AGE_ATTESTATION_DETAIL}`;
    expect(copy).toContain("18 ans");
    expect(copy).toContain("représentant légal");
    expect(copy).toContain("OpenRouter");
    expect(copy).toContain("ne vérifie pas ton âge");
    expect(copy).toContain("pas encore fait l’objet d’une validation juridique");
    // Aucune promesse d'approbation ou de conformité juridique.
    expect(copy).not.toMatch(/approuv|conforme|validé juridiquement|autorisation légale/i);
  });

  test("la copie liste les huit catégories et ne promet pas l'effacement chez le fournisseur", () => {
    expect(AI_CONSENT_ITEMS.map((item) => item.key)).toEqual([
      "prompt",
      "notes",
      "attachments",
      "photos",
      "manual",
      "chat",
      "key",
      "provider",
    ]);
    const copy = [AI_CONSENT_ITEMS.map((item) => `${item.label} ${item.detail}`).join(" "), AI_CONSENT_RETENTION_NOTE].join(" ");
    expect(copy).toContain("OpenRouter");
    expect(copy).toContain("clé");
    // Le code ne peut pas prouver une rétention nulle : aucune promesse de ce type.
    expect(copy).not.toMatch(/aucune? (?:conservation|rétention)|zéro rétention|zéro conservation|jamais conserv/i);
    expect(AI_CONSENT_RETENTION_NOTE).toContain("peuvent conserver");
    expect(copy).toContain("1600 px");
  });

  test.skipIf(skip)("un accord est versionné et attesté, un refus et un retrait persistent", async () => {
    const granted = await ask(consentLink!, { op: "roundtrip", decision: "granted", ageAttested: true });
    expect(granted).toEqual({
      encoded: `granted:${AI_CONSENT_VERSION}:attested`,
      decision: "granted",
      version: AI_CONSENT_VERSION,
      allowsAi: true,
      needsReconsent: false,
      ageAttested: true,
    });

    // Une acceptation d'une AUTRE version ne vaut pas accord : elle redemande
    // l'accord sans jamais le réutiliser (PRV-16).
    const stale = await ask(consentLink!, {
      op: "roundtrip",
      decision: "granted",
      version: AI_CONSENT_VERSION + 1,
      ageAttested: true,
    });
    expect(stale.allowsAi).toBe(false);
    expect(stale.decision).toBe("granted");
    expect(stale.needsReconsent).toBe(true);
    const unknown = await ask(consentLink!, { op: "parse", raw: "granted:999:attested" });
    expect(unknown.allowsAi).toBe(false);
    expect(unknown.needsReconsent).toBe(true);

    // Un accord de la bonne version mais SANS attestation ne s'écrit pas et,
    // s'il est forgé sur le disque, n'autorise ni clé ni appel (#849).
    const unattestedWrite = await ask(
      consentLink!,
      { op: "roundtrip", decision: "granted", ageAttested: false },
      true,
    );
    expect(unattestedWrite).toMatchObject({ error: "IllegalArgumentException" });
    const forged = await ask(consentLink!, { op: "parse", raw: `granted:${AI_CONSENT_VERSION}:none` });
    expect(forged).toMatchObject({ allowsAi: false, needsReconsent: true, ageAttested: false });

    const refused = await ask(consentLink!, { op: "roundtrip", decision: "refused" });
    expect(refused).toMatchObject({
      decision: "refused",
      version: AI_CONSENT_VERSION,
      ageAttested: false,
      allowsAi: false,
    });

    const withdrawn = await ask(consentLink!, { op: "roundtrip", decision: "withdrawn" });
    expect(withdrawn).toMatchObject({
      decision: "withdrawn",
      version: AI_CONSENT_VERSION,
      ageAttested: false,
      allowsAi: false,
    });

    // Enregistrement illisible ou forgé : aucun accord, jamais un défaut permissif.
    for (const raw of [
      "",
      "granted",
      ":1",
      "granted:",
      "peut-être:1",
      "none:1",
      "granted:2:maybe",
      "granted:2:attested:extra",
    ]) {
      const parsed = await ask(consentLink!, { op: "parse", raw });
      expect({ raw, allowsAi: parsed.allowsAi }).toEqual({ raw, allowsAi: false });
    }
  });

  test("chaque chemin IA vérifie le consentement AVANT la clé, le client ou le réseau", () => {
    // Découverte sur le disque : un futur chemin IA sans porte échoue ici.
    const FUNC = /(?:^|\n)\s*(?:internal|private|public)\s+fun\s+(?:VsnBridge\.)?([A-Za-z0-9_]+)\s*\(/g;
    const offenders: string[] = [];
    let guarded = 0;
    for (const file of BRIDGE_FILES) {
      const code = source(join(APP, file));
      for (const match of code.matchAll(FUNC)) {
        const body = bracesBody(code, code.indexOf("{", match.index ?? 0));
        const keyRead = body.indexOf("llmKeys.apiKey()");
        const providerCall = body.indexOf("llmForCall");
        if (keyRead < 0 && providerCall < 0) continue;
        guarded += 1;
        const consent = body.indexOf("aiConsentRefusal");
        if (consent < 0 || (keyRead >= 0 && consent > keyRead) || (providerCall >= 0 && consent > providerCall)) {
          offenders.push(`${file}:${match[1]}`);
        }
      }
    }
    expect(guarded).toBeGreaterThanOrEqual(7);
    expect({ offenders }).toEqual({ offenders: [] });

    // L'enregistrement de clé et la fabrique du client ont leur propre porte.
    const keySaver = functionBody(source(join(APP, "VsnBridgeHomeworkAi.kt")), "internal fun VsnBridge.saveLlmKey(");
    expect(keySaver.indexOf("aiConsentRefusal")).toBeGreaterThan(-1);
    expect(keySaver.indexOf("aiConsentRefusal")).toBeLessThan(keySaver.indexOf('p.string("key")'));

    const client = functionBody(source(join(APP, "VsnBridge.kt")), "internal fun llmForCall(");
    expect(client.indexOf("aiConsent.allowsAi()")).toBeGreaterThan(-1);
    expect(client.indexOf("aiConsent.allowsAi()")).toBeLessThan(client.indexOf("OpenRouterLlm("));

    // Les chemins qui lisent le devoir ou le contexte AVANT la clé : la porte
    // doit précéder ces lectures, qui peuvent sortir en réseau (manuel, pièces).
    const homework = source(join(APP, "VsnBridgeHomeworkAi.kt"));
    for (const [signature, networkCall] of [
      ["internal fun VsnBridge.askHomework(", "loadAssignments("],
      ["internal fun VsnBridge.solveHomeworkPhoto(", "loadAssignments("],
      ["internal fun VsnBridge.generateRevision(", "loadAssignments("],
    ] as const) {
      const body = functionBody(homework, signature);
      expect({ signature, consentAvant: body.indexOf("aiConsentRefusal") < body.indexOf(networkCall) }).toEqual({
        signature,
        consentAvant: true,
      });
    }
    const teacher = source(join(APP, "VsnBridgeTeacher.kt"));
    for (const signature of ["internal fun VsnBridge.teacherTurn(", "internal fun VsnBridge.exercisesHelp("] as const) {
      const body = functionBody(teacher, signature);
      expect({ signature, consentAvant: body.indexOf("aiConsentRefusal") < body.indexOf("aiContextForSubject") }).toEqual({
        signature,
        consentAvant: true,
      });
    }
    const lessons = functionBody(source(join(APP, "VsnBridgeLessons.kt")), "internal fun VsnBridge.lessonsAddPhoto(");
    expect(lessons.indexOf("aiConsentRefusal")).toBeLessThan(lessons.indexOf("awaitPhoto"));
  });

  test("le consentement et l'attestation sont écrits ensemble, le retrait purge ensuite", () => {
    const settings = source(join(APP, "VsnBridgeSettings.kt"));
    const body = functionBody(settings, "internal fun VsnBridge.setAiConsent(");
    const attestation = body.indexOf("AI_AGE_ATTESTATION_REQUIRED_MESSAGE");
    const persist = body.indexOf("aiConsent.decide(");
    expect(attestation).toBeGreaterThan(-1);
    expect(attestation).toBeLessThan(persist);
    expect(persist).toBeGreaterThan(-1);
    expect(persist).toBeLessThan(body.indexOf("llmKeys.clear()"));
    expect(persist).toBeLessThan(body.indexOf("teacherChat.clear()"));
    // Un échec d'effacement ne se masque pas derrière un succès.
    expect(body).toContain('put("ok", false)');
    expect(body).toContain("keyCleared");
    expect(body).toContain("chatCleared");

    // L'instantané expose l'attestation ; l'écran ne la déduit pas d'une clé.
    const snapshot = functionBody(settings, "internal fun VsnBridge.settings(");
    expect(snapshot).toContain('put("aiAgeAttested", consent.ageAttested)');
  });

  test("le stockage natif est durable, fail-closed et sans journal", () => {
    const store = source(join(DATA, "AiConsentStore.kt"));
    expect(store).toContain("parseAiConsent");
    expect(store).toContain("prefs ?: return false");
    expect(store).toContain("prefs?.getString");
    // Un accord sans attestation ne peut pas être écrit par le store.
    expect(store).toContain("decision == AiConsentDecision.GRANTED && !ageAttested");
    expect(store).toContain("encodeAiConsent(decision, ageAttested = ageAttested)");
    // `commit()` synchrone : un force-stop ne doit pas perdre un refus/retrait.
    expect(store).not.toMatch(/\.apply\(\)/);
    expect(store.match(/\.commit\(\)/g)).toHaveLength(2);
    expect(store).not.toMatch(/Log\.|println|printStackTrace/);
  });
});

describe("confidentialité — ni clé ni session dans les journaux (#943)", () => {
  const LOG_CALL = /\b(?:Log\.[vdiwe]|System\.(?:err|out)\.println|\bprintln)\s*\(/;
  // Noms de champs sensibles, pas le mot « session » d'un message générique.
  const SECRET_WORD =
    /\b(?:apiKey|llmKey|sessionToken|token|jeton|password|motdepasse|username|uuid|Bearer|Authorization)\b/i;

  const kotlin = listFiles(ANDROID)
    .filter((path) => path.endsWith(".kt"))
    .map((path) => ({ path, code: codeOnly(readFileSync(path, "utf8")) }));

  test("aucun journal Android n'interpole un secret", () => {
    const offenders: string[] = [];
    for (const { path, code } of kotlin) {
      for (const line of code.split("\n")) {
        if (!LOG_CALL.test(line)) continue;
        if (SECRET_WORD.test(line)) {
          offenders.push(`${path.replace(ROOT, "")}: ${line.trim()}`);
          continue;
        }
        for (const dynamic of line.matchAll(/\$\{[^}]+\}|\$[A-Za-z_]\w*/g)) {
          // Seule interpolation admise : le NOM de classe d'une exception.
          if (dynamic[0] !== "${t.javaClass.simpleName}") {
            offenders.push(`${path.replace(ROOT, "")}: ${line.trim()}`);
          }
        }
        if (/\b(?:e|t|error|throwable)\.(?:message|stackTrace|toString)\b/.test(line)) {
          offenders.push(`${path.replace(ROOT, "")}: ${line.trim()}`);
        }
      }
    }
    expect({ offenders }).toEqual({ offenders: [] });
  });

  test("aucune trace de pile brute dans le code Android", () => {
    const offenders = kotlin
      .filter(({ code }) => /\bprintStackTrace\b/.test(code))
      .map(({ path }) => path.replace(ROOT, ""));
    expect({ offenders }).toEqual({ offenders: [] });
  });

  test("les stores de session et de clé ne journalisent rien", () => {
    for (const file of ["SessionRecord.kt", "LlmKeyStore.kt", "LlmKeyFallback.kt"]) {
      const code = source(join(DATA, file));
      expect({ file, journal: /Log\.|println|printStackTrace|System\.(?:err|out)/.test(code) }).toEqual({
        file,
        journal: false,
      });
    }
  });

  test.skipIf(skip)("le toString() d'une session ne porte ni jeton, ni login, ni URL", async () => {
    const text = (await ask(sessionLink!, { op: "toString" })).text as string;
    expect(text).toBe("StoredSession(url=***, user=***)");
    for (const secret of ["jeton-factice", "eleve.a", "etab.exemple", "uuid-factice", "https"]) {
      expect({ secret, présent: text.includes(secret) }).toEqual({ secret, présent: false });
    }
  });

  test("la session n'est pas une data class : aucun toString() généré", () => {
    expect(source(join(DATA, "SessionRecord.kt"))).not.toContain("data class StoredSession");
  });
});

describe("confidentialité — ni clé ni session dans une sauvegarde (#943)", () => {
  test("le manifeste ferme la sauvegarde cloud ET le transfert appareil-à-appareil", () => {
    const attrs = appAttrs(readFileSync(MANIFEST, "utf8"));
    expect(attrs.get("allowBackup")).toBe("false");
    expect(attrs.get("dataExtractionRules")).toBe("@xml/data_extraction_rules");

    const rules = readFileSync(RULES, "utf8");
    for (const section of ["cloud-backup", "device-transfer"] as const) {
      const domains = excludedDomains(rules, section);
      // `sharedpref` porte la session et la clé chiffrées ; `root`/`file`
      // portent les payloads Pronote et les artefacts du compte.
      for (const domain of ["root", "file", "sharedpref"]) {
        expect({ section, domain, exclu: domains.has(domain) }).toEqual({
          section,
          domain,
          exclu: true,
        });
      }
    }
  });

  test("le variant debug ne rouvre pas la sauvegarde", () => {
    const attrs = appAttrs(readFileSync(DEBUG_MANIFEST, "utf8"));
    expect(attrs.get("allowBackup") ?? "false").toBe("false");
  });
});

// Noms de champs sensibles interdits dans le corps d'un Intent.
const SECRET_WORD_IN_INTENT =
  /\b(?:apiKey|llmKey|sessionToken|token|jeton|password|motdepasse|username|uuid|Bearer|Authorization)\b/i;

describe("confidentialité — ni clé ni session dans un Intent (#943)", () => {
  const appCode = listFiles(join(ANDROID, "app", "src", "main"))
    .filter((path) => path.endsWith(".kt"))
    .map((path) => codeOnly(readFileSync(path, "utf8")))
    .join("\n");

  test("le partage ne met QU'UN flux de fichier dans l'Intent", () => {
    const extras = [...appCode.matchAll(/putExtra\(\s*([^,\n]+)/g)].map((m) => m[1]!.trim());
    expect([...new Set(extras)]).toEqual(["Intent.EXTRA_STREAM"]);
    // Aucun Intent ne relit d'extra : le deep link ne lit que `intent.data`.
    expect(appCode).not.toMatch(/get(?:String|Parcelable|Serializable)Extra|getExtras/);
  });

  test("ouvrir et partager ne lisent que le fichier préparé, jamais un secret", () => {
    const bridge = source(join(APP, "VsnBridge.kt"));
    for (const [name, signature] of [
      ["openFile", "internal fun openFile("],
      ["shareFile", "internal fun shareFile("],
    ] as const) {
      const body = functionBody(bridge, signature);
      expect({ name, fileProvider: body.includes("FileProvider.getUriForFile") }).toEqual({
        name,
        fileProvider: true,
      });
      expect({ name, secret: SECRET_WORD_IN_INTENT.test(body) }).toEqual({ name, secret: false });
    }
    const share = functionBody(bridge, "internal fun shareFile(");
    expect(share).toContain("Intent.ACTION_SEND");
    expect(share).toContain("Intent.EXTRA_STREAM, uri");
  });

  test("le deep link ne lit que la route, jamais un extra porteur de secret", () => {
    const activity = source(join(APP, "MainActivity.kt"));
    const route = functionBody(activity, "private fun routePath(");
    expect(route).toContain("intent?.data");
    expect(route).not.toMatch(/extra|Bearer|Authorization|token|jeton/i);
  });

  test.skipIf(skip)("le fichier partagé (export) ne contient ni jeton ni clé", async () => {
    const leaked = "valeur-secrete-a-ne-pas-exporter";
    const poisoned = JSON.stringify({
      grades: [
        { id: "safe", subject: "Mathématiques", value: 15 },
        {
          id: "leak",
          subject: "NSI",
          value: 10,
          token: leaked,
          nested: { api_key: leaked },
        },
      ],
    });
    const out = await ask(exportLink!, {
      op: "build",
      exportedAt: "2026-11-04T00:00:00Z",
      grades: [poisoned],
    });
    expect(out.ok).toBe(true);
    expect(out.summary.gradeIds).toEqual(["safe"]);
    expect({ fuite: out.json.includes(leaked) }).toEqual({ fuite: false });
    for (const withheld of ["sessionToken", "llmKey", "serverUrl", "credentials"]) {
      expect(out.summary.withheld).toContain(withheld);
    }
  });
});

describe("confidentialité — FLAG_SECURE en release (#943)", () => {
  test.skipIf(skip)("la décision protège la release et laisse le debug capturable", async () => {
    expect((await ask(secureLink!, { op: "secure", debug: false })).secure).toBe(true);
    expect((await ask(secureLink!, { op: "secure", debug: true })).secure).toBe(false);
  });

  test("l'activité applique la décision, sans flag en dur", () => {
    const activity = source(join(APP, "MainActivity.kt"));
    const host = source(join(APP, "SecureWindowHost.kt"));
    expect(activity).toContain("applySecureWindow(window, BuildConfig.DEBUG)");
    expect(activity).not.toContain("FLAG_SECURE");
    expect(host).toContain("secureWindowRequired(isDebugBuild)");
    expect(host).toContain("WindowManager.LayoutParams.FLAG_SECURE");
  });
});

describe("confidentialité — la purge efface les artefacts (#943)", () => {
  test.skipIf(skip)("la déconnexion supprime pièces jointes, exports et photos du cache", async () => {
    const sid = (await ask(downloadsLink!, { op: "newStore" })).sid as number;
    const attachment = await ask(downloadsLink!, {
      op: "write",
      sid,
      homework: "devoir-1",
      id: "101",
      label: "consigne.pdf",
      content: "piece",
    });
    await ask(downloadsLink!, { op: "seed", sid, dir: "exports", name: "fiche.pdf", content: "fiche" });
    await ask(downloadsLink!, { op: "seed", sid, dir: "photos", name: "photo.jpg", content: "photo" });

    const before = (await ask(downloadsLink!, { op: "files", sid })).files as string[];
    expect(before).toEqual([
      `attachments/devoir-1/${attachment.name}`,
      "exports/fiche.pdf",
      "photos/photo.jpg",
    ]);

    // Le vrai chemin de purge du cache (déconnexion / session morte).
    await ask(downloadsLink!, { op: "logout", sid });
    expect((await ask(downloadsLink!, { op: "files", sid })).files).toEqual([]);
  });

  test("l'inventaire de purge nomme les artefacts et garde le cache EN DERNIER", () => {
    const factory = source(join(DATA, "AccountPurgeFactory.kt"));
    // La première occurrence de `CACHE` est le refus d'une bascule sans
    // destination ; l'ÉTAPE est celle qui compte pour l'ordre.
    const cache = factory.indexOf("AccountPurgeStep(AccountDataStore.CACHE)");
    expect(cache).toBeGreaterThan(-1);
    for (const id of ["ATTACHMENTS", "EXPORTS", "PHOTOS", "AI_CONSENT"]) {
      const step = factory.indexOf(`AccountPurgeStep(AccountDataStore.${id})`);
      expect({ id, présent: step > -1 }).toEqual({ id, présent: true });
      expect({ id, avantCache: step < cache }).toEqual({ id, avantCache: true });
    }
  });
});
