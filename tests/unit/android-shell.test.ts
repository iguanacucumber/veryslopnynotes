// Coquille applicative #135 (AppShell.kt + AppIcons.kt + AppNav.kt).
//
// Miroir TS des garde-fous du shell : sans téléphone ni adb, ces tests prouvent
// ce que `make shot` vérifie à l'œil. Ils visent les critères d'acceptation de
// #135, pas l'esthétique :
//   - une barre du haut PAR ROUTE, avec flèche de retour partout où l'on peut
//     revenir, et le titre de la route dans le titre ;
//   - plus aucun glyphe Unicode comme icône d'onglet, et des icônes
//     MONOCHROMES : les quatre glyphes de la barre sont ceux de Papillon
//     (`PapillonIcons.kt`, des `ImageVector` écrits à la main), le cinquième
//     reste pris dans `material-icons-core` — donc toujours zéro dépendance
//     ajoutée (le garde-fou qui fige le build.gradle.kts est ailleurs) ;
//   - barre d'onglets masquée sur l'assistant d'appairage et les réglages ;
//   - plus aucun `Text("<nom d'écran>")` dans le corps d'un écran (le nom ne
//     doit pas être lu deux fois) ;
//   - plus aucun `nav.navigate(...)` nu (revenir arrière dupliquait l'écran).
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");
const UI = join(ROOT, "android/ui/src/main/java/fr/veryslopnynotes/ui");
const read = (f: string) => readFileSync(join(UI, f), "utf8");
const shell = read("AppShell.kt");
const icons = read("AppIcons.kt");
const papillonIcons = read("PapillonIcons.kt");
const nav = read("AppNav.kt");
const uiFiles = readdirSync(UI).filter((f) => f.endsWith(".kt"));
/** Sans les commentaires : une garde qui lit le texte du fichier doit éviter de
 *  confondre un `//` qui NOMME une mauvaise pratique avec la pratique. */
const codeOnly = (src: string): string =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "\n")
    .split("\n")
    .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*"))
    .join("\n");
/** `ROUTE_CALENDAR` -> `calendar` : la table de la coquille écrit les constantes. */
const constName = (route: string) => `ROUTE_${route.toUpperCase()}`;

const TABS = ["index", "calendar", "tasks", "grades", "profile"];
const SECONDARY = ["news", "canteen", "attendance", "sanctions", "messages", "alerts", "fiches", "competences"];
const TITLES: Record<string, string> = {
  index: "Accueil",
  calendar: "EDT",
  tasks: "Tâches",
  grades: "Notes",
  profile: "Profil",
  news: "Actualités",
  canteen: "Cantine",
  attendance: "Vie scolaire",
  sanctions: "Sanctions",
  messages: "Messages",
  alerts: "Alertes sécurité",
  fiches: "Fiches révision",
  competences: "Compétences",
  settings: "Réglages",
  pairing: "Appairage",
};

describe("coquille applicative (#135)", () => {
  test("barre du haut : un titre PAR ROUTE, flèche de retour sur les secondaires", () => {
    for (const [route, title] of Object.entries(TITLES)) {
      // La table porte la constante + le titre, donc pas de titre épars ailleurs.
      const entry = new RegExp(`${constName(route)}\\s+to TopBar\\("${title}"`);
      expect({ route, title, inTable: entry.test(shell) }).toEqual({ route, title, inTable: true });
    }
    // Flèche de retour : partout où l'on peut revenir, nulle part à la racine.
    for (const route of SECONDARY) {
      const line = shell.split("\n").find((l) => l.includes(`${constName(route)} to TopBar(`)) ?? "";
      expect({ route, hasBack: line.includes("back = ROUTE_") }).toEqual({ route, hasBack: true });
    }
    for (const route of [...TABS, "pairing"]) {
      const line = shell.split("\n").find((l) => l.includes(`${constName(route)} to TopBar(`)) ?? "";
      expect({ route, noBack: !line.includes("back =") }).toEqual({ route, noBack: true });
    }
    // Le titre est la typo de #134 (18 sp gras), pas le 14 sp par défaut, et la
    // barre se rétracte au défilement.
    expect(shell).toContain("style = MaterialTheme.typography.titleLarge");
    expect(shell).toContain("TopAppBarDefaults.enterAlwaysScrollBehavior()");
    // Le retour passe par `popBackStack` d'abord (d'où l'on vient), sinon vers
    // la route mère : sans cela, un deep link direct = cul-de-sac.
    expect(nav).toMatch(/if \(!nav\.popBackStack\(\)\) nav\.navigateTo\(back\)/);
    // Contenu serveur affiché comme donnée : aucun HTML interprété dans la coquille.
    for (const bad of ["WebView", "fromHtml", "loadData"]) {
      expect({ bad, found: shell.includes(bad) || nav.includes(bad) }).toEqual({ bad, found: false });
    }
  });

  test("icônes : les glyphes de Papillon, monochromes, plus aucun glyphe Unicode", () => {
    // `material-icons-core` (déjà dans le graphe via material3) : pas
    // d'extended, pas de bibliothèque ajoutée — même après le passage aux
    // glyphes de Papillon, qui sont des `ImageVector` écrits à la main.
    expect(icons).toContain("androidx.compose.material.icons.Icons");
    expect(icons).toContain("Icons.Filled.Person");
    expect(codeOnly(icons)).not.toContain("material-icons-extended");
    // Les 5 onglets, dans l'ordre de Papillon : Accueil, EDT, Tâches, Notes, Profil.
    const order = shell.match(/private val TAB_ROUTES = listOf\(([^)]*)\)/)?.[1] ?? "";
    expect(order.split(",").map((r) => r.replace("ROUTE_", "").trim().toLowerCase())).toEqual(TABS);
    // Nom annoncé = MÊME fonction que le libellé affiché, donc rien à diverger.
    // #146 : c'est le `label` de l'item qui le porte, et l'icône est décorative
    // (`contentDescription = null`) — la décrire en plus faisait annoncer
    // « Accueil … Accueil », `NavigationBarItem` ne fusionnant pas les deux nœuds.
    expect(shell).toContain("label = { Text(tabLabel(tab)) }");
    expect(shell).toContain("contentDescription = null,");
    expect(shell).not.toContain("contentDescription = tabLabel(tab)");
    // Zéro glyphe comme icône : plus aucun des glyphes d'origine, ni dans la
    // coquille ni dans les icônes.
    const shellCode = codeOnly(shell) + codeOnly(icons);
    for (const glyph of ["⌂", "📅", "★", "✓", "👤"]) {
      // Les commentaires, eux, les CITENT pour dire qu'ils ont disparu.
      expect({ glyph, found: shellCode.includes(glyph) }).toEqual({ glyph, found: false });
    }
    // Pas d'autre icône textuelle : un `Text` ne sert plus d'icône d'onglet.
    expect(shell).not.toMatch(/icon = \{ Text\(/);
  });

  // Les quatre glyphes de la barre sont RELEVÉS sur Papillon : l'étoile de
  // « Notes » et le calendrier de l'EDT se lisaient comme des choix Material, pas
  // comme ceux de l'app de référence. On ne peut pas re-mesurer la fidélité au
  // masque ici (l'APK de référence n'est pas dans le dépôt), donc ce test fixe ce
  // qui est vérifiable : un `ImageVector` monochrome par onglet, en 24, avec un
  // `path` unique `EvenOdd` — et AUCUNE icône Material revenue en doublon.
  test("glyphes d'onglets : quatre `ImageVector` tracés, un par route Papillon", () => {
    const glyphe = (nom: string): string => {
      const m = papillonIcons.match(new RegExp(`val ${nom}: ImageVector by lazy \\{[\\s\\S]*?\\n\\}`));
      expect({ nom, trouve: m !== null }).toEqual({ nom, trouve: true });
      return m![0]!;
    };
    for (const [nom, route] of [
      ["PapillonTabAccueil", "ROUTE_INDEX"],
      ["PapillonTabCours", "ROUTE_CALENDAR"],
      ["PapillonTabTaches", "ROUTE_TASKS"],
      ["PapillonTabNotes", "ROUTE_GRADES"],
    ] as const) {
      const src = glyphe(nom);
      // L'onglet est câblé à CE glyphe, pas à un `Icons.Filled.*` : c'est tout
      // l'objet du changement.
      expect(icons).toContain(`${route} -> ${nom}`);
      // Un `path` par icône : deux chemins pour le trou auraient été lisibles
      // comme deux glyphes superposés.
      expect((src.match(/glyphePapillon\(/g) ?? []).length).toBe(1);
      // Le tracé est LONG : une icône dessinée en quatre points serait un
      // losange, pas une maison. On fige un plateau bas, pas la longueur exacte —
      // un tracé plus fin reste correct.
      const points = (src.match(/[ML]\d/g) ?? []).length;
      expect({ nom, points: points >= 40 }).toEqual({ nom, points: true });
    }
    // Le constructeur COMMUN : grille 24, `EvenOdd` (le trou — arche, coche,
    // quartier de camembert — est un sous-trac de sens opposé, donc il se perce
    // sans second chemin), `fill` noir que l'`Icon` teinte par-dessus.
    expect(papillonIcons).toContain("pathFillType = PathFillType.EvenOdd");
    expect(papillonIcons).toContain("PathParser().parsePathString(d).toNodes()");
    expect(papillonIcons).toContain("defaultWidth = GRILLE.dp");
    expect(papillonIcons).toContain("viewportWidth = GRILLE.toFloat()");
    expect(papillonIcons).toContain("fill = SolidColor(Color.Black)");
    expect(papillonIcons).toContain("private const val GRILLE = 24");
    // Les quatre `path` sont des DONNÉES de tracé, pas des images : ni bitmap,
    // ni police, ni ressource ajoutée (le dossier `res/drawable` reste vide).
    expect(codeOnly(papillonIcons)).not.toMatch(/\.(png|webp|xml|ttf|otf)\b/);
    // L'ECART ÉCRIT : le 5e onglet garde `Person` du CORE, parce que Papillon n'a
    // pas de 5e onglet. Un écart non écrit serait un onglet à corriger.
    expect(icons).toContain("ROUTE_PROFILE -> Icons.Filled.Person");
    expect(icons).toMatch(/\/\/ ÉCART ÉCRIT[\s\S]*?ROUTE_PROFILE -> Icons\.Filled\.Person/);
  });

  test("barre d'onglets : masquée sur l'appairage et les réglages, slot de badge présent", () => {
    expect(shell).toMatch(/route != null && route != ROUTE_PAIRING && route != ROUTE_SETTINGS/);
    // Le slot de pastille existe ET est câblé (material3 1.2.1 n'a pas encore
    // le paramètre `badge` : la pastille passe par `BadgedBox`) — vide, donc
    // aucune pastille n'affiche un compteur qu'aucun état ne calcule.
    expect(shell).toContain("TabIconWithBadge(tab)");
    expect(shell).toMatch(/if \(badge == null\) icon\(\) else BadgedBox\(badge = badge\) \{ icon\(\) \}/);
    expect(shell).toMatch(/private fun tabBadge\(route: String\): \(@Composable BoxScope\.\(\) -> Unit\)\? = null/);
    // Une seule entrée par route dans la table (pas de doublon de titre).
    for (const route of Object.keys(TITLES)) {
      const entries = shell.split("\n").filter((l) => l.trim().startsWith(`${constName(route)} to TopBar(`));
      expect({ route, entries: entries.length }).toEqual({ route, entries: 1 });
    }
  });

  test("AppNav.kt : le graphe seul, plus aucun écran dedans", () => {
    // Critère d'acceptation de #135 : sous ~450 lignes (989 avant). On lit le
    // compte plutôt qu'un nombre figé : le plafond est ce qui compte, pas sa
    // valeur exacte (989 avant #135).
    const lines = nav.trimEnd().split("\n").length;
    expect({ lines, under450: lines <= 450 }).toEqual({ lines, under450: true });
    // Aucune route n'est un littéral nu : 15 constantes, toutes utilisées.
    const routes = [...nav.matchAll(/const val (ROUTE_[A-Z]+) = "([a-z]+)"/g)].map((m) => [m[1]!, m[2]!]);
    expect(routes).toHaveLength(15);
    for (const [constName, value] of routes) {
      expect({ constName, used: new RegExp(`composable\\(${constName}`).test(nav) }).toEqual({ constName, used: true });
      expect({ value, used: nav.includes(`routeDeepLink(${constName})`) }).toEqual({ value, used: true });
    }
    // Les 4 routes qui étaient en littéral nu ont bien leur constante.
    for (const r of ["ROUTE_ALERTS", "ROUTE_FICHES", "ROUTE_COMPETENCES", "ROUTE_SANCTIONS"]) {
      expect({ r, declared: nav.includes(`const val ${r} = `) }).toEqual({ r, declared: true });
    }
    // Navigation : chaque `navigate(` du graphe porte `launchSingleTop`, sinon
    // revenir en arrière empile un DOUBLON d'écran au lieu de sortir. Un seul
    // `navigate(` survit hors helpers : le retour à l'appairage après un 401
    // (#113), qui vide toute la pile — il a donc besoin de `popUpTo`, pas
    // seulement de `launchSingleTop`.
    const navCode = codeOnly(nav);
    const calls = [...navCode.matchAll(/nav\.navigate\(/g)];
    for (const c of calls) {
      const block = navCode.slice(c.index, c.index + 240);
      expect({ hasLaunchSingleTop: block.includes("launchSingleTop = true") }).toEqual({ hasLaunchSingleTop: true });
    }
    expect({ navigationsViaHelpers: navCode.split("nav.navigateTo(").length - 1 >= 12 }).toEqual({
      navigationsViaHelpers: true,
    });
    // #162 : les destinations que les corps d'écran ouvraient en clair sont
    // DÉCLARÉES une fois (`TOP_BAR_ACTIONS` d'`AppShell.kt`), donc leurs
    // `nav.navigateTo` ne sont plus dans le graphe — ce que ce compte protège,
    // c'est que la navigation continue de passer par le helper : chaque route
    // de destination est une constante `ROUTE_*`, jamais un littéral.
    expect({ literals: [...navCode.matchAll(/nav\.navigateTo\("([^"]+)"/g)].map((m) => m[1]) }).toEqual({ literals: [] });
    expect(nav).toMatch(/private fun NavHostController\.navigateTo\(route: String\) \{\n {4}navigate\(route\) \{ launchSingleTop = true \}\n\}/);
    expect(nav).toContain("launchSingleTop = true");
    // Deep link #133 : chaque route garde son URL ouvrable.
    expect(nav).toContain('navDeepLink { uriPattern = "veryslopnynotes://$route" }');
  });

  test("titres d'écrans : plus aucun nom d'écran dupliqué dans un corps d'écran", () => {
    // Le nom de l'écran est dans la barre du haut, donc plus un seul `Text`
    // qui le répète : un `Text("<titre de route>")` dans le module UI, hormis
    // les boutons de navigation (qui sont des actions, pas des titres).
    for (const file of uiFiles) {
      const src = read(file).split("\n").filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*"));
      for (const title of ["Accueil", "Profil", "Réglages", "Notes", "Tâches", "Actualités", "Messages", "Alertes sécurité", "Vie scolaire", "Sanctions", "Compétences", "Fiches révision", "Cantine", "EDT semaine", "Devoirs de la semaine"]) {
        const titles = src.filter((l) => new RegExp(`Text\\("${title}"\\)$`).test(l.trim()));
        expect({ file, title, occurrences: titles.length }).toEqual({ file, title, occurrences: 0 });
      }
    }
  });

  test("écrans sortis d'AppNav.kt : un fichier par écran, pour que #136-#146 ne se marchent pas dessus", () => {
    for (const f of ["AppIcons.kt", "AppShell.kt", "IndexScreen.kt", "ProfileScreen.kt", "SettingsScreen.kt", "GradesScreen.kt"]) {
      expect({ f, exists: existsSync(join(UI, f)) }).toEqual({ f, exists: true });
    }
    // Chaque fichier annonce l'issue qui possède sa refonte.
    const owners: Record<string, string> = {
      "IndexScreen.kt": "143",
      "ProfileScreen.kt": "140",
      "SettingsScreen.kt": "140",
      "GradesScreen.kt": "139",
    };
    for (const [f, issue] of Object.entries(owners)) {
      expect({ f, owner: read(f).includes(`#${issue}`) }).toEqual({ f, owner: true });
    }
    // Et aucun de ces écrans ne vit plus dans AppNav.kt.
    for (const needle of ["fun IndexScreen(", "fun ProfileScreen(", "fun ProfileRoute(", "fun SettingsScreen(", "fun CachedResourceScreen("]) {
      expect({ needle, onlyInOwnFile: !nav.includes(needle) }).toEqual({ needle, onlyInOwnFile: true });
    }
    // #134 livrait l'échelle de typo, aucun écran ne l'utilisait : les titres de
    // section restants passent maintenant par `MaterialTheme.typography`.
    // #140 : le profil et les réglages délèguent leur titre de section à
    // `PapSectionHeader` (la brique #136, qui pose `titleMedium`) au lieu de le
    // styler eux-mêmes — donc ces deux fichiers comptent s'ils l'utilisent.
    for (const f of ["IndexScreen.kt", "ProfileScreen.kt", "SettingsScreen.kt", "GradesScreen.kt", "TimetableWeek.kt", "Assignments.kt", "CanteenMenus.kt", "MessagesScreen.kt"]) {
      const src = read(f);
      const titled = src.includes("MaterialTheme.typography.titleMedium") || src.includes("PapSectionHeader(");
      expect({ f, titled }).toEqual({ f, titled: true });
    }
  });

  test("Profil : plus de bouton en triple, et « Se déconnecter » atteignable", () => {
    const profile = read("ProfileScreen.kt");
    // #87 avait ajouté les entrées conditionnelles PAR-DESSUS trois lignes
    // d'origine restées : chaque entrée apparaissait trois fois.
    // #140 : ce sont des LIGNES (`PapListItem(title = …)`) et non des boutons
    // pleine largeur — le libellé apparaît donc une fois, dans le libellé de la
    // ligne, et plus dans `{ Text("…") }`.
    for (const label of ["Actualités", "Cantine semaine", "Vie scolaire"]) {
      const n = profile.split(`title = "${label}"`).length - 1;
      expect({ label, occurrences: n }).toEqual({ label, occurrences: 1 });
    }
    // `Button(` avec la parenthèse collée et SANS lettre devant, donc hors
    // `IconButton` : le chevron « Changer de compte » (cible de 48 dp depuis
    // #146) n'est pas le bouton en triple que #135 a interdit ici.
    expect(profile.split(/(?<![A-Za-z])Button\(onClick/).length - 1).toBe(0);
    // Deux racines dans un slot du NavHost = débordement sans défilement : une
    // seule racine, défilable, et l'action la plus grave reste atteignable.
    expect(profile).toMatch(/fun ProfileRoute\([\s\S]*Modifier\.fillMaxSize\(\)\.verticalScroll\(rememberScrollState\(\)\)\)\s*\{/);
    expect(profile).toContain('title = "Se déconnecter"');
    // #140 : la déconnexion détruit la session, donc elle est CONFIRMÉE.
    expect(profile).toContain("ConfirmDialog(");
    expect(profile).toContain("destructive = true");
  });

  test("fenêtre sans barre d'action : pas de marque statique au-dessus de la barre du haut", () => {
    // #135 : sans thème de fenêtre, la plateforme pose une barre d'action
    // (`android:id/action_bar` dans le dump uiautomator) qui affiche le LABEL de
    // l'app — « VerySlopyNyNotes » sur les 15 routes, la marque statique que
    // cette issue retire de l'interface, plus 56 dp de hauteur perdue.
    const manifest = readFileSync(join(ROOT, "android/app/src/main/AndroidManifest.xml"), "utf8");
    expect(manifest).toContain('android:theme="@style/Theme.Veryslopynotes"');
    for (const variant of ["values", "values-night"]) {
      const file = join(ROOT, `android/app/src/main/res/${variant}/themes.xml`);
      expect({ file, exists: existsSync(file) }).toEqual({ file, exists: true });
      expect({ file, noActionBar: readFileSync(file, "utf8").includes("NoActionBar") }).toEqual({ file, noActionBar: true });
    }
    // Le label reste le label : c'est l'icône de l'app sous leLauncher.
    expect(manifest).toContain('android:label="VerySlopyNyNotes"');
  });

  test("zéro dépendance ajoutée : les icônes viennent du graphe, pas d'une ligne", () => {
    const gradle = readFileSync(join(ROOT, "android/ui/build.gradle.kts"), "utf8");
    expect(gradle).not.toContain("material-icons");
    expect(gradle).toContain('compose-bom:2024.06.00');
    expect(gradle).toContain('material3:1.2.1');
    expect(gradle).toContain('kotlinCompilerExtensionVersion = "1.5.14"');
    expect(gradle).toContain("minSdk = 26");
  });
});