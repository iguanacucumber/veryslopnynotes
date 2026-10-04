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
const SHOT = readFileSync(join(ROOT, "agents/runtime/shot.sh"), "utf8");

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

describe("shot.sh (#133)", () => {
  test("chaque route a un marqueur d'écran, sinon la capture n'est pas prouvée", () => {
    // route_marker() sert aussi de liste blanche : une route sans marqueur est
    // refusée AVANT toute écriture, sinon shot.sh capturerait l'écran de
    // départ en annonçant une réussite.
    // `printf '…'` (littéral) ou `printf "$PROFILE_MARKER"` (marcateur commun).
    const sansMarqueur = ROUTES.filter(r => !new RegExp(`^\\s+${r}\\) printf ['"]`, "m").test(SHOT));
    expect(sansMarqueur).toEqual([]);
    expect(SHOT).toContain('printf \'\' ;;');
  });

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
      "N'EST PAS atteinte", // mauvais écran
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
    cat) printf '<hierarchy><node text="Derni\\xc3\\xa8res notes"/></hierarchy>\\n' ;;
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
    expect(r.out).toContain("shot : route vérifiée (Dernières notes).");
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