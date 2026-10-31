import { describe, expect, test } from "bun:test";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Deux listes doivent rester d'accord : WEB_ROUTES et les hôtes du manifest DEBUG.
const ROOT = join(import.meta.dir, "..", "..");
const WEB_ROUTE_STATE = readFileSync(
  join(ROOT, "android/app/src/main/java/fr/veryslopnynotes/app/WebRouteState.kt"),
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
const SHOT = readFileSync(join(ROOT, "agents/runtime/shot.sh"), "utf8");

/** Routes hash de `WEB_ROUTES`, ramenées à l'hôte du deep link. */
const ROUTES = [.../val WEB_ROUTES: Set<String> = setOf\(([\s\S]*?)\)/.exec(WEB_ROUTE_STATE)![1]!.matchAll(/"([^"]+)"/g)]
  .map((m) => m[1]!)
  .map((route) => (route === "/" ? "index" : route.replace(/^\//, "")));

/** Table `ROUTE_WITNESSES` de shot.sh : `route|titre|fragments` séparés par `;`. */
const WITNESSES = new Map<string, { title: string; fragments: string[] }>(
  (SHOT.match(/ROUTE_WITNESSES='\n([\s\S]*?)\n'/)![1]!)
    .split("\n")
    .map((line) => {
      const [route = "", title = "", rest = ""] = line.split("|");
      return [route, { title, fragments: rest ? rest.split(";") : [] }] as const;
    }),
);

describe("deep links de debug (#133)", () => {
  test("chaque route WEB est un hôte du manifest DEBUG (sinon am start échoue)", () => {
    expect(ROUTES.length).toBeGreaterThanOrEqual(16);
    for (const route of ROUTES) {
      expect(DEBUG_MANIFEST).toContain(`<data android:host="${route}" />`);
    }
    // Un hôte de trop ouvre une route inexistante : seule la page de départ s'affiche.
    const hosts = [...DEBUG_MANIFEST.matchAll(/android:host="([a-z-]+)"/g)].map(m => m[1]!);
    expect(hosts.sort()).toEqual([...ROUTES].sort());
  });

  test("le manifest DEBUG force singleTask et déclare VIEW/BROWSABLE", () => {
    // standard + URL = deux écrans superposés : la capture montre l'ancien.
    expect(DEBUG_MANIFEST).toContain('android:launchMode="singleTask"');
    expect(DEBUG_MANIFEST).toContain('android:scheme="veryslopnynotes"');
    expect(DEBUG_MANIFEST).toContain("android.intent.action.VIEW");
    expect(DEBUG_MANIFEST).toContain("android.intent.category.BROWSABLE");
  });

  test("le manifeste MAIN (donc la release) n'a AUCUN deep link", () => {
    // L'APK publiable ne répond à aucune URL extérieure.
    expect(MAIN_MANIFEST).not.toContain("android.intent.action.VIEW");
    expect(MAIN_MANIFEST).not.toContain("veryslopnynotes://");
    expect(MAIN_MANIFEST).not.toContain('android:launchMode="singleTask"');
    expect(MAIN_MANIFEST).toContain("android.intent.category.LAUNCHER");
    expect((MAIN_MANIFEST.match(/<intent-filter>/g) ?? []).length).toBe(1);
  });

  test("chaque route déclarée a un témoin, et la table ne connaît que ces routes", () => {
    // `route_known` est aussi une liste blanche : refus avant toute écriture.
    const sansTemoin = ROUTES.filter(r => !WITNESSES.get(r)?.title);
    expect(sansTemoin).toEqual([]);
    expect([...WITNESSES.keys()].sort()).toEqual([...ROUTES].sort());
    const lignes = SHOT.match(/ROUTE_WITNESSES='\n([\s\S]*?)\n'/)?.[1]!.split("\n") ?? [];
    expect(lignes).toHaveLength(ROUTES.length);
  });
});

describe("shot.sh (#133)", () => {
  test("lance par deep link, force-stop d'abord, et échoue bruyamment", () => {
    expect(SHOT).toContain("set -euo pipefail");
    // Sans force-stop, onNewIntent est ignoré : la capture montre l'écran précédent.
    expect(SHOT).toContain("am force-stop");
    expect(SHOT).toContain('"$SCHEME://$ROUTE"');
    for (const refusal of [
      "aucun appareil prêt", // pas d'appareil
      "route inconnue", // route fantôme
      "capture NOIRE", // écran éteint
      "VERROUILLÉ", // code d'appareil
      "APPAIRAGE", // session absente
      "NON PROUVÉE", // témoin périmé
      "instal", // refus d'installation
    ]) {
      expect({ refus: refusal, present: SHOT.includes(refusal) }).toEqual({
        refus: refusal,
        present: true,
      });
    }
  });

  test("détecte l'image noire et réveille l'écran avant de conclure", () => {
    // ImageMagick lit le PNG, puis ffmpeg, puis bun/node sur le tampon brut.
    // Aucun outil = capture refusée.
    const corps = SHOT.slice(SHOT.indexOf("blank_verdict()"));
    expect(corps.indexOf("command -v identify")).toBeLessThan(corps.indexOf("command -v ffmpeg"));
    expect(corps.indexOf("command -v ffmpeg")).toBeLessThan(corps.indexOf("for rt in bun node"));
    expect(corps).toContain("die ");
    // Éteint = réveil + UNE nouvelle tentative, jamais une capture acceptée.
    expect(corps).toContain("KEYCODE_WAKEUP");
    expect(SHOT).toContain("svc power stayon true");
  });

  test("ne désinstalle jamais l'app (la session appairée vaut un QR)", () => {
    // Une désinstallation effacerait la session appairée (QR à rescaner).
    expect(SHOT).not.toMatch(/^\s*(adb|a)\s+(shell\s+)?pm\s+(uninstall|clear)/m);
    expect(SHOT).not.toMatch(/^\s*(adb|a)\s+uninstall/m);
  });

  test("les captures et les frames de référence ne sont jamais commitées", () => {
    const gitignore = readFileSync(join(ROOT, ".gitignore"), "utf8");
    // L'écran d'accueil affiche le vrai nom, l'établissement, les notes.
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

// Fixture : le VRAI shot.sh recopié, avec un faux gradlew et un faux adb.

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
# \`installed-sha\` = sha que l'appareil croit avoir ; bascules NO_SHA, REFUSAL, UI_DUMP_FAIL.
set -u
H="\${HARNESS:?}"
printf '%s\\n' "adb $*" >> "$H/adb.log"
while [ $# -gt 0 ]; do
  case "$1" in -s) shift 2 ;; *) break ;; esac
done
cmd="\${1:-}"
shift 2>/dev/null || true
frame() {
  # Sans ImageMagick, blank_verdict lit le tampon brut (256 octets).
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
    uiautomator)
      # Dump illisible = capture non vérifiable.
      [ "\${UI_DUMP_FAIL:-0}" = 1 ] && { printf 'ERROR: could not get idle state.\\n' >&2; exit 1; }
      printf 'UI hierchary dumped to: %s\\n' "\${2:-/sdcard/ui.xml}" ;;
    # Un refus (THEME_REFUSAL=1) doit faire échouer la capture.
    cmd)
      [ "\${2:-}" = uimode ] || return 0
      [ "\${THEME_REFUSAL:-0}" = 1 ] && { printf 'cmd: Permission denied\\n' >&2; exit 1; }
      printf '%s\\n' "$*" >> "$HARNESS/uimode.log" ;;
    cat)
      # Un fichier \`texts\` remplace le dump ligne par ligne.
      if [ -f "$H/texts" ]; then
        while IFS= read -r t; do printf '<node text="%s"/>' "$t"; done < "$H/texts"
        printf '\\n'
      else
        printf '<node text="Accueil"/><node text="DEVOIRS"/>\\n'
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
  /** Source plus récente que l'APK : l'état « périmé ». */
  touchSource: () => void;
  installedSha: () => string;
  captured: () => Buffer;
} {
  const dir = mkdtempSync(join(tmpdir(), "shot-151-"));
  mkdirSync(join(dir, "agents/runtime"), { recursive: true });
  mkdirSync(join(dir, "bin"), { recursive: true });
  const apkDir = join(dir, "android/app/build/outputs/apk/debug");
  mkdirSync(apkDir, { recursive: true });
  const src = join(dir, "web/src/App.tsx");
  mkdirSync(join(src, ".."), { recursive: true });
  writeFileSync(src, "export default function App() { return null; }\n");
  // Le VRAI script recopié, jamais une réécriture : le test porte sur lui.
  copyFileSync(SHOT_SH, join(dir, "agents/runtime/shot.sh"));
  copyFileSync(ENV_SH, join(dir, "agents/runtime/android-env.sh"));
  writeFileSync(join(dir, "capture.png"), Buffer.from(PNG_3_COLORS, "base64"));
  writeFileSync(join(dir, "apk-content"), "APK v1\n");
  copyFileSync(join(dir, "apk-content"), join(apkDir, "app-debug.apk"));
  writeFileSync(join(dir, "bin/adb"), FAKE_ADB);
  chmodSync(join(dir, "bin/adb"), 0o755);
  // `sleep` factice : seul l'EXÉCUTANT change, le script recopié reste intact.
  writeFileSync(join(dir, "bin/sleep"), "#!/bin/sh\nexit 0\n");
  chmodSync(join(dir, "bin/sleep"), 0o755);
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
  test("refuse l'ancien mode --package avant adb ou Gradle", () => {
    const h = harness();
    const r = h.run(["--package", "com.example.reference", "index"]);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain("option inconnue : --package");
    expect(r.gradle).toBe(0);
    expect(r.installs).toEqual([]);
    expect(existsSync(join(h.dir, "adb.log"))).toBe(false);
    expect(existsSync(join(h.dir, "shots"))).toBe(false);
  });

  test("premier passage : Gradle construit, l'APK est installé, la capture est vérifiée", () => {
    const h = harness();
    const r = h.run(["index", "--wait", "0"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("shot : construction de l'APK debug");
    // Aucun APK installé : on installe, puis on relit l'empreinte sur l'appareil.
    expect(r.installs).toEqual([sha256("APK v1\n")]);
    expect(h.installedSha()).toBe(sha256("APK v1\n"));
    expect(r.out).toContain("shot : route vérifiée (« Accueil » + « DEVOIRS »).");
    // Le contenu exact dépend de la machine ; seul le verdict de blank_verdict compte.
    expect(h.captured().length).toBeGreaterThan(0);
  });

  test("rien n'a changé : construction vérifiée, MAIS installation évitée", () => {
    const h = harness();
    h.run(["index", "--wait", "0"]);
    const r = h.run(["index", "--wait", "0"]);
    // Gradle est toujours lancé : c'est lui qui dit si l'APK est périmé.
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
    // Le défaut : aucune reconstruction, et la capture montrait l'ancienne interface.
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

  test("--theme : la bascule passe par l'appareil, le thème entre dans le nom", () => {
    const h = harness();
    for (const theme of ["dark", "light", "system"]) {
      const r = h.run(["index", "--wait", "0", "--theme", theme]);
      expect(r.code).toBe(0);
      expect(r.out).toContain(`thème de l'appareil forcé sur « ${theme} »`);
      expect(readdirSync(join(h.dir, "shots", readdirSync(join(h.dir, "shots"))[0]!)))
        .toContain(`index.${theme}.png`);
    }
    // Le fond système change, pas les données de l'app (session, cache, thème).
    const nuit = readFileSync(join(h.dir, "uimode.log"), "utf8").trim().split("\n");
    expect(nuit).toEqual(["cmd uimode night yes", "cmd uimode night no", "cmd uimode night auto"]);
    // Sans --theme, AUCUNE bascule : le réglage du téléphone reste le sien.
    const r = h.run(["index", "--wait", "0"]);
    expect(r.code).toBe(0);
    expect(r.out).not.toContain("uimode");
    expect(r.out).not.toContain("forcé");
    // Valeur hors enum : refus AVANT toute capture, jamais un thème deviné.
    const refuse = h.run(["index", "--wait", "0", "--theme", "nuit"]);
    expect(refuse.code).toBe(1);
    expect(refuse.out).toContain("--theme hors valeur");
    expect(refuse.out).not.toContain("route vérifiée");
    // Appareil qui refuse la bascule : échec bruyant, pas le thème courant.
    const muet = h.run(["index", "--wait", "0", "--theme", "dark"], { THEME_REFUSAL: "1" });
    expect(muet.code).toBe(1);
    expect(muet.out).toContain("thème NON");
    expect(muet.out).toContain("forcé");
    expect(muet.out).not.toContain("route vérifiée");
  });

  test("installation refusée : on ne désinstalle jamais, la session appairée survit", () => {
    const h = harness();
    const r = h.run(["index", "--wait", "0"], { REFUSAL: "1" });
    expect(r.code).toBe(1);
    expect(r.out).toContain("installation refusée");
    expect(r.out).toContain("QR à rescaner");
    expect(r.out).not.toContain("route vérifiée");
  });

  test("arbre d'interface illisible : ÉCHEC bruyant, jamais de succès silencieux", () => {
    const h = harness();
    const r = h.run(["index", "--wait", "0"], { UI_DUMP_FAIL: "1" });
    expect(r.code).not.toBe(0);
    expect(r.out).toContain("ILLISIBLE");
    expect(r.out).toContain("NON VÉRIFIÉE");
    expect(r.out).not.toContain("route vérifiée");
    expect(r.out).not.toContain("AVERTISSEMENT");
    // La capture reste sur le disque, sans être présentée comme preuve de la route.
    expect(h.captured().length).toBeGreaterThan(0);
  });

  test("le script ne masque plus l'échec de lecture dans le source", () => {
    // Le défaut : `return 0` en fin de `screen_texts` et de `verify_route`.
    const corps = SHOT.slice(SHOT.indexOf("screen_texts()"));
    const lecture = corps.slice(0, corps.indexOf("\n}\n"));
    expect(lecture.trimEnd().split("\n").at(-1)!.trim()).toBe("return 1");
    // Après « illisible », `verify_route` sort en erreur avant tout `return 0`.
    const verify = corps.slice(corps.indexOf("verify_route()"));
    const apres = verify.slice(verify.toLowerCase().indexOf("illisible"));
    const sortie = apres.indexOf("exit 1");
    const retour = apres.indexOf("return 0");
    expect({ sortieAvantRetour: sortie >= 0 && (retour === -1 || sortie < retour) }).toEqual({
      sortieAvantRetour: true,
    });
  });

  test("pas de comparaison de mtimes : Gradle est l'autorité, l'empreinte la preuve", () => {
    // Défaut : `-newer "$APK"` annonçait « à jour » sur un APK périmé.
    // Un objet plutôt qu'un `not.toMatch` : sinon l'échec reprinted tout le script.
    expect({
      compareDesMtimes: /-newer\s+"?\$\{?APK/.test(SHOT),
      fonctionApkIsStale: SHOT.includes("apk_is_stale"),
    }).toEqual({ compareDesMtimes: false, fonctionApkIsStale: false });
    // L'état « périmé » est écrit dans le code ET dans son aide.
    expect({
      perime: SHOT.includes("périmé"),
      empreinte: SHOT.includes("sha256sum"),
      installR: SHOT.includes("install -r"),
      noBuild: SHOT.includes("--no-build"),
    }).toEqual({ perime: true, empreinte: true, installR: true, noBuild: true });
  });

  test("une route contenant un métacaractère est refusée comme route inconnue", () => {
    const h = harness();
    for (const route of [".*", "index|Accueil", "grades|tasks", "^index$"]) {
      const r = h.run([route, "--wait", "0"]);
      expect({ route, code: r.code }).toEqual({ route, code: 1 });
      expect(r.out).toContain("route inconnue");
      // Refus avant toute écriture : pas de shots/, pas de build, pas d'installation.
      expect(r.out).not.toContain("route vérifiée");
      expect(r.gradle).toBe(0);
      expect(r.installs).toEqual([]);
      expect(existsSync(join(h.dir, "shots"))).toBe(false);
    }
  });

  test("la route n'est plus interpolée dans une expression régulière", () => {
    // Forme du défaut : `grep -E "^$1[|]"` au lieu d'un champ comparé littéralement.
    expect(SHOT).not.toMatch(/grep\s+(-[a-zA-Z]+\s+)*-E[^\n]*\$\{?1/);
    expect(SHOT).not.toMatch(/grep\s+(-[a-zA-Z]+\s+)*-E[^\n]*\$\{?ROUTE/);
  });

  test("les routes RÉELLES passent toujours la liste blanche", () => {
    const h = harness();
    for (const route of ROUTES) {
      expect({ route, connu: WITNESSES.get(route)?.title }).toEqual({
        route,
        connu: expect.any(String),
      });
    }
    // L'écran factice ne porte que l'accueil : seul le refus de liste blanche est surveillé ici.
    const r = h.run(["grades", "--wait", "0"]);
    expect(r.out).not.toContain("route inconnue");
    expect(r.out).not.toContain("Rien capturé");
  });
});
