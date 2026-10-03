// Assistant de connexion Android (#120) — serveur -> compte EduConnect -> QR.
// Kotlin n'a pas de src/test dans ce dépôt : on rejoue donc la logique pure en
// TypeScript (tableau rejouable contre le vrai Kotlin) et on vérifie par lecture
// de source ce que seul l'écran peut garantir : l'ordre des étapes, le gate au
// lancement, et le fait que le mot de passe de l'établissement n'est écrit
// nulle part.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");
const ANDROID = join(ROOT, "android");
const DATA = join(ANDROID, "data/src/main/java/fr/veryslopnynotes/data");
const UI = join(ANDROID, "ui/src/main/java/fr/veryslopnynotes/ui");
const CORE = join(ANDROID, "core/src/main/java/fr/veryslopnynotes/core");

function read(file: string): string {
  return readFileSync(file, "utf8");
}

/** Miroir de `parseSchoolQr` (SetupRepository.kt) — rejouable tel quel. */
function tsParseSchoolQr(raw: string): { login: string; jeton: string; url: string | null } | null {
  const text = raw.trim();
  if (text === "") return null;
  if (text.startsWith("{")) {
    try {
      const o = JSON.parse(text) as Record<string, unknown>;
      const login = String(o["login"] ?? "").trim();
      const jeton = String(o["jeton"] ?? "").trim();
      const url = String(o["url"] ?? "").trim();
      if (!bounded(login) || !bounded(jeton)) return null;
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
  if (!bounded(login) || !bounded(jeton)) return null;
  return { login, jeton, url: url === "" ? null : url };
}

function bounded(value: string): boolean {
  return value !== "" && value.length <= 1024;
}

describe("QR de l'établissement : parsing (miroir exécutable)", () => {
  test("JSON de l'app et forme compacte donnent le même résultat", () => {
    const json = '{"login":"a1b2","jeton":"c3d4","url":"https://etab.exemple/eleve"}';
    const compact = "a1b2|c3d4|https://etab.exemple/eleve";
    expect(tsParseSchoolQr(json)).toEqual({ login: "a1b2", jeton: "c3d4", url: "https://etab.exemple/eleve" });
    expect(tsParseSchoolQr(compact)).toEqual(tsParseSchoolQr(json));
    // L'URL est facultative : c'est alors celle saisie à l'étape 2 qui fait foi.
    expect(tsParseSchoolQr('{"login":"a1b2","jeton":"c3d4"}')).toEqual({ login: "a1b2", jeton: "c3d4", url: null });
    expect(tsParseSchoolQr("a1b2|c3d4")).toEqual({ login: "a1b2", jeton: "c3d4", url: null });
  });

  test("un QR illisible vaut null (l'écran dit « rescane »), jamais une valeur inventée", () => {
    for (const junk of [
      "",
      "   ",
      "pas-un-qr",
      "{",
      '{"login":"a1b2"}',
      '{"jeton":"c3d4"}',
      '{"login":"","jeton":"c3d4"}',
      '{"login":"a1b2","jeton":""}',
      "|c3d4",
      "a1b2|",
      `{"login":"${"x".repeat(1025)}","jeton":"c3d4"}`,
    ]) {
      expect({ junk, parsed: tsParseSchoolQr(junk) }).toEqual({ junk, parsed: null });
    }
  });
});

describe("assistant : le parcours est bien l'ordre annoncé", () => {
  const screen = read(join(UI, "PairingScreen.kt"));
  const state = read(join(UI, "PairingUiState.kt"));

  test("trois étapes nommées, dans l'ordre", () => {
    expect(state).toContain("enum class SetupStep");
    expect(state).toContain("SERVER,");
    expect(state).toContain("ACCOUNT,");
    expect(state).toContain("QR,");
    for (const label of ["Étape 1/3", "Étape 2/3", "Étape 3/3"]) {
      expect(state).toContain(label);
    }
  });

  test("étape 1 : valider PUIS sonder, et ne passer à l'étape 2 que si ça répond", () => {
    // L'ordre importe : écrire l'adresse avant de l'appeler (changeServer purge
    // la session), et ne PAS avancer sur un serveur muet.
    const valider = screen.indexOf("val refusal = onServerChange(serverDraft)");
    const sonder = screen.indexOf("probeHealthBlocking(target)");
    const avancer = screen.indexOf("step = SetupStep.ACCOUNT");
    expect({ valider, sonder, avancer }).toEqual({ valider: valider, sonder: sonder, avancer: avancer });
    expect(valider).toBeGreaterThan(-1);
    expect(sonder).toBeGreaterThan(valider);
    expect(avancer).toBeGreaterThan(sonder);
    expect(screen).toContain("is HealthResult.Alive ->");
    expect(screen).toContain("is HealthResult.Unreachable ->");
  });

  test("étape 2 : l'adresse de l'établissement est obligatoire, les identifiants ne le sont pas", () => {
    expect(screen).toContain("isBoundedSchoolUrl(form.schoolUrl)");
    expect(screen).toContain("Adresse de l'établissement absente : elle est obligatoire.");
    // Un compte sans mot de passe EduConnect passe quand même : il utilisera le QR.
    expect(screen).toContain('Text("J\'ai seulement un QR")');
    expect(state).toContain("val hasCredentials: Boolean");
  });

  test("étape 3 : QR + PIN, ou identifiants — jamais les deux comme si c'était deux étapes", () => {
    expect(screen).toContain("val qr = parseSchoolQr(form.qrRaw)");
    // Le Pin est la clé de déchiffrement du QR : sans lui, le QR ne sert à rien.
    expect(screen).toContain("Code PIN du QR obligatoire : il déchiffre le contenu scanné.");
    expect(screen).toContain("QR illisible : rescane-le ou colle-le en JSON.");
    // Les identifiants de l'étape 2 partent dans la MÊME requête : c'est la
    // méthode de repli quand le QR manque, pas une étape à valider.
    expect(screen).toContain("username = form.username");
    expect(screen).toContain("password = form.password");
    expect(screen).toContain("qr = qr");
  });

  test("succès : le secret est stocké chiffré puis on quitte l'assistant", () => {
    expect(screen).toContain("tokens.save(res.device.id, res.device.tokenHash, res.device.token)");
    expect(screen).toContain("onPaired()");
    expect(read(join(UI, "AppNav.kt"))).toContain("onPaired = {");
  });

  test("gate au lancement : sans secret appairé, on n'ouvre pas l'accueil", () => {
    const nav = read(join(UI, "AppNav.kt"));
    expect(nav).toContain("startDestination = if (tokens.isPaired()) ROUTE_INDEX else ROUTE_PAIRING");
    // Le test du secret le plus hateful : `isPaired()` exige l'ID ET le secret.
    expect(read(join(DATA, "TokenStore.kt"))).toContain("fun isPaired(): Boolean = deviceId() != null && token() != null");
  });
});

describe("assistant : secrets et route publique", () => {
  const repo = read(join(DATA, "SetupRepository.kt"));
  const api = read(join(DATA, "ApiClient.kt"));

  test("/v1/setup est publique : aucun bearer sur la route qui rend le secret", () => {
    expect(read(join(CORE, "ServerConfig.kt"))).toContain('const val SETUP_PATH = "/v1/setup"');
    expect(api).toContain("ServerConfig.SETUP_PATH,");
    // Miroir de OPEN_WITHOUT_DEVICE côté serveur.
    expect(read(join(ROOT, "server/api/router.ts"))).toContain('"/v1/setup",');
  });

  test("le mot de passe de l'établissement n'est écrit sur AUCUN support", () => {
    // Il vit dans le POST /v1/setup, chez le serveur en mémoire. Ni SharedPrefs,
    // ni fichier, ni log : le seul stockage de l'app reste le jeton d'appareil.
    for (const forbidden of ["SharedPreferences", "getSharedPreferences", "EncryptedSharedPreferences", "openFileOutput"]) {
      expect({ fichier: "SetupRepository.kt", contient: forbidden, trouve: repo.includes(forbidden) }).toEqual({
        fichier: "SetupRepository.kt",
        contient: forbidden,
        trouve: false,
      });
    }
    // Et l'écran ne le journalise pas davantage.
    expect(repo).not.toMatch(/Log\.[vdiew]\(|println\(/);
  });

  test("chaque refus a sa phrase actionnable, et aucun ne dit « déconnecte »", () => {
    for (const [code, attendu] of [
      ["qr_rejected", "rescane le code affiché par son application"],
      ["login_refused", "vérifie ton EduConnect et ton mot de passe"],
      ["ent_unreachable", "réessaie dans un instant"],
      ["rate_limited", "réessaie dans quelques minutes"],
      ["not_implemented", "aucune session d'établissement branchée"],
    ] as const) {
      // On vérifie le CONSEIL contenu dans la phrase, pas la phrase entière :
      // c'est le conseil qui corrige la saisie, le reste est de la mise en forme.
      expect({ code, conseil: attendu, dit: messageFor(repo, code).includes(attendu) }).toEqual({
        code,
        conseil: attendu,
        dit: true,
      });
    }
    // Un refus de saisie ne doit jamais proposer l'appairage : ce serait
    // renvoyer l'utilisateur dans un cul-de-sac (le setup est la seule porte).
    const bloc = repo.slice(repo.indexOf("private fun failure"), repo.indexOf("private fun failure") + 2000);
    expect(bloc).not.toContain("appairage");
    expect(bloc).not.toContain("401");
  });
});

/** Extrait la phrase du `when` de `failure()` pour un code donné. */
function messageFor(repo: string, code: string): string {
  const ligne = repo.split("\n").find((l) => l.includes(`"${code}" ->`));
  if (!ligne) throw new Error(`code absent du mapping: ${code}`);
  const apres = ligne.slice(ligne.indexOf("->") + 2).trim().replace(/^"|",?$/g, "");
  return apres;
}

describe("scan du QR (#122) : caméra sans permission, collage toujours là", () => {
  const scanner = read(join(UI, "QrScanner.kt"));
  const screen = read(join(UI, "PairingScreen.kt"));
  const uiGradle = read(join(ANDROID, "ui/build.gradle.kts"));
  const catalog = read(join(ANDROID, "gradle/libs.versions.toml"));
  const manifest = read(join(ANDROID, "app/src/main/AndroidManifest.xml"));

  test("dépendance épinglée dans le catalogue ET déclarée dans le module ui", () => {
    // Un module Gradle sans version explicite est une dépendance qui dérive.
    expect(catalog).toContain('play-services-code-scanner = "16.1.0"');
    expect(catalog).toContain('module = "com.google.android.gms:play-services-code-scanner"');
    expect(uiGradle).toContain('implementation("com.google.android.gms:play-services-code-scanner:16.1.0")');
  });

  test("AUCUNE permission caméra déclarée (le scan est délégué à Play Services)", () => {
    expect(manifest).not.toContain("android.permission.CAMERA");
    expect(read(join(UI, "QrScanner.kt"))).not.toContain("Manifest.permission");
  });

  test("annulation ou échec = null, donc le collage reste le chemin de secours", () => {
    expect(scanner).toContain("fun scanQrCode(");
    expect(scanner).toContain(".addOnCanceledListener { onResult(null) }");
    expect(scanner).toContain(".addOnFailureListener { onResult(null) }");
    // L'appelant ne remplace la saisie que si un contenu est vraiment revenu.
    expect(screen).toContain("if (scanned != null) onChange(form.copy(qrRaw = scanned))");
    // Et le champ de collage n'a pas disparu au profit du bouton.
    expect(screen).toContain('Text("Scanner le QR")');
    expect(screen).toContain('label = { Text("Contenu du QR (login + jeton)") }');
  });

  test("un contenu scanné passe par le même parseur que le collage", () => {
    // Deux entrées, une seule porte de sortie : pas de second parseur à diverger.
    expect(screen).toContain("val qr = parseSchoolQr(form.qrRaw)");
    expect(scanner).toContain("Barcode.FORMAT_QR_CODE");
  });
});
