// GARDE-FOUS D'ACCESSIBILITÉ #146 — source Kotlin de `android/ui`.
//
// Ce que le téléphone vérifie mal et ce test vérifie bien : un lecteur d'écran
// n'est pas dans `bun test`. En revanche la STRUCTURE du rendu l'est : une icône
// sans `contentDescription`, une cible sous 48 dp, un texte serveur sans
// `maxLines`, un titre sans `heading()` se voient ici, à chaque `make check`,
// alors qu'une passe manuelle les laisserait passer.
//
// Les gardes sont volontairement STRUCTURELS (pas d'AST) : ils lisent le source
// comme le fait `agents/runtime/check-kotlin.ts`. Ce qu'ils ne voient pas : le
// rendu réel, l'ordre de lecture de TalkBack, la Résultat d'un `stateDescription`
// mal libellé. Upgrade: `testDebugUnitTest` Gradle + `ComposeTestRule`
// (`onNodeWithContentDescription`), qui Needs un appareil — donc pas ici.
//
// ponytail: pas de bibliothèque d'analyse Kotlin, et pas de second miroir TS de
// la logique : ce fichier ne DUPLIQUE aucune règle métier, il vérifie que les
// règles d'accessibilité sont là dans les fichiers qui portent l'écran.
import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const UI = join(import.meta.dir, "..", "..", "android/ui/src/main/java/fr/veryslopnynotes/ui");

/**
 * Source SANS les commentaires (ligne `//` et bloc `slash etoile`), chaînes et
 * lambdas conservés. Indispensable : la moitié de ce qu'on vérifie est des
 * IMPORTS, et un KDoc qui cite un glyphe de pastille ne doit pas faire échouer
 * le garde-fou sur une couleur disparue depuis dix ans.
 *
 * Kotlin IMBRIQUE les commentaires de bloc : la profondeur est suivie (cf. K4 de
 * `check-kotlin.ts`, même défaut rencontré au moment de l'ajouter).
 */
function code(file: string): string {
  const src = readFileSync(file, "utf8");
  let out = "";
  let i = 0;
  let depth = 0;
  let str = "";
  while (i < src.length) {
    const c = src[i]!;
    const next = src[i + 1] ?? "";
    if (depth > 0) {
      if (c === "/" && next === "*") { depth++; i += 2; continue; }
      if (c === "*" && next === "/") { depth--; i += 2; continue; }
      out += c === "\n" ? "\n" : " ";
      i++;
      continue;
    }
    if (str) {
      out += c;
      if (c === "\\") { out += next; i += 2; continue; }
      if (c === str) str = "";
      i++;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") { str = c; out += c; i++; continue; }
    if (c === "/" && next === "/") {
      while (i < src.length && src[i] !== "\n") { out += " "; i++; }
      continue;
    }
    if (c === "/" && next === "*") { depth = 1; i += 2; out += "  "; continue; }
    out += c;
    i++;
  }
  return out;
}

/** Noms des fichiers Kotlin du module `ui`. */
function uiFiles(): string[] {
  return readdirSync(UI)
    .filter((f) => f.endsWith(".kt"))
    .sort()
    .map((f) => join(UI, f));
}

const ALL = uiFiles();
const file = (name: string): string => code(join(UI, name));

/** N° de ligne (1-indexé) du `n`-ièmeOffset d'un motif, pour un message d'échec lisible. */
function lineOf(src: string, index: number): number {
  return src.slice(0, index).split("\n").length;
}

/**
 * Appels `nom(` avec LEURS parenthèses équilibrées : `args` est le texte entre
 * les parenthèses, ce qui permet de vérifier l'ARGUMENT de l'appel (le rôle,
 * le `contentDescription`) plutôt que le nom. Les KDoc et les déclarations
 * (`fun foo(`) sont ignorés.
 */
function calls(src: string, name: string): Array<{ line: number; args: string }> {
  const out: Array<{ line: number; args: string }> = [];
  const re = new RegExp(`\\b${name}\\(`, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    if (/\bfun\s*$/.test(src.slice(Math.max(0, m.index - 40), m.index))) continue;
    let i = m.index + m[0].length;
    let depth = 1;
    let str = "";
    while (i < src.length && depth > 0) {
      const c = src[i]!;
      if (str) {
        if (c === "\\") { i += 2; continue; }
        if (c === str) str = "";
      } else if (c === '"' || c === "'" || c === "`") {
        str = c;
      } else if (c === "(") {
        depth++;
      } else if (c === ")") {
        depth--;
      }
      i++;
    }
    out.push({ line: lineOf(src, m.index), args: src.slice(m.index + m[0].length, i - 1) });
  }
  return out;
}

/** Positions de `motif` dans le source, avec leur ligne. */
function hits(src: string, pattern: RegExp): Array<{ line: number; text: string }> {
  return [...src.matchAll(pattern)].map((m) => ({ line: lineOf(src, m.index!), text: m[0] }));
}

describe("unit android accessibilité #146 — icônes et libellés", () => {
  test("toute icône a un contentDescription : un nom, ou `null` si décorative", () => {
    // AVANT #146 (issue d'origine) : un seul `contentDescription` dans
    // 3 911 lignes. Les glyphes Unicode de la barre d'onglets ont disparu en
    // #135 ; ce garde-fou verrouille le résultat, icône par icône.
    let icons = 0;
    const missing: string[] = [];
    for (const path of ALL) {
      const src = code(path);
      for (const c of calls(src, "Icon")) {
        icons++;
        if (!/contentDescription\s*=/.test(c.args)) {
          missing.push(`${path.split("/").pop()}:${c.line}`);
        }
      }
    }
    // Le module rend bien des icônes (sinon le test ne prouverait rien).
    expect({ icons: icons > 30, ok: true }).toEqual({ icons: true, ok: true });
    expect({ missing }).toEqual({ missing: [] });
  });

  test("un glyphe purement décoratif ne se fait pas annoncer deux fois", () => {
    // `contentDescription = null` SEUL ne suffit pas sur un `Text` : un `Text` est
    // du texte, donc lu tel quel (c'est ce qui rendait le « 📎 » d'une pièce
    // jointe annoncé en plus du nom du fichier). Il faut
    // `clearAndSetSemantics {}` pour le sortir de l'arbre de sémantique quand
    // l'information est déjà portée par le libellé voisin.
    //
    // AVANT #146 : la pastille matière (`Text("■")`) et le glyphe « 📎 » d'une
    // pièce jointe étaient lus en double.
    const spoken: string[] = [];
    for (const path of ALL) {
      const src = code(path);
      for (const c of calls(src, "Text")) {
        // Un `Text` dont le texte est un GLYPHE seul : emoji, puce, « ✓ ».
        const first = (c.args.split(",")[0] ?? "").trim();
        const literal = /^(?:text\s*=\s*)?("[^"]*"|it|label|text|emoji)$/.exec(first);
        if (!literal) continue;
        if (!/["'][^"'\\]{1,3}["']/.test(first) || /[A-Za-zÀ-ÿ]{3}/.test(first)) continue;
        if (/clearAndSetSemantics/.test(c.args)) continue;
        spoken.push(`${path.split("/").pop()}:${c.line} ${first}`);
      }
    }
    expect({ spoken }).toEqual({ spoken: [] });
  });
});

describe("unit android accessibilité #146 — l'information ne repose pas sur la couleur", () => {
  test("aucune pastille de matière n'est un glyphe coloré", () => {
    // AVANT : `Text("■", color = color)` — un carré de couleur, seul signal de la
    // matière pour un daltonien, et muet pour un lecteur d'écran.
    for (const path of ALL) {
      for (const bad of hits(code(path), /Text\(\s*"\s*[■▪●○◼◻▲▼]\s*"/g)) {
        expect({ where: `${path.split("/").pop()}:${bad.line}`, glyph: bad.text }).toEqual({
          where: "jamais",
          glyph: "jamais",
        });
      }
    }
  });

  test("la légende matière porte une pastille ET un libellé écrit", () => {
    const src = file("SubjectStyle.kt");
    // Les deux, TOUJOURS : la pastille (emoji ou initiale) et le libellé en
    // toutes lettres. C'est ce qui rend la matière identifiable sans couleur.
    expect(src).toContain("PapSubjectAvatar(");
    expect(src).toContain("text = style.label,");
    // Pas de `badge` (« emoji nom ») : l'emoji est dans la pastille, donc le
    // recopier dans le texte ne ferait que l'annoncer deux fois.
    expect(src).not.toContain("text = style.badge");
    // Écart de GROUPE : la légende est une liste de lignes.
    expect(src).toContain("Column(verticalArrangement = Arrangement.spacedBy(8.dp))");
  });

  test("le texte d'état ne s'appuie ni sur `primary` ni sur `error` brut", () => {
    // Mesuré : `primary` = 3.74:1 sur la surface (3.45:1 sur la surface variante),
    // `error` = 3.70:1 sur la surface SOMBRE. Les deux sont des aplats, pas des
    // encre de texte. Le texteaccenté prend `secondary` (4.93:1) et le texte
    // d'erreur passe par `errorTextColor()` (8.52:1 en sombre).
    const banned = /(?:color|contentColor)\s*=\s*(?:MaterialTheme\.colorScheme\.(?:primary|error)|scheme\.(?:primary|error))\b/;
    const offenders: string[] = [];
    for (const path of ALL) {
      const src = code(path);
      for (const c of calls(src, "Text")) {
        if (banned.test(c.args)) offenders.push(`${path.split("/").pop()}:${c.line} Text`);
      }
      // Un libellé de bouton n'est pas forcément dans un `Text(` direct :
      // `ButtonDefaults.textButtonColors(contentColor = …)` est le chemin du
      // dialogue de confirmation.
      for (const c of calls(src, "textButtonColors")) {
        if (banned.test(c.args)) offenders.push(`${path.split("/").pop()}:${c.line} contentColor`);
      }
    }
    expect({ offenders }).toEqual({ offenders: [] });
  });
});

describe("unit android accessibilité #146 — rôles, états et titres", () => {
  test("toute cible cliquable porte un rôle et, si elle est choisie, son état", () => {
    // Sans `role`, TalkBack annonce « double toucher pour activer » sans dire ce
    // que fait l'élément. `Modifier.clickable` nu =Roleless. C'est la faute de
    // #146 la plus visible sur `PapListItem`, `HomeMoreButton` et le chevron du
    // profil.
    const roleless: string[] = [];
    for (const path of ALL) {
      const src = code(path);
      for (const fn of ["clickable", "selectable", "toggleable"]) {
        for (const c of calls(src, fn)) {
          if (!/role\s*=/.test(c.args)) roleless.push(`${path.split("/").pop()}:${c.line} ${fn}`);
        }
      }
    }
    expect({ roleless }).toEqual({ roleless: [] });
  });

  test("une icône n'est jamais la zone tactile", () => {
    // AVANT #146 : le chevron « Changer de compte » était un
    // `Icon(... .clickable(...))`, donc 24 dp de cible. Le geste va sur un
    // conteneur de [TouchTarget] (`IconButton`, `Box`, `Surface`).
    const offenders: string[] = [];
    for (const path of ALL) {
      const src = code(path);
      for (const c of calls(src, "Icon")) {
        if (/\.clickable\(|\.selectable\(|\.toggleable\(/.test(c.args)) {
          offenders.push(`${path.split("/").pop()}:${c.line}`);
        }
      }
    }
    expect({ offenders }).toEqual({ offenders: [] });
  });

  test("l'état d'un élément choisi existe hors du sens visuel", () => {
    // AVANT : la sélection d'une compétence était portée par la SEULE élévation
    // (invisible), celle d'un compte par la seule coche. `stateDescription` (or
    // `selectable`, qui pose `selected`) doit exister là où il y a un choix.
    const src = [
      file("Competences.kt"),
      file("ProfileAccountSwitcher.kt"),
      file("SettingsSubjectEditor.kt"),
      file("Assignments.kt"),
      file("MessagesScreen.kt"),
    ].join("\n");
    expect(src).toContain("stateDescription");
    // Les deux sélecteurs à choix unique (compte appairé, couleur/emoji de la
    // matière) passent par `Role.RadioButton`.
    expect(src).toContain("Role.RadioButton");
    // Et `Role.Checkbox` là où l'état est binaire (devoir fait, non lus).
    expect(src).toContain("Role.Checkbox");
  });

  test("les titres de section sont annoncés comme titres", () => {
    // `heading()` est ce que TalkBack liste sous « titres » et ce sur quoi il se
    // positionne : sans lui, les quinze routes n'avaient AUCUN point d'entrée.
    // Les deux briques partagées couvrent une quinzaine d'écrans d'un coup.
    const shared = file("PapComponents.kt");
    expect({ header: shared.includes("heading()"), empty: shared.includes("heading()") })
      .toEqual({ header: true, empty: true });
    // Le titre de la barre du haut EST le titre de l'écran.
    expect(file("AppShell.kt")).toContain("Modifier.semantics { heading() }");
    // Les écrans qui écrivent un titre à la main doivent le poser aussi : c'est
    // la liste des titres d'#146, un fichier par titre.
    for (const name of [
      "Assignments.kt",
      "AttendanceRows.kt",
      "CanteenMenus.kt",
      "Competences.kt",
      "GradesHero.kt",
      "GradesRows.kt",
      "GradesScreen.kt",
      "IndexScreen.kt",
      "MessagesScreen.kt",
      "PairingScreen.kt",
      "ProfileAccountSwitcher.kt",
      "RevisionSheets.kt",
      "SecurityAlertsScreen.kt",
      "SettingsScreen.kt",
      "SettingsSubjectEditor.kt",
      "TimetableWeek.kt",
      "HomeworkHelp.kt",
    ]) {
      expect({ file: name, heading: file(name).includes("heading()") }).toEqual({ file: name, heading: true });
    }
  });
});

describe("unit android accessibilité #146 — cibles tactiles, débordements, groupes", () => {
  test("la cible tactile du module est de 48 dp", () => {
    // WCAG 2.5.8 (AA) demande 24 × 24 dp, Material en impose 48 : on pose 48.
    const theme = file("PapillonTheme.kt");
    expect(theme).toContain("val TouchTarget = 48.dp");
    // Les cibles maison s'y réfèrent, elles ne réinventent pas un nombre.
    // AVANT : `SWATCH = 44.dp` (pastilles de couleur et d'emoji) et le cercle
    // « à faire » cliquable en 26 dp.
    expect(file("SettingsSubjectEditor.kt")).toContain("private val SWATCH = TouchTarget");
    // La cible du cercle « à faire » : le geste est sur une boîte de 48 dp, le
    // cercle visible (26 dp) est centré dedans.
    const done = file("Assignments.kt");
    expect(done).toMatch(/\.size\(TouchTarget\)\s*\n\s*\.papPressable\(/);
    expect(done).toContain(".papPressable(role = Role.Checkbox, onClick = click)");
    expect(file("HomeCards.kt")).toContain("defaultMinSize(minHeight = TouchTarget)");
    expect(file("GradesHero.kt")).toContain("heightIn(min = TouchTarget)");
  });

  test("aucun texte serveur n'est rendu sans borne", () => {
    // Le contrat borne les MATIÈRES, pas les COMMENTAIRES : `description` d'un
    // devoir vaut 2 000 caractères, un libellé d'évaluation 200, un motif de
    // sanction est libre. Rendu tel quel dans une carte, il pousse le reste de
    // l'écran hors de vue. Chaque champ de payload affiché est donc borné —
    // `maxLines` + `TextOverflow.Ellipsis`, avec repli là où l'information
    // compte (cf. `DESCRIPTION_MAX_LINES` + « Voir plus » dans `Assignments.kt`).
    //
    // La liste est POSÉE à la main parce que « serveur » ne s'analyse pas : ce
    // sont les ACCÈS aux champs de payload affichés par un `Text`, et chacun
    // porte une raison dans le test de theme/payload qui le regarde.
    const fields = [
      "assignment.title", "text.title", "text.body", "item.title", "item.body",
      "m.body", "m.authorName", "row.motif", "row.type", "absenceTitle(row)",
      "sheet.title", "sheet.body", "entry.label", "entry.subject", "period.name",
      "gradeLabel(grade)", "status.title", "status.detail",
      "chip.badge", "style.badge", "style.label",
    ];
    const unbounded: string[] = [];
    for (const path of ALL) {
      const src = code(path);
      for (const c of calls(src, "Text")) {
        const textArg = /text\s*=\s*([^,]*)/.exec(c.args)?.[1] ?? "";
        if (!fields.some((f) => textArg.includes(f))) continue;
        // `maxLines = Int.MAX_VALUE` = borné PAR DÉFAUT (repli « Voir plus »).
        if (!/maxLines\s*=/.test(c.args)) {
          unbounded.push(`${path.split("/").pop()}:${c.line} ${textArg.trim().slice(0, 60)}`);
        }
      }
    }
    // Deux exceptions, VOLONTAIRES et documentées sur place :
    //   - `m.body` : le message d'une bulle, dans une liste qui défile — tronquer
    //     un message sans écran de détail perdrait l'information ;
    //   - `sheet.body` : la fiche ENTIÈRE, idem, dans une liste qui défile.
    // Sont donc hors table, et bornés AUTREMENT : `excerpt`
    // (`SecurityAlertsScreen`, repli `excerptPreview` + « Afficher plus »),
    // `o.answer` (réponse du modèle, dialogue défilant) et `text.body`
    // (`Assignments`, `maxLines = Int.MAX_VALUE` sous repli).
    expect({ unbounded: unbounded.filter((u) => !/MessagesScreen\.kt:\d+ m\.body/.test(u) && !/RevisionSheets\.kt:\d+ sheet\.body/.test(u)) })
      .toEqual({ unbounded: [] });
  });

  test("un groupe d'éléments n'est jamais espacé de moins de 8 dp", () => {
    // AVANT : la légende matière espacait ses lignes de 2 dp et la feuille des
    // comptes de 4 dp — en dessous, un GROUPE se lit comme un bloc unique et la
    // lecture tactile perd la séparation. Les 2-4 dp restants sont des paires
    // (icône + libellé, valeur + barème) à l'intérieur d UNE ligne : c'est le
    // conteneur qui ITERE qui est mesuré ici.
    const containers = /\b(Column|Row|LazyColumn|LazyRow|FlowRow)\s*\((?:[^()]|\([^()]*\))*\bverticalArrangement\s*=\s*Arrangement\.spacedBy\((\d+(?:\.\d+)?)\.dp\)/g;
    const tight: string[] = [];
    for (const path of ALL) {
      const src = code(path);
      for (const m of src.matchAll(containers)) {
        if (parseFloat(m[2]!) >= 8) continue;
        // Le corps du conteneur suit l'appel : s'il répète des éléments (une
        // liste, un groupe), l'écart est celui d'un GROUPE.
        const body = src.slice(m.index, m.index + 1400);
        const head = body.slice(0, body.indexOf(")") + 1);
        const after = body.slice(head.length);
        if (!/for\s*\(|forEach|items\(|repeat\(|\.map\s*\{/.test(after)) continue;
        tight.push(`${path.split("/").pop()}:${lineOf(src, m.index!)} ${m[1]} ${m[2]}.dp`);
      }
    }
    expect({ tight }).toEqual({ tight: [] });
  });
});