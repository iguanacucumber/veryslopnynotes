// #861 — la donnée d'un compte part par UN SEUL chemin (I16).
//
// Le test EXÉCUTE l'orchestrateur Kotlin (`AccountPurgePlan`) : ordre, échec
// typé, store oublié, store retenu. L'inventaire statique vérifie que chaque
// store persistant du dépôt est inscrit dans `AccountDataStore` et que le
// câblage réel fournit une étape pour chacun.
import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { codeOnly } from "../../agents/runtime/source-guards";
import { parityToolchain, ROOT, type ParityLink } from "./fixtures/kotlin-harness";

const DATA = join(ROOT, "android", "data", "src", "main", "java", "fr", "veryslopnynotes", "data");
const APP = join(ROOT, "android", "app", "src", "main", "java", "fr", "veryslopnynotes", "app");
const WEB = join(ROOT, "web", "src");
const FACTORY = join(DATA, "AccountPurgeFactory.kt");
const PAIRING = join(DATA, "PairingRepository.kt");
const DRIVER = join(ROOT, "agents", "runtime", "kotlin-parity", "AccountPurgeMain.kt");

const skip = parityToolchain.skipReason !== null;

let link: ParityLink | null = null;
if (!skip) {
  link = await parityToolchain.openParityLink(DRIVER);
}

afterAll(async () => {
  if (!link) return;
  try {
    await link.ask({ op: "cleanup" });
  } catch {
    // déjà mort : rien à nettoyer.
  }
});

async function ask(op: unknown): Promise<any> {
  return JSON.parse(await link!.ask(op));
}

/** Tous les stores persistants et les ids qu'ils portent dans l'inventaire. */
const STORE_FILES: Record<string, string[]> = {
  // `data` — session, comptes, cache, artefacts hors cache.
  "SessionStore.kt": ["session"],
  "AccountStore.kt": ["accounts"],
  "OfflineCache.kt": ["cache"],
  "LocalDataStore.kt": ["cache"],
  "OfflineArtifacts.kt": ["cache"],
  "LessonNotesStore.kt": ["course_notes"],
  "TeacherChatStore.kt": ["teacher_chat"],
  "SubjectPrefs.kt": ["subject_prefs"],
  "Manuals.kt": ["manual", "manual_prompt_seen"],
  "DownloadedFiles.kt": ["attachments", "exports"],
  "LlmKeyStore.kt": ["llm_key"],
  "AiConsentStore.kt": ["ai_consent"],
  "ServerStore.kt": ["server_url"],
  "WebViewAccountData.kt": ["webview"],
  // `app` — téléchargements, photos, préférences d'apparence.
  "Attachments.kt": ["attachments"],
  "VsnBridgeHomeworkAi.kt": ["attachments"],
  "VsnBridgeRevision.kt": ["exports"],
  "VsnBridgeDataExport.kt": ["exports"],
  "VsnBridgeDiagnostics.kt": ["exports"],
  "PhotoCapture.kt": ["photos"],
  "VsnBridge.kt": ["ui_prefs", "webview", "read_state"],
  "WebViewAccountStorage.kt": ["read_state", "webview"],
  // `web` — l'identifiant lu et son consommateur.
  "readState.ts": ["read_state"],
  "AppContext.tsx": ["read_state"],
};

/** Fichiers qui CITENT un chemin mais ne possèdent pas de store de compte. */
const WIRING_FILES = new Set(["PeriodicSyncWorker.kt"]);

/** Marqueurs de persistance : un fichier qui en porte un doit être inventorié. */
const PERSISTENCE = /filesDir|cacheDir|getSharedPreferences|EncryptedSharedPreferences|localStorage|WebStorage/;

function kotlinFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".kt"))
    .map((f) => join(dir, f));
}

describe("purge de compte — inventaire (#861)", () => {
  test.skipIf(skip)("l'inventaire compilé nomme chaque store et sa politique", async () => {
    const inv = await ask({ op: "inventory" });
    const byId = new Map<string, string>(inv.stores.map((s: any) => [s.id, s.policy]));
    for (const ids of Object.values(STORE_FILES)) {
      for (const id of ids) expect(byId.has(id)).toBe(true);
    }
    // Décisions explicites : la clé part avec la session ; le serveur choisi,
    // le drapeau d'invitation et l'apparence ne sont PAS la donnée du compte.
    expect(byId.get("llm_key")).toBe("purged");
    expect(byId.get("ai_consent")).toBe("retained");
    expect(byId.get("server_url")).toBe("retained");
    expect(byId.get("manual_prompt_seen")).toBe("retained");
    expect(byId.get("ui_prefs")).toBe("retained");
    expect(byId.get("session")).toBe("purged");
    expect(byId.get("cache")).toBe("purged");
  });

  test("chaque store persistant du dépôt est inscrit dans l'inventaire", () => {
    // Un fichier qui touche au disque sans entrée ici échoue : c'est le test
    // qui empêche un nouveau store d'échapper à la purge.
    const known = new Set(Object.keys(STORE_FILES));
    const offenders: string[] = [];
    for (const file of [...kotlinFiles(DATA), ...kotlinFiles(APP)]) {
      const name = basename(file);
      if (known.has(name)) continue;
      if (WIRING_FILES.has(name)) continue;
      const code = codeOnly(readFileSync(file, "utf8"));
      if (PERSISTENCE.test(code)) offenders.push(name);
    }
    // `web` : toute nouvelle lecture locale doit être nommée par la purge.
    const webFiles: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (/\.(ts|tsx)$/.test(entry.name)) webFiles.push(path);
      }
    };
    walk(WEB);
    for (const file of webFiles) {
      if (known.has(basename(file))) continue;
      if (PERSISTENCE.test(codeOnly(readFileSync(file, "utf8")))) offenders.push(basename(file));
    }
    expect({ offenders }).toEqual({ offenders: [] });
  });

  test("le câblage fournit UNE étape par store purgé, et aucune pour un store retenu", () => {
    const factory = codeOnly(readFileSync(FACTORY, "utf8"));
    const wired = new Set([...factory.matchAll(/AccountDataStore\.([A-Z_]+)/g)].map((m) => m[1]!));
    for (const id of [
      "SESSION",
      "ACCOUNTS",
      "COURSE_NOTES",
      "TEACHER_CHAT",
      "SUBJECT_PREFS",
      "MANUAL",
      "ATTACHMENTS",
      "EXPORTS",
      "PHOTOS",
      "READ_STATE",
      "WEBVIEW",
      "CACHE",
      // Clé effacée avec la session ; consentement et serveur emportés par la
      // suppression totale, mais câblés par le même orchestrateur.
      "LLM_KEY",
      "AI_CONSENT",
      "SERVER_URL",
    ]) {
      expect({ id, wired: wired.has(id) }).toEqual({ id, wired: true });
    }
    for (const retained of ["MANUAL_PROMPT", "UI_PREFS"]) {
      expect({ retained, wired: wired.has(retained) }).toEqual({ retained, wired: false });
    }
  });

  test("le pont et le job passent le MÊME orchestrateur au dépôt", () => {
    const pairing = readFileSync(PAIRING, "utf8");
    expect(pairing).toContain("private val purge: AccountPurgeRunner");
    expect(pairing).toContain("purge.purge(AccountPurgeMode.LOGOUT, null)");
    expect(pairing).toContain("purge.purge(AccountPurgeMode.SESSION_DEAD, null)");
    // #858 : l'export demandé avant la purge survit au logout ; seule la
    // suppression totale efface la copie.
    expect(readFileSync(FACTORY, "utf8")).toContain(
      "if (mode == AccountPurgeMode.DELETE_ALL)",
    );
    expect(pairing).toContain("purge.purge(");

    const bridge = readFileSync(join(APP, "VsnBridge.kt"), "utf8");
    expect(bridge).toContain("AccountPurgeFactory.runner(");
    expect(bridge).toContain("purge = accountPurge");
    expect(bridge).not.toContain("purgeManualAccountData");

    const worker = readFileSync(join(DATA, "PeriodicSyncWorker.kt"), "utf8");
    expect(worker).toContain("AccountPurgeFactory.runner(");
    expect(worker).toContain("purge = purge(sessions, store)");
  });
});

describe("purge de compte — exécution (#861)", () => {
  test.skipIf(skip)("déconnexion : tous les stores purgés, cache EN DERNIER", async () => {
    const out = await ask({ op: "plan", mode: "LOGOUT" });
    expect(out.ok).toBe(true);
    expect(out.failed).toEqual([]);
    expect(out.missing).toEqual([]);
    for (const id of [
      "session",
      "accounts",
      "llm_key",
      "course_notes",
      "teacher_chat",
      "subject_prefs",
      "manual",
      "attachments",
      "exports",
      "photos",
      "read_state",
      "webview",
      "cache",
    ]) {
      expect(out.purged).toContain(id);
    }
    // La publication (bascule) attend l'effacement global.
    expect(out.calls.at(-1)).toBe("cache");
  });

  test.skipIf(skip)("une bascule garde la session neuve mais efface clé et fil", async () => {
    const out = await ask({ op: "plan", mode: "ACCOUNT_SWITCH" });
    expect(out.ok).toBe(true);
    expect(out.purged).not.toContain("session");
    expect(out.purged).not.toContain("accounts");
    // La clé et le fil du compte précédent ne suivent pas le nouveau compte.
    expect(out.purged).toContain("llm_key");
    expect(out.purged).toContain("teacher_chat");
    expect(out.calls.at(-1)).toBe("cache");
  });

  test.skipIf(skip)("une session morte efface aussi la clé et le fil", async () => {
    const out = await ask({ op: "plan", mode: "SESSION_DEAD" });
    expect(out.ok).toBe(true);
    expect(out.purged).toContain("llm_key");
    expect(out.purged).toContain("teacher_chat");
  });

  test.skipIf(skip)("suppression totale : la clé et le serveur partent AUSSI, cache EN DERNIER", async () => {
    const out = await ask({ op: "plan", mode: "DELETE_ALL" });
    expect(out.ok).toBe(true);
    expect(out.failed).toEqual([]);
    expect(out.missing).toEqual([]);
    for (const id of ["llm_key", "server_url", "session", "cache", "webview", "read_state"]) {
      expect(out.purged).toContain(id);
    }
    expect(out.calls.at(-1)).toBe("cache");
  });

  test.skipIf(skip)("une étape en échec rend la purge INCOMPLÈTE, sans masquer les autres", async () => {
    const out = await ask({ op: "plan", mode: "LOGOUT", fail: ["manual"] });
    expect(out.ok).toBe(false);
    expect(out.failed).toEqual(["manual"]);
    // Les autres stores partent quand même : on ne s'arrête pas au premier refus.
    expect(out.purged).toContain("cache");
    expect(out.calls).toContain("webview");
  });

  test.skipIf(skip)("un store oublié est SIGNALÉ et RIEN n'est exécuté", async () => {
    const out = await ask({ op: "missing", mode: "LOGOUT", omit: ["webview"] });
    expect(out.ok).toBe(false);
    expect(out.missing).toEqual(["webview"]);
    expect(out.calls).toEqual([]);
  });

  test.skipIf(skip)("un store retenu n'est jamais exécuté", async () => {
    const out = await ask({ op: "retained", mode: "LOGOUT" });
    expect(out.ok).toBe(true);
    expect(out.calls).not.toContain("server_url");
  });
});
