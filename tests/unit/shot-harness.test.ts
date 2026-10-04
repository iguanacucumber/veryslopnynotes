import { describe, expect, test } from "bun:test";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// agents/runtime/shot.sh + deep links de debug (issue #133). La capture
// déterministe repose sur TROIS listes de routes qui doivent rester d'accord :
//   1. les `composable(...)` + `navDeepLink` de AppNav.kt (le graphe de nav),
//   2. les `<data android:host>` du manifest DEBUG (qui rend l'URL ouvrable),
//   3. les marqueurs d'écran de shot.sh (qui prouvent l'arrivée sur la route).
// Un oubli dans l'une des trois ne plante rien : la capture revient SANS
// l'écran demandé, ou pire avec l'écran de départ. Ces tests sont donc la
// seule chose qui(attrape la dérive) — sans téléphone, sans adb.
const ROOT = join(import.meta.dir, "..", "..");
const APP_NAV = readFileSync(
  join(ROOT, "android/ui/src/main/java/fr/veryslopnynotes/ui/AppNav.kt"),
  "utf8",
);
const DEBUG_MANIFEST = readFileSync(
  join(ROOT, "android/app/src/debug/AndroidManifest.xml"),
  "utf8",
);
const MAIN_MANIFEST = readFileSync(
  join(ROOT, "android/app/src/main/AndroidManifest.xml"),
  "utf8",
);
const APP_SHELL = readFileSync(
  join(ROOT, "android/ui/src/main/java/fr/veryslopnynotes/ui/AppShell.kt"),
  "utf8",
);
const SHOT = readFileSync(join(ROOT, "agents/runtime/shot.sh"), "utf8");
const UI_DIR = join(ROOT, "android/ui/src/main/java/fr/veryslopnynotes/ui");
const readUi = (f: string) => readFileSync(join(UI_DIR, f), "utf8");

/** Valeur des `const val ROUTE_X = "x"` (les onglets sont nommés, pas en dur). */
function routeConst(name: string): string {
  const m = new RegExp(`const val ${name} = "([^"]+)"`).exec(APP_NAV);
  if (!m) throw new Error(`const ${name} introuvable dans AppNav.kt`);
  return m[1]!;
}

/** Toutes les destinations déclarées, résolues : `composable(ROUTE_X)` ou `composable("litéral")`. */
function allRoutes(): string[] {
  const out: string[] = [];
  const re = /composable\(\s*(ROUTE_[A-Z]+|"([a-z]+)")\s*,/g;
  for (const m of APP_NAV.matchAll(re)) {
    out.push(m[1]!.startsWith('"') ? m[2]! : routeConst(m[1]!));
  }
  return out;
}

const ROUTES = allRoutes();

/**
 * La table `ROUTE_WITNESSES` de shot.sh (#160) : `route|titre|fragments`, les
 * fragments alternatifs étant séparés par `;`. Lue dans la SOURCE du script —
 * c'est elle qu'une refonte doit mettre à jour, donc c'est elle qu'on vérifie.
 */
const WITNESSES = new Map<string, { title: string; fragments: string[] }>(
  (SHOT.match(/ROUTE_WITNESSES='\n([\s\S]*?)\n'/)![1]!)
    .split("\n")
    .map((line) => {
      const [route = "", title = "", rest = ""] = line.split("|");
      return [route, { title, fragments: rest ? rest.split(";") : [] }] as const;
    }),
);

/** Titres de la table `TOP_BARS` d'AppShell.kt : le contrat de navigation (#135). */
const TOP_BARS = new Map<string, string>(
  [...APP_SHELL.matchAll(/(ROUTE_[A-Z]+) to TopBar\("([^"]+)"/g)].map((m) => [
    routeConst(m[1]!),
    m[2]!,
  ]),
);

/** Les cinq routes d'onglet, dans l'ordre de la barre d'onglets. */
const TABS = (
  APP_SHELL.match(/private val TAB_ROUTES = listOf\(([^)]*)\)/)?.[1] ?? ""
)
  .split(",")
  .map((r) => routeConst(r.trim()));

describe("deep links de debug (#133)", () => {
  test("chaque composable de AppNav.kt déclare un navDeepLink sur sa route", () => {
    expect(ROUTES.length).toBeGreaterThanOrEqual(14);
    // Sans `deepLinks`, l'URL est reconnue par le manifest mais ignorée par le
    // graphe : l'app s'ouvre sur son écran de départ, en silence.
    const sansDeepLink = [...APP_NAV.matchAll(/composable\(\s*(ROUTE_[A-Z]+|"[a-z]+")\s*,(?![^)]*deepLinks)/g)]
      .map(m => m[1]!.startsWith('"') ? m[1].slice(1, -1) : routeConst(m[1]!));
    expect(sansDeepLink).toEqual([]);
  });

  test("chaque route est un hôte du manifest DEBUG (sinon am start échoue)", () => {
    for (const route of ROUTES) {
      expect(DEBUG_MANIFEST).toContain(`<data android:host="${route}" />`);
    }
    // Un hôte de trop ouvrirait un écran qui n'existe pas : l'URL est alors
    // muette et l'app s'ouvre sur son écran de départ.
    const hosts = [...DEBUG_MANIFEST.matchAll(/android:host="([a-z]+)"/g)].map(m => m[1]!);
    expect(hosts.sort()).toEqual([...ROUTES].sort());
  });

  test("le manifest DEBUG force singleTask et déclare VIEW/BROWSABLE", () => {
    // standard + URL = nouvelle instance au-dessus de la tâche courante :
    // deux écrans superposés, la capture montre l'ancien.
    expect(DEBUG_MANIFEST).toContain('android:launchMode="singleTask"');
    expect(DEBUG_MANIFEST).toContain('android:scheme="veryslopnynotes"');
    expect(DEBUG_MANIFEST).toContain("android.intent.action.VIEW");
    expect(DEBUG_MANIFEST).toContain("android.intent.category.BROWSABLE");
  });

  test("le manifeste MAIN (donc la release) n'a AUCUN deep link", () => {
    // L'invariant derrière tout le reste : l'APK publiable ne répond à aucune
    // URL extérieure. Un intent-filter VIEW ici ouvrirait l'app depuis un site.
    expect(MAIN_MANIFEST).not.toContain("android.intent.action.VIEW");
    expect(MAIN_MANIFEST).not.toContain("veryslopnynotes://");
    expect(MAIN_MANIFEST).not.toContain('android:launchMode="singleTask"');
    // Seul le filtre LAUNCHER reste, comme avant #133.
    expect(MAIN_MANIFEST).toContain("android.intent.category.LAUNCHER");
    expect((MAIN_MANIFEST.match(/<intent-filter>/g) ?? []).length).toBe(1);
  });
});

describe("marqueurs d'écran (#160)", () => {
  // #160 : le marqueur était une phrase tirée du CORPS d'un écran, donc il
  // périmait à chaque refonte (l'accueil est devenu des widgets : « Dernières
  // notes » a disparu alors que l'écran était PARFAIT). Le témoin est désormais
  // le TITRE de la barre du haut — le libellé du contrat de navigation, table
  // `TOP_BARS` d'AppShell.kt — plus, quand le titre ne prouve rien, un fragment
  // propre à l'écran.

  test("chaque route déclarée a un témoin, et la table ne connaît que les routes déclarées", () => {
    // `route_known` sert aussi de liste blanche : une route sans témoin est
    // refusée AVANT toute écriture, sinon shot.sh capturerait l'écran de
    // départ en annonçant une réussite.
    const sansTemoin = ROUTES.filter(r => !WITNESSES.get(r)?.title);
    expect(sansTemoin).toEqual([]);
    expect([...WITNESSES.keys()].sort()).toEqual([...ROUTES].sort());
    // Une seule ligne par route : deux lignes, c'est un témoin qui diverge.
    const lignes = SHOT.match(/ROUTE_WITNESSES='\n([\s\S]*?)\n'/)?.[1]!.split("\n") ?? [];
    expect(lignes).toHaveLength(ROUTES.length);
  });

  test("le titre du témoin EST le titre de la barre du haut (AppShell.kt, TOP_BARS)", () => {
    // Une seule source de vérité côté app : si `TOP_BARS` change, le témoin
    // change avec lui. Sans ce lien, la table serait une deuxième source à
    // mettre à jour à la main — donc une deuxième source à oublier.
    for (const route of ROUTES) {
      const titre = TOP_BARS.get(route);
      expect({ route, titre, dansLaTable: titre === WITNESSES.get(route)?.title }).toEqual({
        route,
        titre,
        dansLaTable: true,
      });
    }
  });

  test("aucun témoin n'est un libellé d'onglet nu : les 5 onglets exigent un fragment", () => {
    // La barre d'onglets affiche « Accueil », « EDT », « Tâches », « Notes »,
    // « Profil » sur TOUTES les routes : un témoin qui se réduit à ça est
    // toujours présent, donc ne prouve RIEN (c'était le piège du marqueur).
    expect(TABS).toHaveLength(5);
    for (const route of TABS) {
      const { title = "", fragments = [] } = WITNESSES.get(route) ?? {};
      expect({ route, nu: fragments.length === 0, redondant: fragments.includes(title) }).toEqual({
        route,
        nu: false,
        redondant: false,
      });
    }
  });

  test("chaque fragment existe LITTÉRALEMENT dans l'écran de sa route", () => {
    // Le cœur du défaut : un marqueur qui ne se lit plus dans l'interface. Le
    // fichier est nommé par la route pour que le test dise OÙ regarder.
    const ecrans: Record<string, string[]> = {
      index: ["IndexScreen.kt", "HomeCards.kt"],
      calendar: ["TimetableWeek.kt"],
      grades: ["GradesScreen.kt"],
      tasks: ["Assignments.kt"],
      profile: ["ProfileScreen.kt"],
      settings: ["SettingsScreen.kt"],
      canteen: ["CanteenMenus.kt"],
      attendance: ["Attendance.kt"],
      messages: ["MessagesScreen.kt"],
      pairing: ["PairingScreen.kt"],
      alerts: ["SecurityAlertsScreen.kt"],
      // Titre réimprimé en bouton par l'onglet Notes (« Compétences ») et, pour
      // les sanctions, par la Vie scolaire : le fragment vient de l'écran voisin.
      competences: ["AppNav.kt"],
      sanctions: ["Attendance.kt"],
    };
    // `news` et `fiches` n'ont pas de fragment : leur corps ne dépend que de la
    // donnée, donc aucun libellé fixe — le tableau ci-dessus le dit.
    for (const route of ROUTES) {
      const attendu = route !== "news" && route !== "fiches";
      const { fragments = [] } = WITNESSES.get(route) ?? {};
      expect({ route, attendu, aUnFragment: fragments.length > 0 }).toEqual({
        route,
        attendu,
        aUnFragment: attendu,
      });
    }
    for (const [route, fichiers] of Object.entries(ecrans)) {
      const source = fichiers.map(readUi).join("\n");
      for (const fragment of WITNESSES.get(route)?.fragments ?? []) {
        expect({ route, fragment, present: source.includes(fragment) }).toEqual({
          route,
          fragment,
          present: true,
        });
      }
    }
    // Et un fragment n'est JAMAIS le titre d'une AUTRE route : sinon il ne
    // distingue pas deux écrans (c'est exactement le piège du libellé d'onglet,
    // réactivé par un autre chemin).
    const titres = [...TOP_BARS.values()];
    for (const { fragments } of WITNESSES.values()) {
      for (const fragment of fragments) {
        expect({ fragment, estUnTitre: titres.includes(fragment) }).toEqual({
          fragment,
          estUnTitre: false,
        });
      }
    }
  });

  test("l'échec dit que l'ÉCRAN est peut-être bon, et où changer le marqueur", () => {
    // Le défaut de #160 : « la route N'EST PAS atteinte » envoyait chercher une
    // panne de navigation sur un écran parfaitement correct.
    expect(SHOT).not.toContain("N'EST PAS atteinte");
    for (const attendu of [
      "NON PROUVÉE",
      "peut-être CORRECT",
      "witness_line", // la ligne du fichier où vit le marqueur
      "AppShell.kt (TOP_BARS)",
      "Libellés vus",
    ]) {
      expect({ attendu, present: SHOT.includes(attendu) }).toEqual({ attendu, present: true });
    }
    // Le garde-fou de dérive vers le profil est TIRÉ de la table, pas réécrit.
    expect(SHOT).toContain("PROFILE_MARKER=$(route_fragments profile");
  });
});

describe("shot.sh (#133)", () => {
  test("lance par deep link, force-stop d'abord, et échoue bruyamment", () => {
    expect(SHOT).toContain("set -euo pipefail");
    // Sans arrêt forcé, onNewIntent est ignoré (le NavController ne se
    // reconstruit pas) : la capture montre l'écran précédent, en silence.
    expect(SHOT).toContain("am force-stop");
    expect(SHOT).toContain('"$SCHEME://$ROUTE"');
    // Chaque refus nomme ce qui N'A PAS été fait, et sort non nul.
    for (const refusal of [
      "aucun appareil prêt", // pas d'appareil
      "route inconnue", // route fantôme
      "n'est pas installé", // référence absente
      "capture NOIRE", // écran éteint
      "VERROUILLÉ", // code d'appareil
      "APPAIRAGE", // session absente
      "NON PROUVÉE", // #160 : témoin périmé, écran peut-être bon
      "instal", // refus d'installation
    ]) {
      expect({ refus: refusal, present: SHOT.includes(refusal) }).toEqual({
        refus: refusal,
        present: true,
      });
    }
  });

  test("détecte l'image noire et réveille l'écran avant de conclure", () => {
    // Une capture non contrôlée ne vaut rien : trois outils essayés dans
    // l'ordre, et échec si aucun n'est là.
    // Trois outils, un seul import : ImageMagick d'abord (lit le PNG), puis
    // ffmpeg et enfin bun/node sur le tampon BRUT (ce ffmpeg ne décode pas le
    // PNG). Aucun disponible = la capture est REFUSÉE, pas acceptée.
    const corps = SHOT.slice(SHOT.indexOf("blank_verdict()"));
    expect(corps.indexOf("command -v identify")).toBeLessThan(corps.indexOf("command -v ffmpeg"));
    expect(corps.indexOf("command -v ffmpeg")).toBeLessThan(corps.indexOf("for rt in bun node"));
    expect(corps).toContain("die ");
    // Éteint = réveil + UNE nouvelle tentative, jamais une capture acceptée.
    expect(corps).toContain("KEYCODE_WAKEUP");
    expect(SHOT).toContain("svc power stayon true");
  });

  test("ne désinstalle jamais l'app (la session appairée vaut un QR)", () => {
    // Une désinstallation effacerait la session appairée (QR à rescaner) : le
    // script doit échouer et laisser l'utilisateur trancher.
    expect(SHOT).not.toMatch(/^\s*(adb|a)\s+(shell\s+)?pm\s+(uninstall|clear)/m);
    expect(SHOT).not.toMatch(/^\s*(adb|a)\s+uninstall/m);
  });

  test("les captures et les frames de référence ne sont jamais commitées", () => {
    const gitignore = readFileSync(join(ROOT, ".gitignore"), "utf8");
    // L'écran d'accueil de l'appareil affiche le vrai nom, l'établissement,
    // les devoirs et les notes : jamais dans le dépôt.
    expect(gitignore).toContain("/shots/");
    expect(gitignore).toContain("/ref-papillon/");
  });

  test("la cible make shot passe par la découverte partagée et exige ROUTE", () => {
    const makefile = readFileSync(join(ROOT, "Makefile"), "utf8");
    expect(makefile).toContain("shot:");
    expect(makefile).toContain("agents/runtime/shot.sh $(ROUTE)");
    expect(makefile).toMatch(/if \[ -z "\$\(ROUTE\)" \]/);
    expect(makefile).toContain("android_toolchain_hint");
    // La porte de sortie de la capture, sinon il faut réécrire la commande entière.
    expect(makefile).toContain("$(SHOT_ARGS)");
  });
});

// ---------------------------------------------------------------------------
// #151 : la capture doit montrer l'ARBRE DE TRAVAIL, pas un APK d'hier.
//
// Fixture façon check-kotlin.ts (kotlin-check.test.ts) : le VRAI shot.sh est
// recopié dans un tmpdir avec un faux `gradlew` et un faux `adb`, donc aucun
// téléphone, aucun SDK, aucun APK commité. Le faux gradlew « compile » en
// recopiant `apk-content` : changer le code source du test change donc le sha
// de l'APK, et le faux adb ne fait semblant d'avoir installé que ce sha-là.
//
// Ce qui est vérifié, c'est le CONTRAT, pas le rendu : Gradle construit, et
// l'appareil est comparé par empreinte. C'est exactement ce que le code d'avant
// ratait — sa comparaison de mtimes annonçait « à jour » sur un APK plus vieux
// que les sources, donc la capture montrait l'ancienne interface sans le dire.

const SHOT_SH = join(ROOT, "agents/runtime/shot.sh");
const ENV_SH = join(ROOT, "agents/runtime/android-env.sh");

/** PNG 8×8, 3 couleurs, écart-type 0.28 : « image rendue », pas un écran éteint. */
const PNG_3_COLORS =
  "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAJUlEQVR4nGP4rxv6//vPX//lNfX+Y2Mz4JMEsRnwSYLYDEPBCgBVhKkgq0FCnwAAAABJRU5ErkJggg==";

/** Faux JDK : `bin/java -version` qui annonce 17 (comme android-toolchain.test.ts). */
function fakeJdk(): string {
  const dir = mkdtempSync(join(tmpdir(), "shot-jdk-"));
  mkdirSync(join(dir, "bin"));
  writeFileSync(join(dir, "bin/java"), `#!/bin/sh\necho 'openjdk version "17.0.1" 2026-08-18' >&2\n`);
  chmodSync(join(dir, "bin/java"), 0o755);
  return dir;
}

/** Faux adb : journal + appareil unique + ce que shot.sh demande, rien d'autre. */
const FAKE_ADB = `#!/bin/sh
# \`installed-sha\` = ce que l'appareil croit faire tourner (vide au départ).
# Basculeurs : NO_SHA = appareil sans sha256sum, REFUSAL = installation rejetée.
set -u
H="\${HARNESS:?}"
printf '%s\\n' "adb $*" >> "$H/adb.log"
while [ $# -gt 0 ]; do
  case "$1" in -s) shift 2 ;; *) break ;; esac
done
cmd="\${1:-}"
shift 2>/dev/null || true
frame() {
  # identify lit le PNG ; sans ImageMagick, blank_verdict retombe sur le tampon
  # BRUT (256 octets = 8x8 RGBA), que tout le monde sait lire.
  if command -v identify >/dev/null 2>&1; then cat "$H/capture.png"; else
    p='\\\\377\\\\055\\\\125\\\\377'; s=''; while [ \${#s} -lt 256 ]; do s="$s$p"; done; printf "$s"
  fi
}
shell() {
  case "\${1:-}" in
    dumpsys) printf '    codePath=/data/app/~~x/fr.veryslopnynotes.app-fixture/\\n' ;;
    sha256sum)
      [ "\${NO_SHA:-0}" = 1 ] && { printf 'sha256sum: not found\\n' >&2; exit 127; }
      sha=$(cat "$H/installed-sha" 2>/dev/null || true)
      [ -n "$sha" ] || { printf 'sha256sum: not found\\n' >&2; exit 127; }
      printf '%s  %s\\n' "$sha" "\${2:-base.apk}" ;;
    wm) printf 'Physical size: 8x8\\n' ;;
    uiautomator) printf 'UI hierchary dumped to: %s\\n' "\${2:-/sdcard/ui.xml}" ;;
    cat)
      # #160 : le dump ne porte QUE les libellés du témoin de l'accueil (le
      # titre de barre du haut « Accueil » + « Afficher plus » d'une carte
      # widget). Un fichier \`texts\` présent le remplace ligne par ligne : c'est
      # ainsi qu'on rejoue un écran dont le texte a changé.
      if [ -f "$H/texts" ]; then
        while IFS= read -r t; do printf '<node text="%s"/>' "$t"; done < "$H/texts"
        printf '\\n'
      else
        printf '<node text="Accueil"/><node text="Afficher plus \\342\\206\\227"/>\\n'
      fi ;;
    *) : ;;
  esac
}
case "$cmd" in
  devices) printf 'List of devices attached\\nfixture-device\\tdevice\\n\\n' ;;
  install)
    [ "\${REFUSAL:-0}" = 1 ] && { printf 'INSTALL_FAILED_UPDATE_INCOMPATIBLE\\n' >&2; exit 1; }
    for arg in "$@"; do
      case "$arg" in -r) ;; *)
        sha256sum "$arg" | cut -d' ' -f1 > "$H/installed-sha"
        printf 'installed %s\\n' "$(cat "$H/installed-sha")" >> "$H/installs.log"
      ;; esac
    done
    printf 'Success\\n' ;;
  exec-out)
    case "\${1:-}" in -p) cat "$H/capture.png" ;; *) frame ;; esac ;;
  shell) shell "$@" ;;
  *) : ;;
esac
`;

/** Faux gradlew : journalise, puis « compile » = recopier `apk-content`. */
const FAKE_GRADLEW = `#!/bin/sh
set -eu
printf '%s\\n' "$*" >> "$HARNESS/gradle.log"
cp "$HARNESS/apk-content" app/build/outputs/apk/debug/app-debug.apk
`;

interface Run {
  code: number;
  out: string;
  /** Invoctions Gradle de CE passage. */
  gradle: number;
  /** APK installé par CE passage, dans l'ordre. */
  installs: string[];
}

const sha256 = (s: string) => new Bun.CryptoHasher("sha256").update(s).digest("hex");

function harness(): {
  dir: string;
  run: (args: string[], env?: Record<string, string>) => Run;
  /** Nouveau code « compilé » par la suite : le sha de l'APK change. */
  setApkContent: (content: string) => void;
  /** Source plus récente que l'APK : l'état « périmé » de #151. */
  touchSource: () => void;
  installedSha: () => string;
  captured: () => Buffer;
} {
  const dir = mkdtempSync(join(tmpdir(), "shot-151-"));
  mkdirSync(join(dir, "agents/runtime"), { recursive: true });
  mkdirSync(join(dir, "bin"), { recursive: true });
  const apkDir = join(dir, "android/app/build/outputs/apk/debug");
  mkdirSync(apkDir, { recursive: true });
  const src = join(dir, "android/ui/src/main/java/fr/veryslopnynotes/ui/Index.kt");
  mkdirSync(join(src, ".."), { recursive: true });
  writeFileSync(src, "package fr.veryslopnynotes.ui\n");
  // Le VRAI script recopié, jamais une réécriture : le test porte sur lui.
  copyFileSync(SHOT_SH, join(dir, "agents/runtime/shot.sh"));
  copyFileSync(ENV_SH, join(dir, "agents/runtime/android-env.sh"));
  writeFileSync(join(dir, "capture.png"), Buffer.from(PNG_3_COLORS, "base64"));
  writeFileSync(join(dir, "apk-content"), "APK v1\n");
  copyFileSync(join(dir, "apk-content"), join(apkDir, "app-debug.apk"));
  writeFileSync(join(dir, "bin/adb"), FAKE_ADB);
  chmodSync(join(dir, "bin/adb"), 0o755);
  writeFileSync(join(dir, "android/gradlew"), FAKE_GRADLEW);
  chmodSync(join(dir, "android/gradlew"), 0o755);
  const jdk = fakeJdk();
  const sdk = mkdtempSync(join(tmpdir(), "shot-sdk-"));

  const read = (p: string) => {
    try {
      return readFileSync(p, "utf8");
    } catch {
      return "";
    }
  };
  const lines = (p: string) => read(p).split("\n").filter(Boolean);
  let gradleSeen = 0;
  let installsSeen = 0;
  const text = (b: Uint8Array) => new TextDecoder().decode(b);
  return {
    dir,
    run: (args, env = {}) => {
      const p = Bun.spawnSync([join(dir, "agents/runtime/shot.sh"), ...args], {
        cwd: dir,
        env: {
          PATH: `${join(dir, "bin")}:${process.env["PATH"] ?? ""}`,
          // android-env.sh lit « ${HOME}/.cache/jdk17 » : sans HOME, `set -u`
          // de shot.sh tombe avant même d'atteindre la construction.
          HOME: "/nonexistent-home",
          HARNESS: dir,
          ANDROID_JDK_HOME: jdk,
          ANDROID_HOME: sdk,
          ...env,
        },
        stdout: "pipe",
        stderr: "pipe",
      });
      const gradle = lines(join(dir, "gradle.log")).length;
      const installs = lines(join(dir, "installs.log")).slice(installsSeen);
      const out = {
        code: p.exitCode ?? -1,
        out: text(p.stdout) + text(p.stderr),
        gradle: gradle - gradleSeen,
        installs: installs.map(l => l.replace("installed ", "")),
      };
      gradleSeen = gradle;
      installsSeen += installs.length;
      return out;
    },
    setApkContent: content => writeFileSync(join(dir, "apk-content"), content),
    touchSource: () => {
      const future = new Date(Date.now() + 60_000);
      utimesSync(src, future, future);
    },
    installedSha: () => read(join(dir, "installed-sha")).trim(),
    // Le dossier de capture est daté en UTC : on le cherche plutôt que de le
    // deviner, sinon le test raterait une fois par jour à minuit UTC.
    captured: () => {
      const days = readdirSync(join(dir, "shots"));
      return readFileSync(join(dir, "shots", days[0]!, "index.png"));
    },
  };
}

describe("shot.sh : l'APK capturé est celui des sources (#151)", () => {
  test("premier passage : Gradle construit, l'APK est installé, la capture est vérifiée", () => {
    const h = harness();
    const r = h.run(["index", "--wait", "0"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("shot : construction de l'APK debug");
    // Aucun APK installé avant : l'appareil ne peut pas faire tourner l'empreinte
    // qu'on vient de construire, donc on installe — puis on relit sur l'appareil.
    expect(r.installs).toEqual([sha256("APK v1\n")]);
    expect(h.installedSha()).toBe(sha256("APK v1\n"));
    expect(r.out).toContain("shot : route vérifiée (« Accueil » + « Afficher plus »).");
    // Le fichier existe et n'est pas vide. Son OCTET exact dépend de la machine
    // (PNG si ImageMagick est là, tampon brut sinon) : blank_verdict, lui, vient
    // de décider que l'image est rendue — c'est ce verdict qui compte.
    expect(h.captured().length).toBeGreaterThan(0);
  });

  test("rien n'a changé : construction vérifiée, MAIS installation évitée", () => {
    const h = harness();
    h.run(["index", "--wait", "0"]);
    const r = h.run(["index", "--wait", "0"]);
    // Gradle est TOUJOURS lancé : c'est lui qui dit si l'APK est périmé, pas une
    // comparaison de mtimes (inversée en #151 : « à jour » sur un APK périmé).
    expect(r.gradle).toBe(1);
    expect(r.installs).toEqual([]);
    expect(r.out).toContain("installation évitée");
  });

  test("RÉGRESSION #151 : une source plus récente que l'APK reconstruit ET réinstalle", () => {
    const h = harness();
    h.run(["index", "--wait", "0"]);
    // Le code change, Gradle n'a pas tourné : l'APK sur le disque est l'ancien.
    h.setApkContent("APK v2\n");
    h.touchSource();

    const r = h.run(["index", "--wait", "0"]);
    // Le défaut : aucune reconstruction, « installation évitée », et la capture
    // montrait l'ancienne interface sans jamais le dire.
    expect(r.gradle).toBe(1);
    expect(r.out).toContain("shot : construction de l'APK debug");
    expect(r.out).not.toContain("installation évitée");
    expect(r.installs).toEqual([sha256("APK v2\n")]);
    expect(h.installedSha()).toBe(sha256("APK v2\n"));
    expect(r.code).toBe(0);
  });

  test("empreinte illisible sur l'appareil : on installe quand même, jamais de silence", () => {
    const h = harness();
    h.run(["index", "--wait", "0"]);
    const r = h.run(["index", "--wait", "0"], { NO_SHA: "1" });
    expect(r.out).toContain("appareil inconnu");
    expect(r.installs).toEqual([sha256("APK v1\n")]);
    expect(r.code).toBe(0);
  });

  test("outillage absent : GRADLE NON lancé, sortie en erreur, aucune capture", () => {
    const h = harness();
    const r = h.run(["index", "--wait", "0"], {
      ANDROID_JDK_HOME: "",
      JAVA_HOME: "",
      ANDROID_HOME: "",
      ANDROID_SDK_ROOT: "",
      HOME: "/nonexistent",
    });
    expect(r.code).toBe(1);
    expect(r.out).toContain("outillage absent");
    expect(r.gradle).toBe(0);
    expect(r.out).not.toContain("route vérifiée");
    // Pas de capture : une image non contrôlée ne vaut rien.
    expect(existsSync(join(h.dir, "shots"))).toBe(false);
  });

  test("--no-build : pas de Gradle, et le script DIT que la capture peut dater", () => {
    const h = harness();
    h.run(["index", "--wait", "0"]);
    h.setApkContent("APK v3\n");
    const r = h.run(["index", "--wait", "0", "--no-build"]);
    expect(r.gradle).toBe(0);
    expect(r.installs).toEqual([]);
    expect(r.out).toContain("--no-build");
    expect(r.out).toContain("interface périmée");
  });

  test("installation refusée : on ne désinstalle jamais, la session appairée survit", () => {
    const h = harness();
    const r = h.run(["index", "--wait", "0"], { REFUSAL: "1" });
    expect(r.code).toBe(1);
    expect(r.out).toContain("installation refusée");
    expect(r.out).toContain("QR à rescaner");
    expect(r.out).not.toContain("route vérifiée");
  });

  test("pas de comparaison de mtimes : Gradle est l'autorité, l'empreinte la preuve", () => {
    // Le motif exact du défaut #151 : `-newer "$APK"` décidait du build, et son
    // inversion annonçait « à jour » sur un APK plus vieux que les sources. Un
    // objet plutôt qu'un `not.toMatch` : sinon l'échec reprinted tout le script.
    expect({
      compareDesMtimes: /-newer\s+"?\$\{?APK/.test(SHOT),
      fonctionApkIsStale: SHOT.includes("apk_is_stale"),
    }).toEqual({ compareDesMtimes: false, fonctionApkIsStale: false });
    // L'état « périmé » est écrit dans le code ET dans son aide, sinon le même
    // défaut revient avec une autre formulation.
    expect({
      perime: SHOT.includes("périmé"),
      empreinte: SHOT.includes("sha256sum"),
      installR: SHOT.includes("install -r"),
      noBuild: SHOT.includes("--no-build"),
    }).toEqual({ perime: true, empreinte: true, installR: true, noBuild: true });
  });
});

// ---------------------------------------------------------------------------
// #160 : le témoin d'écran, rejoué SANS téléphone. Le faux adb sert le dump
// uiautomator, donc on rejoue les trois issues : l'accueil plein, l'accueil vide
// (fragment ALTERNATIF) et l'accueil dont le texte a changé (échec actionnable).

describe("shot.sh : le témoin d'écran (#160)", () => {
  /** Dump uiautomator du fixture : un `text` par libellé. */
  function screen(h: { dir: string }, labels: string[]) {
    writeFileSync(join(h.dir, "texts"), labels.join("\n") + "\n");
  }

  test("accueil PLEIN : titre + fragment, les deux cités", () => {
    const h = harness();
    screen(h, ["Accueil", "Données hors-ligne · mis à jour il y a 4 h", "Afficher plus ↗"]);
    const r = h.run(["index", "--wait", "0"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("shot : route vérifiée (« Accueil » + « Afficher plus »).");
  });

  test("accueil VIDE : le fragment ALTERNATIF suffit (aucune donnée en cache)", () => {
    const h = harness();
    screen(h, ["Accueil", "Rien à afficher", "Aucune donnée en cache. Appairez puis actualisez un onglet."]);
    const r = h.run(["index", "--wait", "0"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("shot : route vérifiée (« Accueil » + « Rien à afficher »).");
  });

  test("texte changé : NON PROUVÉE, l'écran est innocenté, la ligne du marqueur est nommée", () => {
    // Le défaut de #160 : l'accueil est devenu des widgets, « Dernières notes »
    // a disparu, et le script concluait « la route N'EST PAS atteinte » — donc
    // une panne de navigation imaginée. Le message dit maintenant que l'écran
    // peut être bon, et où changer le marqueur.
    const h = harness();
    screen(h, ["Accueil", "Données hors-ligne · mis à jour il y a 4 h", "Actualiser", "Actualités", "Cantine"]);
    const r = h.run(["index", "--wait", "0"]);
    expect(r.code).toBe(1);
    expect(r.out).toContain("route « index » NON PROUVÉE");
    // Le titre est là, le fragment non : le message le DIT, au lieu de tout
    // mettre sur le dos de la route.
    expect(r.out).toContain("Titre attendu « Accueil » : présent.");
    expect(r.out).toContain("Fragment(s) attendu(s)");
    expect(r.out).toContain("ABSENT");
    expect(r.out).toContain("L'écran est peut-être CORRECT");
    // Et la ligne exacte du marqueur dans le VRAI script, pas dans la fixture.
    const ligne = readFileSync(SHOT_SH, "utf8").split("\n").findIndex((l) => l.startsWith("index|Accueil|")) + 1;
    expect(r.out).toContain(`shot.sh:${ligne} (table ROUTE_WITNESSES)`);
    // La capture reste : c'est elle qu'on regarde pour trancher.
    expect(r.out).toContain("Capture conservée (preuve)");
  });

  test("route inconnue : refusée AVANT toute écriture, la liste sort en clair", () => {
    const h = harness();
    const r = h.run(["nawak", "--wait", "0"]);
    expect(r.code).toBe(1);
    expect(r.out).toContain("route inconnue : « nawak »");
    expect(r.out).not.toContain("route vérifiée");
    expect(existsSync(join(h.dir, "shots"))).toBe(false);
  });

  test("dérive vers le PROFIL : nommée par son nom, pas par une absence de témoin", () => {
    // Le profil affiche en BOUTON « Actualités », « Vie scolaire », « Messages »
    // : sans le garde-fou, le titre d'une route secondaire y passerait pour une
    // arrivée correcte.
    const h = harness();
    screen(h, ["Profil", "Détecter les onglets", "Actualités", "Vie scolaire", "Messages"]);
    const r = h.run(["news", "--wait", "0"]);
    expect(r.code).toBe(1);
    expect(r.out).toContain("ARRIVÉ sur l'écran PROFIL au lieu de « news »");
  });
});

// ---------------------------------------------------------------------------
// #166 : LE TÉMOIN NE DOIT PAS ÊTRE DE LA DONNÉE.
//
// Le défaut : `grades|Notes|Moyennes par matière`, et ce libellé ne sort que dans
// la branche qui a des notes à montrer. Hors ligne, sur un écran PARFAITEMENT
// CORRECT, la capture échouait — et l'échec accuse une panne de navigation.
//
// Ces deux tableaux sont la RÈGLE, écrite une fois : pour chaque route, ce que le
// dump uiautomator rend (a) quand l'établissement publie, (b) quand il ne
// publie rien. Le test rejoue les DEUX variantes dans le harnais, donc la preuve
// ne dépend pas d'une relecture : un témoin qui n'est lisible que dans un état
// fait sortir le script en 1.
//
// Les libellés sont ceux des écrans (fichiers nommés en tête de chaque bloc), la
// barre d'onglets comprise : sans elle, un témoin comme « Réessayer » passerait
// pour propre alors qu'il est partagé par sept écrans.

/** Libellés de la barre d'onglets, dans l'ordre d'AppShell.kt (TAB_ROUTES). */
const ONGLETS = ["Accueil", "EDT", "Tâches", "Notes", "Profil"];

/**
 * Dump uiautomator du fixture : un `text` par libellé, dans l'ordre vu.
 * C'est ce que le faux adb sert à la place de `uiautomator dump` (cf. FAKE_ADB).
 */
function ecran(h: { dir: string }, labels: string[]): void {
  writeFileSync(join(h.dir, "texts"), labels.join("\n") + "\n");
}

/** Garde-fous de `verify_route` : les deux dérives nommées (cf. shot.sh). */
const TEMOIN_PROFIL = "Détecter les onglets";
const ARTEFACT_APPAIRAGE = /adresse du serveur|code pin du qr|contenu du qr|ton établissement/;

/**
 * Tout le module `ui` en un seul texte : un libellé de fixture doit être RÉEL,
 * sinon le rejeu mentirait sur l'écran qu'il prétend rejouer.
 *
 * On cherche dans le PAQUET et non dans une liste de fichiers par route : les
 * écrans se scindent (Attendance → AttendanceFormat/AttendanceRows,
 * ProfileScreen → ProfileAccountSwitcher…) et une liste à la main devient un
 * faux rouge dès qu'un autre agent décompose un écran. Le lien
 * route ↔ fichier, lui, reste vérifié juste au-dessus, pour les TÉMOINS — c'est
 * là qu'il compte.
 */
const UI_ENTIER = [...readdirSync(UI_DIR)]
  .filter((f) => f.endsWith(".kt"))
  .map((f) => readFileSync(join(UI_DIR, f), "utf8"))
  .join("\n");

interface Variante {
  /** Libellés du dump quand la donnée est là. */
  plein: string[];
  /** Libellés du dump quand l'établissement ne publie rien. */
  vide: string[];
}

/**
 * Les DEUX états de chaque route : ce que le dump uiautomator rend quand
 * l'établissement publie, et quand il ne publie rien.
 *
 * Tous les libellés sont du CHROME d'écran, jamais de la donnée : c'est ce que
 * `verify_route` cherche, et c'est ce qui se relit dans la source. Un witness
 * qui n'apparaît qu'accompagné de données n'aurait rien à prouver ici.
 */
const VARIANTES: Record<string, Variante> = {
  // Les widgets portent un titre et chacun son bouton « Afficher plus » ; l'état
  // sans rien porte « Rien à afficher ».
  index: {
    plein: ["Prochain cours", "Moyenne", "Devoirs", "Afficher plus ↗"],
    vide: ["Rien à afficher", "Aucune donnée en cache. Appairez puis actualisez un onglet."],
  },
  // Le bandeau de semaine est rendu AVANT le contenu : « semaine du » se lit
  // même sans un seul cours, et la pause méridienne est un libellé du contrat.
  calendar: {
    plein: ["semaine du", "Prochain cours", "Pause méridienne"],
    vide: ["semaine du", "Aucun cours cette semaine", "Tirez vers le bas pour actualiser, ou changez de semaine."],
  },
  // #162 a retiré les titres de section de l'état sans donnée : il ne reste que
  // `GradesNothingToShow` (« aucune note publiée ») et le cache vide (« Aucune
  // note en cache »). C'est ce qui manquait — la capture hors ligne échouait sur
  // « Moyennes par matière », qui ne sort qu'avec des notes.
  grades: {
    plein: ["Moyennes par matière", "Nouvelles notes", "Matière ou évaluation"],
    vide: ["Aucune note sur cette période", "L'établissement n'a publié aucune note ici.", "Actualiser"],
  },
  // L'en-tête « Devoirs de la semaine » est rendu hors de la liste.
  tasks: {
    plein: ["Devoirs de la semaine", "En retard", "Rechercher un devoir", "Toutes", "Actualiser"],
    vide: ["Devoirs de la semaine", "Rechercher un devoir", "Aucun devoir cette semaine", "Rien à rendre pour le moment."],
  },
  // Les boutons de destination sont rendus inconditionnellement.
  profile: {
    plein: ["Détecter les onglets", "Messages", "Appairage QR+PIN", "Fiches révision"],
    vide: ["Détecter les onglets", "Aucune information publiée pour ce compte.", "compte appairé"],
  },
  // Les titres de section « Matières » et « Assistant devoirs » sont fixes.
  settings: {
    plein: ["Matières", "Assistant devoirs", "Ajouter la matière", "Enregistrer la clé"],
    vide: ["Matières", "Aucune matière personnalisée.", "Assistant devoirs"],
  },
  // Le corps de cet écran ne rend QUE de la donnée : pas de fragment, son titre
  // de barre suffit. L'état vide doit rester lisible, c'est ce qui est rejoué.
  news: {
    plein: ["Données hors-ligne (périmé)."],
    vide: ["Aucune actualité."],
  },
  // « Menus de la semaine » est écrit avant la branche d'état.
  canteen: {
    plein: ["Menus de la semaine", "Actualiser"],
    vide: ["Menus de la semaine", "Aucun menu publié cette semaine.", "Actualiser"],
  },
  // Le SOUS-TITRE de l'écran en cache est rendu avant l'état ; les trois lignes
  // ci-dessous sont les trois états sans donnée (cache vide, réseau, zéro
  // absence), pas un seul.
  attendance: {
    plein: ["Absences et retards", "Toutes", "Sanctions", "Actualiser"],
    vide: ["Absences et retards", "Aucune donnée en cache", "Aucune absence ni retard"],
  },
  // Même écran en cache, sous-titre « Punitions vie scolaire ».
  sanctions: {
    plein: ["Punitions vie scolaire", "Toutes", "Actualiser"],
    vide: ["Punitions vie scolaire", "Aucune sanction publiée"],
  },
  // « Discussions » est écrit avant la branche d'état.
  messages: {
    plein: ["Discussions", "Nouvelle discussion", "Ouvrir", "Actualiser"],
    vide: ["Discussions", "Aucune discussion.", "Réessayer"],
  },
  // Le bouton « Retour » est rendu par TOUTES les étapes. Pas de barre d'onglets
  // (`showsTabBar`), et ces libellés déclenchent le garde-fou d'appairage —
  // ce que la règle ci-dessous doit donc reproduire.
  pairing: {
    plein: ["Ton établissement", "Adresse de l'établissement", "Continuer", "Retour"],
    vide: ["QR de l'application", "Scanner le QR", "Contenu du QR (login + jeton)", "Code PIN du QR", "Terminer", "Retour"],
  },
  // Titre de section rendu avant l'état.
  alerts: {
    plein: ["Injections neutralisées (données, jamais exécutées).", "Donnée suspecte (non exécutée) : "],
    vide: ["Injections neutralisées (données, jamais exécutées).", "Aucune alerte. Bon signe."],
  },
  // Comme `news` : le corps ne rend que de la donnée, le titre de barre suffit.
  fiches: {
    plein: ["Charger", "Simuler erreur"],
    vide: ["Aucune fiche. Générée auto à l'annonce d'un DS.", "Charger"],
  },
  // AppNav.kt passe le sous-titre à l'écran en cache d'Attendance.kt.
  competences: {
    plein: ["Évaluations par compétences", "Touchez une compétence pour son détail.", "Détail compétence"],
    vide: ["Évaluations par compétences", "Aucune compétence publiée par l'établissement.", "Actualiser"],
  },
};

describe("le témoin d'écran ne dépend pas de la donnée (#166)", () => {
  /** Libellés de la barre d'onglets d'une route (`showsTabBar`, AppShell.kt). */
  function barreOnglets(route: string): string[] {
    return route === "pairing" || route === "settings" ? [] : ONGLETS;
  }

  /**
   * La RÈGLE de `verify_route`, rejouée hors script — trois lignes, cf. shot.sh :
   * le titre doit se lire, le garde-fou du profil ne doit pas déclencher, et un
   * fragment de la route doit se lire. C'est ce critère qui permet de comparer
   * 15 × 14 paires sans lancer 210 fois le script ; les 30 rejeux ci-dessous
   * vérifient qu'il COLLE à la sortie du vrai script, et deux tests #160
   * vérifient le cas négatif.
   */
  function verifie(route: string, labels: string[]): boolean {
    const texte = labels.join("\n");
    const { title = "", fragments = [] } = WITNESSES.get(route) ?? {};
    if (!title || !texte.includes(title)) return false;
    if (route !== "profile" && texte.includes(TEMOIN_PROFIL)) return false;
    if (route !== "pairing" && ARTEFACT_APPAIRAGE.test(texte)) return false;
    return fragments.length === 0 || fragments.some((f) => texte.includes(f));
  }

  /** Les libellés du dump d'une route dans un état, et ce dump servi au harnais. */
  function dump(h: { dir: string }, route: string, variante: keyof Variante): string[] {
    // Le titre de barre du haut est le PREMIER libellé du dump réel ; la barre
    // d'onglets vient ensuite, et elle est ce qui rend le titre d'onglet NON
    // discriminant — donc ce qu'un faux vert utiliserait.
    const labels = [TOP_BARS.get(route)!, ...barreOnglets(route), ...VARIANTES[route]![variante]];
    ecran(h, labels);
    return labels;
  }

  for (const route of ROUTES) {
    test(`${route} : prouvée dans les DEUX états (donnée et aucune donnée)`, () => {
      expect(VARIANTES[route]).toBeDefined();
      for (const variante of ["plein", "vide"] as const) {
        // Un harnais par passage : pas d'état partagé entre les deux états.
        const h = harness();
        const labels = dump(h, route, variante);
        const r = h.run([route, "--wait", "0"]);
        // On lit la SORTIE, pas le code seul : une route sans fragment réussit
        // sur le titre, donc `code === 0` ne prouverait rien.
        const reussite = r.out.includes("route vérifiée");
        // …et on vérifie que le critère ci-dessus COLLE au script.
        expect({ route, variante, script: reussite, critere: verifie(route, labels) }).toEqual({
          route,
          variante,
          script: reussite,
          critere: true,
        });
        expect(r.code).toBe(0);
        expect(r.out).toContain(`route vérifiée (« ${TOP_BARS.get(route)} »`);
      }
    });
  }

  test("chaque état listé EXISTE littéralement dans l'écran de sa route", () => {
    // La table ci-dessus doit rester collée aux écrans : un libellé renommé fait
    // échouer ce test AVANT qu'une capture ne parte sur un device.
    for (const route of ROUTES) {
      for (const variante of ["plein", "vide"] as const) {
        for (const label of VARIANTES[route]![variante]) {
          expect({ route, variante, label, present: UI_ENTIER.includes(label) }).toEqual({
            route,
            variante,
            label,
            present: true,
          });
        }
      }
    }
  });

  test("le témoin de l'onglet Notes se lit sans note publiée", () => {
    // Le défaut exact de #166, isolé : hors ligne l'écran est CORRECT et le
    // script échouait sur « Moyennes par matière », qui ne sort qu'avec la
    // donnée. La règle : un fragment par état, donc les trois états que l'écran
    // possède SANS donnée doivent tous se lire.
    const fragments = WITNESSES.get("grades")?.fragments ?? [];
    expect({
      cacheVide: fragments.includes("Aucune note en cache"),
      aucuneNotePubliee: fragments.includes("Aucune note sur cette période"),
      rechercheSansResultat: fragments.includes("Aucune note trouvée"),
      // Et le libellé de donnée reste, pour l'état plein.
      avecDonnees: fragments.includes("Moyennes par matière"),
    }).toEqual({
      cacheVide: true,
      aucuneNotePubliee: true,
      rechercheSansResultat: true,
      avecDonnees: true,
    });
  });

  test("aucun témoin n'est un libellé partagé par plusieurs écrans", () => {
    // « Réessayer », « Actualiser », « Chargement… », « Données hors-ligne
    // (périmé). », « Simuler erreur » sont rendus par plusieurs écrans : en
    // témoin, ils prouvent que l'app tourne, pas QUELLE page on regarde — et la
    // barre d'onglets fournit le titre de TOUTES les routes d'onglet, donc le
    // faux vert est à portée. « Réessayer » est celui qui a été envisagé pour
    // l'état d'erreur de l'onglet Notes.
    const generiques = [
      "Réessayer",
      "Actualiser",
      "Chargement…",
      "Données hors-ligne (périmé).",
      "Simuler erreur",
    ];
    for (const route of ROUTES) {
      for (const fragment of WITNESSES.get(route)?.fragments ?? []) {
        expect({ route, fragment, generique: generiques.includes(fragment) }).toEqual({
          route,
          fragment,
          generique: false,
        });
      }
    }
  });

  test("le témoin PROPRE à une route ne prouve AUCUNE autre route", () => {
    // La preuve du caractère distinctif : le dump de chaque route est passé
    // contre le critère de chaque AUTRE route, et il doit échouer partout. Un
    // témoin générique (« Réessayer ») ferait passer ce test par accident.
    const dumps = new Map<string, string[]>(
      ROUTES.map((route) => [
        route,
        [TOP_BARS.get(route)!, ...barreOnglets(route), ...VARIANTES[route]!.plein],
      ]),
    );
    const fauxVerts: string[] = [];
    for (const [source, labels] of dumps) {
      for (const route of ROUTES) {
        if (route !== source && verifie(route, labels)) fauxVerts.push(`${source} -> ${route}`);
      }
    }
    expect(fauxVerts).toEqual([]);
    // Le cas historique : le témoin de l'onglet Notes ne doit PAS être
    // « Réessayer », sinon les sept écrans en état d'échec y passeraient.
    expect(WITNESSES.get("grades")?.fragments ?? []).not.toContain("Réessayer");
  });

  test("« Réessayer » comme témoin de l'onglet Notes : le faux vert, rejoué", () => {
    // Le couple le plus dangereux, rejoué dans le VRAI script (et pas seulement
    // par le critère ci-dessus) : hors ligne, sept écrans affichent « Réessayer »
    // et la barre d'onglets affiche déjà « Notes » partout. Avec ce témoin, une
    // dérive de navigation vers l'un d'eux passerait en vert.
    const h = harness();
    // Exactement les libellés d'un écran Actualités HORS-LIGNE (NewsScreen.kt).
    ecran(h, ["Actualités", ...ONGLETS, "Erreur réseau. Réessayer.", "Réessayer"]);
    const r = h.run(["grades", "--wait", "0"]);
    expect(r.code).toBe(1);
    expect(r.out).not.toContain("route vérifiée");
    // Le même écran, VOULU pour `news` : son propre témoin reste valable, donc
    // le contrôle ne rejette pas tout — il rejette la mauvaise route.
    const r2 = h.run(["news", "--wait", "0"]);
    expect(r2.code).toBe(0);
    expect(r2.out).toContain("route vérifiée (« Actualités »).");
  });

  test("titre présent + aucun fragment : l'échec nomme l'état SANS DONNÉE", () => {
    // Le message de #160 disait « l'écran est peut-être CORRECT » ; #166 ajoute
    // la cause la plus fréquente : un écran sans donnée n'affiche pas le libellé
    // qui en dépend.
    const h = harness();
    ecran(h, ["Notes", ...ONGLETS, "Hors-ligne, aucune donnée en cache.", "Réessayer"]);
    const r = h.run(["grades", "--wait", "0"]);
    expect(r.code).toBe(1);
    expect(r.out).toContain("Titre attendu « Notes » : présent.");
    expect(r.out).toContain("Fragment(s) attendu(s)");
    expect(r.out).toContain("l'écran est sans DONNÉE");
    expect(r.out).toContain("ROUTE_WITNESSES");
    expect(r.out).not.toContain("N'EST PAS atteinte");
  });
});
