import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { isContractEvent } from "../../shared/contracts/events";
import { CONTRACTS_VERSION } from "../../shared/contracts/models";

const ROOT = join(import.meta.dir, "..", "..");
const DATA = join(ROOT, "android/data/src/main/java/fr/veryslopnynotes/data");
const UI = join(ROOT, "android/ui/src/main/java/fr/veryslopnynotes/ui");

function read(p: string): string {
  return readFileSync(p, "utf8");
}

// Miroir TS de parseSchoolQr (PairingRepository.kt) : le QR de
// l'établissement, JSON ou compact. Doit rester en sync avec le Kotlin.
function tsParseSchoolQr(raw: string): { login: string; jeton: string; url: string | null } | null {
  const text = raw.trim();
  if (text === "") return null;
  if (text.startsWith("{")) {
    try {
      const o = JSON.parse(text) as Record<string, unknown>;
      const login = String(o["login"] ?? "").trim();
      const jeton = String(o["jeton"] ?? "").trim();
      const url = String(o["url"] ?? "").trim();
      if (login === "" || login.length > 1024 || jeton === "" || jeton.length > 1024) return null;
      return { login, jeton, url: url === "" ? null : url };
    } catch {
      return null;
    }
  }
  const parts = text.split("|");
  if (parts.length < 2) return null;
  const login = (parts[0] ?? "").trim();
  const jeton = (parts[1] ?? "").trim();
  const url = (parts[2] ?? "").trim();
  if (login === "" || login.length > 1024 || jeton === "" || jeton.length > 1024) return null;
  return { login, jeton, url: url === "" ? null : url };
}

function codeOnly(content: string): string {
  const noBlock = content.replace(/\/\*[\s\S]*?\*\//g, "\n");
  return noBlock
    .split("\n")
    .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*"))
    .map((l) => {
      const idx = l.search(/(?<!:)\/\//);
      return idx >= 0 ? l.slice(0, idx) : l;
    })
    .join("\n");
}

describe("unit android pairing device-only (#206) + sync périodique (#208)", () => {
  test("fichiers app présents (diff minimal, zone autorisée)", () => {
    for (const f of [
      join(DATA, "PairingRepository.kt"),
      join(DATA, "SessionStore.kt"),
      join(DATA, "DeviceAuth.kt"),
      join(DATA, "PeriodicSyncWorker.kt"),
      join(UI, "PairingUiState.kt"),
      join(UI, "PairingScreen.kt"),
      join(UI, "AppNav.kt"),
    ]) {
      expect(existsSync(f), `manquant: ${f}`).toBe(true);
    }
    // #206 : appairage serveur supprimé — aucune résurrection partielle.
    for (const f of [
      join(DATA, "QrPayload.kt"),
      join(DATA, "SetupRepository.kt"),
      join(DATA, "TokenStore.kt"),
      join(DATA, "ApiClient.kt"),
      join(DATA, "SseClient.kt"),
      join(UI, "SseStatusRow.kt"),
    ]) {
      expect(existsSync(f), `ressuscité: ${f}`).toBe(false);
    }
  });

  test("QR établissement = JSON ou compact, PIN arbitraire borné", () => {
    const json = '{"login":"a1b2","jeton":"c3d4","url":"https://etab.exemple/eleve"}';
    const compact = "a1b2|c3d4|https://etab.exemple/eleve";
    expect(tsParseSchoolQr(json)).toEqual({ login: "a1b2", jeton: "c3d4", url: "https://etab.exemple/eleve" });
    expect(tsParseSchoolQr(compact)).toEqual(tsParseSchoolQr(json));
    // L'URL est facultative : c'est alors l'adresse saisie à l'étape 1 qui fait foi.
    expect(tsParseSchoolQr('{"login":"a1b2","jeton":"c3d4"}')).toEqual({ login: "a1b2", jeton: "c3d4", url: null });
    expect(tsParseSchoolQr("a1b2|c3d4")).toEqual({ login: "a1b2", jeton: "c3d4", url: null });
    for (const junk of ["", "   ", "pas-un-qr", "{", '{"login":"a1b2"}', '{"jeton":"c3d4"}', "|c3d4", "a1b2|"]) {
      expect({ junk, parsed: tsParseSchoolQr(junk) }).toEqual({ junk, parsed: null });
    }

    // Le Kotlin doit porter la même logique (garde static).
    const kt = read(join(DATA, "PairingRepository.kt"));
    expect(kt).toContain("fun parseSchoolQr(raw: String): SchoolQr?");
    expect(kt).toContain("SCHOOL_QR_FIELD_MAX_CHARS = 1024");
    // Le PIN est celui défini dans Pronote (arbitraire), pas un 6 chiffres :
    // non vide et borné, jamais un motif de code serveur.
    expect(kt).toContain("PIN_MAX_CHARS = 64");
    expect(kt).not.toContain("^[0-9]{6}$");
  });

  test("#208 : SSE supprimé, zéro référence morte, WorkManager planifié", () => {
    // L'enveloppe contrat reste valide (la route serveur vit sa propre fin de
    // vie ailleurs) : c'est le CLIENT Android qui ne la consomme plus.
    const evt = {
      v: CONTRACTS_VERSION,
      type: "SyncCompleted",
      at: "2026-10-02T06:00:00.000Z",
      data: { accountId: "seed-acc", grades: 1, assignments: 2 },
    };
    expect(isContractEvent(evt)).toBe(true);

    // Aucune référence SSE dans le CODE Android (commentaires exclus) : ni
    // client, ni états, ni ligne d'état, ni libellé, ni câblage d'écran.
    const ktFiles = [
      ...readdirSync(DATA).map((f) => join(DATA, f)),
      ...readdirSync(UI).map((f) => join(UI, f)),
    ].filter((f) => f.endsWith(".kt"));
    for (const f of ktFiles) {
      const code = codeOnly(read(f));
      for (const ref of ["SseClient", "SseState", "SseListener", "SseStatusRow", "sseLabel", "extractSseData", "sseBackoffDelayMs"]) {
        expect({ file: f.split("/").pop(), ref, present: code.includes(ref) }).toEqual({
          file: f.split("/").pop(),
          ref,
          present: false,
        });
      }
    }
    // Le sync périodique est planifié au démarrage (travail unique, contraintes
    // + backoff dans le worker).
    const main = read(join(ROOT, "android/app/src/main/java/fr/veryslopnynotes/app/MainActivity.kt"));
    expect(main).toContain("PeriodicSyncWorker.schedule(this)");
    const worker = read(join(DATA, "PeriodicSyncWorker.kt"));
    expect(worker).toContain("enqueueUniquePeriodicWork");
    expect(worker).toContain("ExistingPeriodicWorkPolicy.KEEP");
    expect(worker).toContain("setRequiresBatteryNotLow(true)");
    expect(worker).toContain("NetworkType.CONNECTED");
  });

  test("I1 : aucun appel direct tiers, types du client local seuls", () => {
    const pronoteHost = /pronote/i;
    const allKt = [
      join(DATA, "PairingRepository.kt"),
      join(DATA, "SessionStore.kt"),
      join(DATA, "DeviceAuth.kt"),
      join(DATA, "PeriodicSyncWorker.kt"),
      join(UI, "PairingUiState.kt"),
      join(UI, "PairingScreen.kt"),
      join(UI, "AppNav.kt"),
    ].map((f) => ({ f, code: codeOnly(read(f)) }));
    // #213 : l'URL de NOTRE établissement est pré-remplie dans l'écran
    // d'appairage (choix utilisateur explicite — c'est notre lycée, pas un
    // hôte tiers). Exception nominative, pas une brèche : un AUTRE hôte en
    // dur retombe sur `hit: true` et casse le test.
    const allowedSchool = "https://9741050y.index-education.net/pronote";
    for (const { f, code } of allKt) {
      // Même tolérance que check-architecture.ts (I1 repointé #205 puis #206) :
      // `data`/`ui` manipulent les TYPES du client local (dépendance
      // `project(":pronote")`, ADR-003) — câblage sanctionné, pas un hôte.
      const sanctionne = code
        .replace(allowedSchool, "")
        .replace(/project\(":pronote"\)/g, "")
        .replace(/PronoteSession|PronoteClientProvider/g, "")
        .replace(/fr\.veryslopnynotes\.pronote/g, "");
      expect({ file: f, hit: pronoteHost.test(sanctionne) }).toEqual({ file: f, hit: false });
    }
    // L'appairage passe par le port local, jamais par une URL serveur.
    const repo = read(join(DATA, "PairingRepository.kt"));
    expect(repo).toContain("Client.qrcodeLogin(");
    expect(repo).toContain("PronoteSession.set(client)");
    expect(codeOnly(repo)).not.toContain("http://");
    expect(codeOnly(repo)).not.toContain("https://");
  });

  test("session persistée chiffrée : jeton dormant, PIN jamais écrit", () => {
    const store = read(join(DATA, "SessionStore.kt"));
    expect(store).toContain("EncryptedSharedPreferences");
    expect(store).toContain("MasterKey");
    expect(store).toContain("interface SessionStore");
    expect(store).toContain("fun save(session: StoredSession)");
    expect(store).toContain("fun load(): StoredSession?");
    expect(store).toContain("fun clear()");
    // #206 : plus de repli en clair — un Keystore KO jette, il n'écrit pas.
    expect(codeOnly(store)).not.toContain("MODE_PRIVATE");
    expect(codeOnly(store)).not.toContain("getSharedPreferences(");
    expect(store).toContain("object SessionStores");
    // Jamais de secret dans un log, un toString ou un message d'erreur.
    expect(codeOnly(store)).not.toMatch(/Log\.[vdiew]\(|println\(|printStackTrace/);
    expect(store).toContain('override fun toString(): String = "StoredSession(url=***, user=***)"');
    expect(store).not.toContain("data class StoredSession");
    // Le PIN ne dort nulle part : ni clé, ni écriture, ni lecture.
    expect(store).not.toContain("KEY_PIN");
    expect(codeOnly(store)).not.toContain("pin");
    // L'écran ne manipule aucun secret : la session va droit au store.
    const screen = read(join(UI, "PairingScreen.kt"));
    expect(screen).toContain("PairingRepository(sessions)");
    expect(screen).toContain("PairingRoute");
    expect(codeOnly(screen)).not.toMatch(/Log\.[vdiew]\(|println\(/);
  });

  test("appairage local : QR+PIN ou refus bruyant, restauration sans rescanner", () => {
    const repo = read(join(DATA, "PairingRepository.kt"));
    // QR + PIN = la seule méthode : sans les deux, aucun appel réseau.
    expect(repo).toContain('"QR de l\'établissement et son PIN requis"');
    expect(repo).toContain("sealed interface PairingResult");
    expect(repo).toContain("sealed interface RestoreResult");
    // PIN faux = QR indéchiffrable : message de rescan, jamais le brut I6.
    expect(repo).toContain("QRCodeDecryptError");
    expect(repo).toContain("QR ou PIN refusé");
    // Restauration : jeton mort = store vidé, réseau KO = store gardé.
    expect(repo).toContain("Client.tokenLogin(");
    expect(repo).toContain("RestoreResult.Dead");
    expect(repo).toContain("RestoreResult.Offline");
    expect(repo).toContain("sessions.clear()");
    // `StoredSession` n'est pas une `data class` : pas de jeton en clair dans
    // un toString() généré. `PairingInput`/`SchoolQr` rédigent le leur (le PIN
    // en clair dans un rapport de crash, jamais).
    expect(codeOnly(repo)).not.toContain("data class StoredSession");
    expect(repo).toContain("pin=***)");
    expect(repo).toContain("login=***, jeton=***");
    // Adresse mal formée (saisie ou QR sans URL) : refus local actionnable,
    // pas un « établissement muet ».
    expect(repo).toContain("Adresse de l'établissement invalide");
    // Bloquant réseau, jamais de HTTP applicatif ici : ni OkHttp, ni URL.
    expect(codeOnly(repo)).not.toContain("OkHttpClient(");
    expect(codeOnly(repo)).not.toContain("newCall(");
  });

  test("deps : deux ajoutées, épinglées (security-crypto, work-runtime)", () => {
    const dataGradle = read(join(ROOT, "android/data/build.gradle.kts"));
    expect(dataGradle).toContain("com.squareup.okhttp3:okhttp:4.12.0");
    expect(dataGradle).toContain("androidx.security:security-crypto:1.1.0");
    // #208 : sync périodique sans serveur = WorkManager, version épinglée au
    // catalogue, sans client SSE.
    expect(dataGradle).toContain("libs.work.runtime.ktx");
    expect(dataGradle).not.toContain("okhttp-sse");
    expect(dataGradle).not.toContain("mlkit");
    expect(dataGradle).not.toContain("zxing");
    const catalog = read(join(ROOT, "android/gradle/libs.versions.toml"));
    expect(catalog).toContain('work = "2.9.0"');
    expect(catalog).toContain("work-runtime-ktx");
    const uiGradle = read(join(ROOT, "android/ui/build.gradle.kts"));
    expect(uiGradle).toContain('implementation(project(":data"))');
    expect(uiGradle).toContain('implementation(project(":core"))');
  });
});
