// Assistant de connexion Android (#120) — serveur -> établissement -> QR.
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

  test("étape 2 : l'adresse de l'établissement est la seule saisie — 0.7.0 n'a plus d'identifiants", () => {
    expect(screen).toContain("isBoundedSchoolUrl(form.schoolUrl)");
    expect(screen).toContain("Adresse de l'établissement absente : elle est obligatoire.");
    // Aucun champ identifiant/mot de passe ne subsiste dans l'app.
    expect(state).not.toContain("val username");
    expect(state).not.toContain("val password");
    expect(state).not.toContain("hasCredentials");
  });

  test("étape 3 : QR + PIN, la méthode UNIQUE — un des deux seul ne part pas", () => {
    expect(screen).toContain("val qr = parseSchoolQr(form.qrRaw)");
    // Le Pin est la clé de déchiffrement du QR : sans lui, le QR ne sert à rien.
    expect(screen).toContain("Code PIN du QR obligatoire : il déchiffre le contenu scanné.");
    expect(screen).toContain("QR illisible : rescane-le ou colle-le en JSON.");
    expect(screen).toContain("val pret = qr != null && form.pin.isNotBlank()");
    // Le QR + le pin partent dans la MÊME requête : c'est la seule méthode.
    expect(screen).toContain("qr = qr");
    expect(screen).toContain("pin = form.pin.trim()");
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
      ["login_refused", "regénère le QR dans son application"],
      ["school_unreachable", "réessaie dans un instant"],
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

  test("aucune phrase ne parle d'identifiant : le QR est la seule méthode", () => {
    // #129 : `login_refused` demandait encore « vérifie ton identifiant et ton
    // mot de passe » alors qu'aucun identifiant n'est saisi depuis 0.7.0 : le
    // conseil était inapplicable, donc l'utilisateur n'avait rien à corriger.
    const bloc = repo.slice(repo.indexOf("private fun failure"), repo.indexOf("private fun failure") + 2000);
    for (const mot of ["identifiant", "mot de passe"]) {
      expect({ mot, dit: bloc.toLowerCase().includes(mot) }).toEqual({ mot, dit: false });
    }
  });
});

/** Extrait la phrase du `when` de `failure()` pour un code donné. */
function messageFor(repo: string, code: string): string {
  const ligne = repo.split("\n").find((l) => l.includes(`"${code}" ->`));
  if (!ligne) throw new Error(`code absent du mapping: ${code}`);
  const apres = ligne.slice(ligne.indexOf("->") + 2).trim().replace(/^"|",?$/g, "");
  return apres;
}

describe("scan du QR (#127) : décodeur dans l'APK, plus de Google Play Services", () => {
  const scanner = read(join(UI, "QrScanner.kt"));
  const screen = read(join(UI, "PairingScreen.kt"));
  const uiGradle = read(join(ANDROID, "ui/build.gradle.kts"));
  const catalog = read(join(ANDROID, "gradle/libs.versions.toml"));
  const manifest = read(join(ANDROID, "app/src/main/AndroidManifest.xml"));

  test("dépendance épinglée dans le catalogue ET déclarée dans le module ui", () => {
    // Un module Gradle sans version explicite est une dépendance qui dérive.
    expect(catalog).toContain('zxing-android-embedded = "4.3.0"');
    expect(catalog).toContain('module = "com.journeyapps:zxing-android-embedded"');
    expect(uiGradle).toContain('implementation("com.journeyapps:zxing-android-embedded:4.3.0")');
  });

  test("AUCUNE dépendance à Play Services : c'était elle qui rendait le bouton inerte", () => {
    // #122 : le module de scan était téléchargé à la demande par un service
    // absent (émulateur, téléphone sans GMS) et son échec revenait en `null`
    // sans rien afficher. Le décodeur est maintenant dans l'APK.
    for (const f of [uiGradle, catalog, scanner, screen]) {
      expect({ fichier: f.slice(0, 40), play_services: f.includes("play-services-code-scanner") }).toEqual({
        fichier: f.slice(0, 40),
        play_services: false,
      });
    }
  });

  test("caméra OPTIONNELLE : CAMERA vient de l'AAR, le merger n'en fait pas un filtre", () => {
    // L'AAR déclare CAMERA et la demande au runtime. Si `camera.any` restait
    // `required` (ajouté d'office par le merger), l'app serait ininstallable
    // sur un appareil sans caméra — alors que le collage est le repli.
    expect(manifest).not.toContain("android.permission.CAMERA");
    expect(manifest).toContain('android:name="android.hardware.camera.any"');
    expect(manifest).toContain('android:required="false"');
  });

  test("rien de lu = un message, jamais le silence qui faisait 'bouton inerte'", () => {
    expect(scanner).toContain("fun rememberQrScanner(");
    expect(scanner).toContain("rememberLauncherForActivityResult(ScanContract())");
    expect(scanner).toContain("result.contents?.takeIf { it.isNotBlank() }");
    // L'appelant ne remplace la saisie que si un contenu est vraiment revenu,
    // ET il dit quoi faire sinon.
    expect(screen).toContain("if (scanned != null)");
    expect(screen).toContain("Aucun QR lu (annulé, caméra refusée ou code illisible)");
    // Et le champ de collage n'a pas disparu au profit du bouton.
    expect(screen).toContain('Text("Scanner le QR")');
    expect(screen).toContain('label = { Text("Contenu du QR (login + jeton)") }');
  });

  test("un contenu scanné passe par le même parseur que le collage", () => {
    // Deux entrées, une seule porte de sortie : pas de second parseur à diverger.
    expect(screen).toContain("val qr = parseSchoolQr(form.qrRaw)");
    expect(scanner).toContain("ScanOptions.QR_CODE");
  });

  test("annuler le scan NE DÉTRUIT PAS l'assistant (clearTaskOnLaunch de la lib)", () => {
    // Constaté sur l'appareil : zxing déclare son activité `clearTaskOnLaunch`,
    // donc ouvrir le scan DÉTRUISAIT MainActivity — au retour on se retrouvait
    // à l'étape 1, serveur et adresse d'établissement compris, saisis à perdu.
    expect(manifest).toContain('android:name="com.journeyapps.barcodescanner.CaptureActivity"');
    expect(manifest).toContain('android:clearTaskOnLaunch="false"');
    expect(manifest).toContain('tools:replace="android:clearTaskOnLaunch"');
  });

  test("chaque étape défile : en paysage, « Continuer » tombait hors écran", () => {
    // Le téléphone en rotation verrouillée (paysage) : la colonne débordait, le
    // bouton était hors de l'écran et donc inatteignable. L'assistant était
    // inutilisable — et le scanner, lui, s'ouvrait très bien.
    expect(screen.split("verticalScroll(rememberScrollState())").length - 1).toBe(3);
  });
});
