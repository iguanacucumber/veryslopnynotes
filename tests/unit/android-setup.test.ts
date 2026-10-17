// Assistant de connexion Android (#120, repointé #206 : device-only, page
// unique #299) — le QR de l'établissement + son PIN. Kotlin n'a pas de
// src/test dans ce dépôt : on rejoue donc la logique pure en TypeScript
// (tableau rejouable contre le vrai Kotlin) et on vérifie par lecture de source
// ce que seul l'écran peut garantir : l'adresse vient du QR, le gate au
// lancement, et le fait que le PIN n'est écrit nulle part.
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");
const ANDROID = join(ROOT, "android");
const DATA = join(ANDROID, "data/src/main/java/fr/veryslopnynotes/data");
const UI = join(ANDROID, "ui/src/main/java/fr/veryslopnynotes/ui");

function read(file: string): string {
  return readFileSync(file, "utf8");
}

/**
 * Miroir de `parseSchoolQr` (PairingRepository.kt) — rejouable tel quel.
 * L'`url` est OBLIGATOIRE (#299) : plus d'étape de saisie pour la fournir,
 * donc un QR sans adresse est un QR illisible.
 */
function tsParseSchoolQr(raw: string): { login: string; jeton: string; url: string } | null {
  const text = raw.trim();
  if (text === "") return null;
  if (text.startsWith("{")) {
    try {
      const o = JSON.parse(text) as Record<string, unknown>;
      const login = String(o["login"] ?? "").trim();
      const jeton = String(o["jeton"] ?? "").trim();
      const url = String(o["url"] ?? "").trim();
      if (!bounded(login) || !bounded(jeton) || !boundedUrl(url)) return null;
      return { login, jeton, url };
    } catch {
      return null;
    }
  }
  const parts = text.split("|");
  if (parts.length < 3) return null;
  const login = (parts[0] ?? "").trim();
  const jeton = (parts[1] ?? "").trim();
  const url = (parts[2] ?? "").trim();
  if (!bounded(login) || !bounded(jeton) || !boundedUrl(url)) return null;
  return { login, jeton, url };
}

function bounded(value: string): boolean {
  return value !== "" && value.length <= 1024;
}

/** Miroir de `boundedSchoolUrl` : 300 caractères, comme `SessionStore`. */
function boundedUrl(value: string): boolean {
  return value !== "" && value.length <= 300;
}

describe("QR de l'établissement : parsing (miroir exécutable)", () => {
  test("JSON de l'app et forme compacte donnent le même résultat", () => {
    const json = '{"login":"a1b2","jeton":"c3d4","url":"https://etab.exemple/eleve"}';
    const compact = "a1b2|c3d4|https://etab.exemple/eleve";
    expect(tsParseSchoolQr(json)).toEqual({ login: "a1b2", jeton: "c3d4", url: "https://etab.exemple/eleve" });
    expect(tsParseSchoolQr(compact)).toEqual(tsParseSchoolQr(json));
  });

  test("un QR sans URL est illisible (#299) : plus d'étape de saisie pour la fournir", () => {
    // Le QR Pronote réel porte toujours `url` (cf. pronotepy) — un QR sans
    // adresse est donc un QR que l'app ne sait pas utiliser, jamais un cas à
    // rattraper par une saisie.
    for (const sansUrl of [
      '{"login":"a1b2","jeton":"c3d4"}',
      '{"login":"a1b2","jeton":"c3d4","url":""}',
      "a1b2|c3d4",
      "a1b2|c3d4|",
      `{"login":"a1b2","jeton":"c3d4","url":"https://etab.exemple/${"u".repeat(300)}"}`,
    ]) {
      expect({ sansUrl, parsed: tsParseSchoolQr(sansUrl) }).toEqual({ sansUrl, parsed: null });
    }
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
      `{"login":"${"x".repeat(1025)}","jeton":"c3d4","url":"https://etab.exemple/eleve"}`,
    ]) {
      expect({ junk, parsed: tsParseSchoolQr(junk) }).toEqual({ junk, parsed: null });
    }
  });
});

describe("assistant : une seule page, l'adresse vient du QR (#299)", () => {
  const screen = read(join(UI, "PairingScreen.kt"));
  const state = read(join(UI, "PairingUiState.kt"));
  const repo = read(join(DATA, "PairingRepository.kt"));

  test("plus d'étape « établissement » : l'écran ne fait saisir aucun hôte", () => {
    // L'ancienne étape 1 (adresse pré-remplie #213, validée en local) est
    // supprimée : le QR porte `url`, donc il n'y a plus rien à taper.
    expect(state).not.toContain("SetupStep");
    expect(state).not.toContain("DEFAULT_SCHOOL_URL");
    expect(state).not.toContain("schoolUrl");
    expect(screen).not.toContain("isBoundedSchoolUrl");
    expect(screen).not.toContain('label = { Text("Adresse de l\'établissement") }');
    // Aucun champ identifiant/mot de passe ne subsiste dans l'app.
    expect(state).not.toContain("val username");
    expect(state).not.toContain("val password");
    expect(state).not.toContain("hasCredentials");
    // Et aucun reste de sonde réseau de l'étape serveur (retirée en #206).
    expect(screen).not.toContain("probeHealthBlocking");
    expect(screen).not.toContain("HealthResult");
    expect(screen).not.toContain("changeServer");
  });

  test("le dépôt ouvre la session avec l'URL du QR, jamais une saisie", () => {
    expect(repo).toContain("val schoolUrl = qr.url");
    expect(repo).toContain("QrCode(login = qr.login, jeton = qr.jeton, url = schoolUrl)");
    // Un QR sans URL ne passe même pas le parseur (borné, comme `SessionStore`).
    expect(repo).toContain("!boundedSchoolUrl(url)");
    expect(repo).toContain("SCHOOL_URL_MAX_CHARS = 300");
    // URL malformée : refus local actionnable (rescan), jamais un
    // « établissement muet ».
    expect(repo).toContain("QR sans adresse d'établissement valide");
  });

  test("QR + PIN, la méthode UNIQUE — un des deux seul ne part pas", () => {
    expect(screen).toContain("val qr = parseSchoolQr(form.qrRaw)");
    // Le Pin est la clé de déchiffrement du QR : sans lui, le QR ne sert à rien.
    expect(screen).toContain("Code PIN du QR obligatoire : il déchiffre le contenu scanné.");
    expect(screen).toContain("QR illisible : rescane-le.");
    expect(screen).toContain("val pret = qr != null && form.pin.isNotBlank()");
    // Le QR + le pin partent dans la MÊME session locale : c'est la seule méthode.
    expect(screen).toContain("qr = qr");
    expect(screen).toContain("pin = form.pin.trim()");
  });

  test("succès : la session est persistée chiffrée puis on quitte l'assistant", () => {
    // L'écran ne manipule aucun bearer : le dépôt range la session.
    expect(screen).toContain("PairingResult.Ok");
    expect(screen).toContain("onPaired()");
    expect(read(join(UI, "AppNav.kt"))).toContain("onPaired = {");
  });

  test("gate au lancement : sans session persistée, on n'ouvre pas l'accueil", () => {
    const nav = read(join(UI, "AppNav.kt"));
    expect(nav).toContain("startDestination = if (sessions.hasSession()) ROUTE_INDEX else ROUTE_PAIRING");
    // Le plancher est la session chiffrée, pas une liste.
    expect(read(join(DATA, "SessionStore.kt"))).toContain("fun hasSession(): Boolean = load() != null");
  });
});

describe("assistant : le PIN est un secret affiché comme tel (#172)", () => {
  const screen = read(join(UI, "PairingScreen.kt"));
  const settings = read(join(UI, "SettingsScreen.kt"));
  const state = read(join(UI, "PairingUiState.kt"));

  test("tout champ à clavier de secret MASQUE ce qu'il affiche", () => {
    // Le défaut que #140 a corrigé pour la clé LLM et laissé pour le PIN : un
    // `KeyboardType.NumberPassword` ne change QUE le clavier. Sans
    // `visualTransformation`, les chiffres sont lisibles par-dessus l'épaule ET
    // présents tels quels dans l'arbre de vues — ce que relit `uiautomator dump`,
    // donc une capture, donc un fichier. La transformation porte sur l'AFFICHAGE
    // : la saisie et ce qui part dans la session sont inchangés.
    const champs = [
      ["PairingScreen.kt", screen],
      ["SettingsScreen.kt", settings],
    ] as const;
    for (const [fichier, src] of champs) {
      // Le CODE, commentaires vidés : un `//` qui CITE `KeyboardType.NumberPassword`
      // pour dire qu'il ne masque rien n'est pas un champ.
      const code = src
        .replace(/\/\*[\s\S]*?\*\//g, "\n")
        .split("\n")
        .filter((l) => !l.trim().startsWith("//"))
        .join("\n");
      const claviers = [...code.matchAll(/KeyboardType\.(NumberPassword|Password)/g)];
      // Le PIN de l'appairage et la clé de l'assistant : les deux seuls secrets
      // que l'app saisit (plus aucun mot de passe de compte).
      expect({ fichier, champsSecret: claviers.length }).toEqual({ fichier, champsSecret: 1 });
      for (const m of claviers) {
        // Fenêtre autour de la déclaration du clavier : la transformation doit
        // appartenir au MÊME bloc de champ (elle est posée juste au-dessus, donc
        // la fenêtre regarde un peu avant comme un peu après).
        const bloc = code.slice(Math.max(0, m.index! - 600), m.index! + 200);
        expect({ fichier, masque: bloc.includes("PasswordVisualTransformation()") }).toEqual({
          fichier,
          masque: true,
        });
      }
    }
  });

  test("le PIN : masqué, borné, et JAMAIS journalisé ni rendu", () => {
    expect(screen).toContain("visualTransformation = PasswordVisualTransformation()");
    expect(screen).toContain("keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword)");
    // La borne de saisie reste en place (64 caractères) : masquer n'a rien
    // changé à ce qui est accepté.
    expect(screen).toContain("if (v.length <= PIN_MAX_CHARS)");
    // Ni journal, ni copie du PIN dans un état d'affichage.
    const code = screen
      .replace(/\/\*[\s\S]*?\*\//g, "\n")
      .split("\n")
      .filter((l) => !l.trim().startsWith("//"))
      .join("\n");
    for (const fuite of ["Log.", "println(", "printStackTrace", "toString()"]) {
      expect({ fuite, presente: code.includes(fuite) }).toEqual({ fuite, presente: false });
    }
    // `SetupForm` ne le journalise pas davantage : `pin` y est un `String` simple,
    // jamais rendu — le champ masqué est la seule surface d'affichage, et le
    // `toString()` est rédigé (pas de PIN en clair dans un rapport de crash).
    expect(state).toContain('val pin: String = ""');
    expect(state).toContain("qrRaw=***, pin=***");
    // #299 : la saisie (QR + PIN) n'est dans AUCUN saver — plus de
    // `SetupFormSaver`, donc plus rien de l'assistant dans `rememberSaveable`.
    expect(state).not.toContain("SetupFormSaver");
  });

  test("le retour quitte l'écran (plus d'étape à remonter)", () => {
    // #299 : la page unique n'a plus de « Étape précédente » — le bouton du haut
    // est le seul retour, et il sort de l'assistant.
    expect(state).not.toContain("previousStep");
    expect(screen).not.toContain("previousStep");
    expect(screen).toMatch(/TextButton\(\s*onClick = onBack,/);
    expect(screen).toContain('Text("Retour")');
  });
});

describe("assistant : secrets et refus actionnables", () => {
  const repo = read(join(DATA, "PairingRepository.kt"));

  test("aucun appel serveur : l'appairage est local, POST /v1/setup supprimé côté app", () => {
    expect(existsSync(join(DATA, "SetupRepository.kt"))).toBe(false);
    expect(existsSync(join(DATA, "ApiClient.kt"))).toBe(false);
    expect(repo).toContain("Client.qrcodeLogin(");
    expect(repo).not.toContain("POST /v1/setup");
    expect(repo).not.toContain("/v1/setup");
  });

  test("le PIN n'est écrit sur AUCUN support", () => {
    // Il déchiffre le QR en mémoire, au moment de l'appairage. Ni SharedPrefs,
    // ni fichier, ni log : le seul stockage de l'app reste la session chiffrée.
    for (const forbidden of ["SharedPreferences", "getSharedPreferences", "EncryptedSharedPreferences", "openFileOutput", "KEY_PIN"]) {
      expect({ fichier: "PairingRepository.kt", contient: forbidden, trouve: repo.includes(forbidden) }).toEqual({
        fichier: "PairingRepository.kt",
        contient: forbidden,
        trouve: false,
      });
    }
    // Et le dépôt ne le journalise pas davantage.
    expect(repo).not.toMatch(/Log\.[vdiew]\(|println\(/);
  });

  test("chaque refus a sa phrase actionnable, et aucun ne dit « déconnecte »", () => {
    for (const [code, attendu] of [
      ["qr_rejected", "rescane le code affiché par son application"],
      ["login_refused", "régénère le QR dans son application"],
      ["school_unreachable", "réessaie dans un instant"],
    ] as const) {
      // On vérifie le CONSEIL contenu dans la phrase, pas la phrase entière :
      // c'est le conseil qui corrige la saisie, le reste est de la mise en forme.
      expect({ code, conseil: attendu, dit: messageFor(repo, code).includes(attendu) }).toEqual({
        code,
        conseil: attendu,
        dit: true,
      });
    }
    // Un refus de saisie ne doit jamais proposer l'appairage : l'utilisateur
    // est DÉJÀ en train de s'appairer.
    const bloc = repo.slice(repo.indexOf("private fun failure"), repo.indexOf("private fun failure") + 2000);
    expect(bloc).not.toContain("401");
  });

  test("aucune phrase ne parle d'identifiant : le QR est la seule méthode", () => {
    // Les PHRASES affichées (pas le code qui les choisit : le détecteur
    // `isLoginRefused` lit des mots de lib, jamais affichés) ne doivent pas
    // demander un identifiant qu'on ne saisit pas : le conseil serait
    // inapplicable, donc l'utilisateur n'aurait rien à corriger.
    for (const code of ["qr_rejected", "login_refused", "school_unreachable", "mfa_required"] as const) {
      const phrase = messageFor(repo, code).toLowerCase();
      for (const mot of ["identifiant", "mot de passe"]) {
        expect({ code, mot, dit: phrase.includes(mot) }).toEqual({ code, mot, dit: false });
      }
    }
  });
});

/** Extrait la phrase du `PairingResult.Err` pour un code donné. */
function messageFor(repo: string, code: string): string {
  const ligne = repo.split("\n").find((l) => l.includes(`"${code}",`));
  if (!ligne) throw new Error(`code absent du mapping: ${code}`);
  const quoted = [...ligne.matchAll(/"([^"]*)"/g)].map((m) => m[1] as string);
  const phrase = quoted.slice(1).join(" ");
  if (!phrase) throw new Error(`phrase absente pour: ${code}`);
  return phrase;
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
    // sur un appareil sans caméra.
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
    // Le scan est la seule entrée : pas de champ manuel à côté du bouton.
    expect(screen).toContain('Text("Scanner le QR")');
    expect(screen).not.toContain('Contenu du QR');
  });

  test("scan en portrait : la lib est en paysage par défaut", () => {
    // zxing déclare `sensorLandscape` : sans forçage manifeste, le scan
    // s'ouvre en paysage alors que le QR s'affiche en portrait.
    expect(manifest).toContain('android:screenOrientation="portrait"');
    expect(manifest).toContain("android:screenOrientation");
    expect(scanner).toContain(".setOrientationLocked(true)");
    expect(scanner).not.toContain(".setOrientationLocked(false)");
  });

  test("le QR scanné passe par le parseur", () => {
    // Une seule entrée (le scan), une seule porte de sortie : pas de second
    // parseur à diverger.
    expect(screen).toContain("val qr = parseSchoolQr(form.qrRaw)");
    expect(scanner).toContain("ScanOptions.QR_CODE");
  });

  test("annuler le scan NE DÉTRUIT PAS l'assistant (clearTaskOnLaunch de la lib)", () => {
    // Constaté sur l'appareil : zxing déclare son activité `clearTaskOnLaunch`,
    // donc ouvrir le scan DÉTRUISAIT MainActivity — au retour on se retrouvait
    // à zéro, saisie perdue.
    expect(manifest).toContain('android:name="com.journeyapps.barcodescanner.CaptureActivity"');
    expect(manifest).toContain('android:clearTaskOnLaunch="false"');
    expect(manifest).toContain("android:clearTaskOnLaunch,android:screenOrientation");
  });

  test("icône papillon : le PNG service_pronote décliné en mipmaps, référencé", () => {
    // Sans android:icon, l'app prend l'icône système par défaut. La source est
    // assets/service_pronote.png, déclinée aux 5 densités.
    expect(manifest).toContain('android:icon="@mipmap/ic_launcher"');
    expect(manifest).toContain('android:roundIcon="@mipmap/ic_launcher"');
    for (const d of ["mdpi", "hdpi", "xhdpi", "xxhdpi", "xxxhdpi"]) {
      expect(existsSync(join(ANDROID, `app/src/main/res/mipmap-${d}/ic_launcher.png`))).toBe(true);
    }
  });

  test("la page défile : en paysage, l'action principale tombait hors écran", () => {
    // Le téléphone en rotation verrouillée (paysage) : la colonne débordait, le
    // bouton était hors de l'écran et donc inatteignable. L'assistant était
    // inutilisable — et le scanner, lui, s'ouvrait très bien.
    expect(screen.split("verticalScroll(rememberScrollState())").length - 1).toBe(1);
  });

  // #148 (recette des 14 écrans) : la capture de la route `pairing` montrait
  // deux défauts qu'aucun test ne regardait — ils sont dans la même colonne,
  // l'un sous l'autre.
  //
  // 1. « Retour » était un `Button` REMPLI : deux boutons verts de même poids
  //    sur l'écran, donc plus aucune action principale. Le retour est
  //    secondaire : `TextButton` le dit par son encre, et l'image ne change pas.
  // 2. Le titre de l'écran était suivi d'un doublon : le même mot deux fois
  //    dans la même colonne. Le titre est le `heading()` que le survol
  //    annonce, il suffit.
  test("#148 : retour secondaire, et pas de doublon dans la page unique", () => {
    expect(screen).toMatch(/TextButton\(\s*onClick = onBack,/);
    // Deux boutons REMPLIS seulement : « Scanner le QR » et « Terminer » ; le
    // retour de l'assistant n'en fait plus partie.
    const boutonsRemplis = screen.match(/\n\s+Button\(/g) ?? [];
    expect(boutonsRemplis.length).toBe(2);
    // ...et le titre de la page reste le repère du survol.
    expect(screen).toContain('text = "QR de l\'application"');
    expect(screen).toContain("semantics { heading() }");
  });
});
