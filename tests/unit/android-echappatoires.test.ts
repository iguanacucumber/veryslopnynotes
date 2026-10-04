// #147 — LES ÉCHAPPATOIRES : enums serveur en clair, message d'erreur jeté,
// état de formulaire perdu, copies de dates.
//
// Ce fichier est le TÉMOIN des trois familles corrigées ici, pas un miroir
// d'écran de plus (les miroirs restent dans `android-<écran>.test.ts`, et
// l'émetteur est dans `tests/unit/fixtures/date-fr.ts` et `enum-fr.ts`, qui
// LISENT le Kotlin au lieu de le recopier).
//
// Les trois gardesrittenci-dessous ont été écrites ROUGES contre `origin/main`
// avant d'être vérifiées vertes sur cette branche :
//   - la couverture des enums du contrat (aucune table unique sur main : cinq
//     `when` par écran, `REcipientKIND_LABELS`, `canteenStatusLabel`, …) ;
//   - l'unicité du tableau de jours (quatre copies Kotlin, dont une en
//     « lundi d'abord ») ;
//   - l'état de formulaire sauvegardé (ZÉRO `rememberSaveable` dans le module).
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ABSENCE_KINDS,
  AVERAGE_ALGORITHMS,
  CANTEEN_MEALS,
  CANTEEN_MENU_STATUSES,
  RECIPIENT_KINDS,
  TIMETABLE_STATUSES,
} from "../../shared/contracts/models";
import { SECURITY_ALERT_KINDS } from "../../shared/contracts/events";
import { ENUM_FR_KT, enumFr, isFrenchLabel, kotlinEnumTable } from "./fixtures/enum-fr";
import { dayLabelFr, frDayNames, frMonths } from "./fixtures/date-fr";

const ROOT = join(import.meta.dir, "..", "..");
const ANDROID = join(ROOT, "android");
const UI = join(ANDROID, "ui/src/main/java/fr/veryslopnynotes/ui");
const CORE = join(ANDROID, "core/src/main/java/fr/veryslopnynotes/core");

/** Sans les commentaires : une garde de source ne doit pas confondre un `//` qui
 *  NOMME un défaut avec le défaut lui-même. */
const codeOnly = (c: string): string =>
  c
    .replace(/\/\*[\s\S]*?\*\//g, "\n")
    .split("\n")
    .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*"))
    .join("\n");

const ktFiles = (dir: string): string[] =>
  readdirSync(dir)
    .filter((f) => f.endsWith(".kt"))
    .map((f) => join(dir, f))
    .filter((f) => !f.includes("/build/"));

/** Les `export const X = [...] as const` du CONTRAT, importés — jamais recopiés. */
const CONTRACT_ENUMS: Record<string, readonly string[]> = {
  RECIPIENT_KINDS,
  CANTEEN_MEALS,
  CANTEEN_MENU_STATUSES,
  TIMETABLE_STATUSES,
  ABSENCE_KINDS,
  AVERAGE_ALGORITHMS,
  SECURITY_ALERT_KINDS,
};

describe("échappatoires #147 : un enum du contrat sort en français, ou pas du tout", () => {
  test("COUVERTURE : chaque jeton affiché a un libellé français dans l'UNIQUE table", () => {
    const table = kotlinEnumTable();
    const manquants: string[] = [];
    for (const [nom, jetons] of Object.entries(CONTRACT_ENUMS)) {
      for (const jeton of jetons) {
        const label = table[jeton];
        if (label === undefined) {
          manquants.push(`${nom}:${jeton}`);
          continue;
        }
        // Un jeton recopié en majuscules (« SERVING », « TEACHER ») est
        // précisément le défaut que l'issue décrit : ça ne passe pas.
        expect({ jeton, libelle: label, identique: label === jeton }).toEqual({ jeton, libelle: label, identique: false });
        expect({ jeton, majuscules: label === label.toUpperCase() }).toEqual({ jeton, majuscules: false });
        expect({ jeton, francophone: isFrenchLabel(label) }).toEqual({ jeton, francophone: true });
      }
    }
    // Un enum ajouté au contrat SANS libellé fait échouer CE test, donc
    // `make check`, au lieu d'apparaître en anglais dans une version de l'app.
    expect({ manquants }).toEqual({ manquants: [] });
    expect(Object.keys(table).length).toBeGreaterThanOrEqual(
      Object.values(CONTRACT_ENUMS).flat().length,
    );
  });

  test("REPLI : un jeton hors contrat ne sort JAMAIS brut, jamais en majuscules", () => {
    // Le repli est celui de l'APPELLANT (« Statut inconnu », « Destinataire »…) :
    // c'est lui qui connaît le contexte, pas la table.
    expect(enumFr("servi", "Statut inconnu")).toBe("Statut inconnu");
    expect(enumFr("SERVING", "Statut inconnu")).toBe("Statut inconnu");
    expect(enumFr("teacher2", "Destinataire")).toBe("Destinataire");
    expect(enumFr("", "Autre source")).toBe("Autre source");
    expect(enumFr("   ", "Autre source")).toBe("Autre source");
    expect(enumFr(null, "Événement")).toBe("Événement");
    // Sans repli demandé : le défaut du fichier, lui aussi lisible.
    expect(enumFr("mystery")).toBe("Inconnu");
    // Le repli n'est JAMAIS le jeton, quelle que soit sa casse.
    for (const jeton of ["SERVING", "TEACHER", "injection", "student2"]) {
      expect({ jeton, affiche: enumFr(jeton) }).toEqual({ jeton, affiche: "Inconnu" });
    }
    // Les jetons connus, eux, sont traduits — y compris ceux des trois sources
    // d'alerte, qui sont des jetons anglais eux aussi.
    expect(enumFr("injection_neutralized")).toBe("Injection neutralisée");
    expect(enumFr("revision")).toBe("Fiches de révision");
    expect(enumFr("manuals")).toBe("Manuels");
    // Le repli est un paramètre de la fonction : c'est le seul moyen d'avoir un
    // jeton réellement hors table, puisque la couverture est vérifiée ci-dessus.
    const kt = readFileSync(ENUM_FR_KT, "utf8");
    expect(kt).toContain("fun enumFr(token: String?, fallback: String = ENUM_FALLBACK): String");
    // Le repli est un `?:` — pas un `?: ""`, pas une exception, pas le jeton.
    expect(kt).toContain("return ENUM_FR[key] ?: fallback");
  });

  test("UNE SEULE table : aucun écran ne remappe plus un jeton du contrat", () => {
    // AVANT #147 : `REcipientKIND_LABELS` côté messagerie, `"served" -> "Servi"`
    // et `"breakfast" -> "Petit-déjeuner"` côté cantine, `"revision" -> …` côté
    // alertes, `if (kind == "late") "Retard"` côté vie scolaire, un `when`
    // côté moyennes — six réponses au même jeton, et aucune couverture vérifiable.
    const remappe = /"(student|teacher|administration|breakfast|lunch|dinner|served|planned|normal|cancelled|moved|absence|late|subject|weighted|median|injection_neutralized|revision|homework|manuals)"\s*(to|->)\s*"/;
    for (const file of ktFiles(UI)) {
      const src = codeOnly(readFileSync(file, "utf8"));
      expect({ file, table: remappe.test(src) }).toEqual({ file, table: false });
    }
    // …et les écrans passent tous par le helper.
    const consumers = {
      "MessagesLogic.kt": "enumFr(kind, RECIPIENT_KIND_FALLBACK)",
      "CanteenMenus.kt": "enumFr(status, CANTEEN_STATUS_UNKNOWN)",
      "SecurityAlertsScreen.kt": "enumFr(source, ALERT_SOURCE_FALLBACK)",
      "Attendance.kt": "enumFr(kind, ABSENCE_KIND_FALLBACK)",
      "Averages.kt": "enumFr(algorithm, ALGORITHM_CHIP_FALLBACK)",
    };
    for (const [file, attendu] of Object.entries(consumers)) {
      expect({ file, attendu, trouve: readFileSync(join(UI, file), "utf8").includes(attendu) }).toEqual({
        file,
        attendu,
        trouve: true,
      });
    }
  });

  test("AUCUN jeton en MAJUSCULES dans une chaîne de android/ui (le grep de l'issue)", () => {
    // Critère d'acceptation littéral : `grep -E '"(TEACHER|STUDENT|SERVED|PLANNED)"'`.
    for (const file of ktFiles(UI)) {
      const src = codeOnly(readFileSync(file, "utf8"));
      for (const jetons of Object.values(CONTRACT_ENUMS)) {
        for (const jeton of jetons) {
          const forme = `"${jeton.toUpperCase()}"`;
          expect({ file, forme, trouve: src.includes(forme) }).toEqual({ file, forme, trouve: false });
        }
      }
    }
  });
});

describe("échappatoires #147 : une seule implémentation des dates françaises", () => {
  test("UN SEUL tableau de jours et de mois dans tout le module", () => {
    // AVANT #147 : `Assignment.dayLabelFr`, `canteenDayLabel`, `homeDayLabel`,
    // `TimetableWeek.DAY_NAMES` (dimanche d'abord) et `AttendanceFormat
    // .WEEKDAYS_FR` (LUNDI d'abord), plus `MONTHS_FR` en deux fichiers.
    const tables: string[] = [];
    for (const dir of [CORE, UI]) {
      for (const file of ktFiles(dir)) {
        const src = readFileSync(file, "utf8");
        if (src.includes('"dimanche"')) tables.push(`${file}:jours`);
        if (src.includes('"janvier"')) tables.push(`${file}:mois`);
      }
    }
    expect(tables).toEqual([`${join(CORE, "DateFr.kt")}:jours`, `${join(CORE, "DateFr.kt")}:mois`]);
    // L'indexation est celle de `java.time` (`dayOfWeek.value % 7`), donc
    // dimanche = 0 : les sept jours, dans cet ordre, pas dans un autre.
    expect(frDayNames()).toEqual(["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"]);
    expect(frMonths()).toHaveLength(12);
    expect(frMonths()[0]).toBe("janvier");
    expect(frMonths()[11]).toBe("décembre");
  });

  test("ZÉRO tranche ISO affichée : plus de `substring(0, 10)` ni `take(10)`", () => {
    // Le défaut affichable : « 2026-10-02 » dans une interface française, parce
    // que la date était une TRANCHE de chaîne. Il reste deux mentions dans le
    // module : `isoDayKey`, qui est une clé de TRI nommée comme telle, et le
    // retour des audiences d'écran (aucune des deux n'est rendue).
    for (const dir of [CORE, UI]) {
      for (const file of ktFiles(dir)) {
        const src = codeOnly(readFileSync(file, "utf8"));
        expect({ file, iso: src.includes("take(10)") }).toEqual({ file, iso: false });
        if (file.endsWith("DateFr.kt")) continue;
        expect({ file, tranche: src.includes('substring(0, 10)') }).toEqual({ file, tranche: false });
      }
    }
    // L'écran qui affichait la tranche ISO affiche un jour français (l'autre,
    // Compétences, a été supprimé en #184).
    for (const [file, attendu] of [["RevisionSheets.kt", "dayLabelFr(sheet.date)"]]) {
      const src = readFileSync(join(UI, file as string), "utf8");
      expect({ file, attendu, trouve: src.includes(attendu as string) }).toEqual({ file, attendu, trouve: true });
    }
    // Et le rendu : « vendredi 02/10 », chaîne VIDE pour une date illisible.
    expect(dayLabelFr("2026-10-02T07:00:00.000Z")).toBe("vendredi 02/10");
    expect(dayLabelFr("2026-10-05")).toBe("lundi 05/10");
    expect(dayLabelFr("2026-02-30")).toBe("");
    expect(dayLabelFr("pas une date")).toBe("");
    expect(dayLabelFr("")).toBe("");
  });

  test("chaque écran délègue, il ne réécrit pas sa propre table", () => {
    for (const [file, attendu] of [
      ["TimetableWeek.kt", "weekdayCapitalizedFr(date.dayOfWeek)"],
      ["TimetableWeek.kt", "dayLabelOf(date)"],
      ["HomeWidgets.kt", "dayLabelOf("],
      ["CanteenMenus.kt", "dayLabelFr(date)"],
      ["AttendanceFormat.kt", "weekdayFr(day.dayOfWeek)"],
    ]) {
      const src = readFileSync(join(UI, file as string), "utf8");
      expect({ file, attendu, trouve: src.includes(attendu as string) }).toEqual({ file, attendu, trouve: true });
    }
  });
});

describe("échappatoires #147 : plus d'état de formulaire perdu à la rotation", () => {
  test("les saisies sont SAUVEGARDÉES (brouillons, semaine, période, filtre, étape)", () => {
    // AVANT #147 : ZÉRO `rememberSaveable` dans le module. Tourner l'écran
    // effaçait le brouillon de réponse, la nouvelle discussion, l'adresse du
    // serveur, la semaine affichée, la période filtrée, la compétence ouverte,
    // la question posée à l'assistant.
    const attendu: Record<string, string[]> = {
      "PairingScreen.kt": [
        "var serverDraft by rememberSaveable",
        "var serverError by rememberSaveable",
        "var serverSaved by rememberSaveable",
        "var step by rememberSaveable",
        "var form by rememberSaveable(stateSaver = SetupFormSaver)",
      ],
      "MessagesScreen.kt": [
        "var query by rememberSaveable",
        "var subject by rememberSaveable",
        "var body by rememberSaveable",
        "var picked by rememberSaveable",
        "var draft by rememberSaveable",
        "var creating by rememberSaveable",
      ],
      "SettingsScreen.kt": ["var editing by rememberSaveable", "var newSubject by rememberSaveable"],
      "SettingsSubjectEditor.kt": ["stateSaver = SubjectDraftSaver"],
      "HomeworkHelp.kt": ["var question by rememberSaveable", "var outcome by rememberSaveable"],
      "Assignments.kt": [
        "var helpFor by rememberSaveable(stateSaver = AssignmentSaver)",
        "var week by rememberSaveable",
        "var query by rememberSaveable",
        "var selectedSubject by rememberSaveable",
        "var doneOpen by rememberSaveable",
        "var expanded by rememberSaveable(a.id)",
      ],
      "GradesScreen.kt": [
        "var algorithm by rememberSaveable",
        "var periodId by rememberSaveable",
        "var query by rememberSaveable",
        "var algorithmOpen by rememberSaveable",
      ],
      "TimetableWeek.kt": ["var weekStart by rememberSaveable"],
      "Attendance.kt": ["var periodId by rememberSaveable", "var periodsOpen by rememberSaveable"],
      "NewsScreen.kt": ["var readIds by rememberSaveable"],
      "ProfileScreen.kt": ["var logoutAsk by rememberSaveable", "var sheetOpen by rememberSaveable"],
      "AppNav.kt": ["var authNotice by rememberSaveable"],
      "SecurityAlertsScreen.kt": ["var expanded by rememberSaveable(alert.id)"],
    };
    for (const [file, bouts] of Object.entries(attendu)) {
      const src = readFileSync(join(UI, file), "utf8");
      for (const bout of bouts) {
        expect({ file, bout, trouve: src.includes(bout) }).toEqual({ file, bout, trouve: true });
      }
    }
  });

  test("ni SECRET ni PAYLOAD dans l'état sauvegardé", () => {
    // Une clé LLM ne se recopie pas dans un support que l'utilisateur ne
    // surveille pas (le fichier d'état de l'activité), et un payload serveur
    // dans un `Bundle` finit en `TransactionTooLargeException`.
    const settings = readFileSync(join(UI, "SettingsScreen.kt"), "utf8");
    expect(settings).toContain("var llmKey by remember { mutableStateOf(\"\") }");
    expect(settings).not.toContain("rememberSaveable { mutableStateOf(llmKey");
    // Le QR et son PIN sont la preuve de détention : hors de l'état sauvegardé,
    // comme la clé LLM. Seule l'adresse de l'établissement y entre.
    const setup = readFileSync(join(UI, "PairingUiState.kt"), "utf8");
    expect(setup).toContain("save = { listOf(it.schoolUrl) }");
    expect(setup).not.toContain("it.qrRaw");
    expect(setup).not.toContain("it.pin");
    for (const dir of [CORE, UI]) {
      for (const file of ktFiles(dir)) {
        const src = codeOnly(readFileSync(file, "utf8"));
        for (const interdit of ["rememberSaveable(stateSaver = SetupFormSaver) { mutableStateOf(state", "rememberSaveable { mutableStateOf(uiStateFrom", "rememberSaveable { mutableStateOf(c?.payload"]) {
          expect({ file, interdit, trouve: src.includes(interdit) }).toEqual({ file, interdit, trouve: false });
        }
      }
    }
    // Les payloads sont relus du cache au montage : c'est écrit dans `UiState`.
    expect(readFileSync(join(UI, "UiState.kt"), "utf8")).toContain("JAMAIS passés à un");
  });

  test("une confirmation DESTRUCTRICE ne survit pas au tour d'écran", () => {
    // Restaurae une confirmation de suppression mettrait sous le doigt un
    // dialogue que personne n'a ouvert.
    const src = readFileSync(join(UI, "MessagesScreen.kt"), "utf8");
    expect(src).toContain("var confirmDelete by remember { mutableStateOf(false) }");
    expect(src).not.toContain("confirmDelete by rememberSaveable");
  });
});

describe("échappatoires #147 : aucun écran ne jette le message du serveur", () => {
  test("chaque `PapErrorState` reçoit un message RÉEL, jamais une chaîne figée", () => {
    // La chaîne figée n'existe plus QUE comme repli de `errorHeadline`.
    const papillon = readFileSync(join(UI, "PapComponents.kt"), "utf8");
    expect(papillon).toContain('private const val GENERIC_ERROR = "Erreur réseau. Réessayer."');
    expect(papillon).toContain("fun errorHeadline(message: String?): String");
    for (const file of ktFiles(UI)) {
      const src = readFileSync(file, "utf8");
      if (file.endsWith("PapComponents.kt")) continue;
      expect({ file, figee: src.includes('"Erreur réseau. Réessayer."') }).toEqual({ file, figee: false });
    }
    // Chaque appel passe une variable porteuse du message (jamais un littéral).
    for (const file of ktFiles(UI)) {
      if (file.endsWith("PapComponents.kt")) continue;
      const src = codeOnly(readFileSync(file, "utf8"));
      for (const appel of src.matchAll(/PapErrorState\(([^)]*)\)/g)) {
        const args = appel[1]!;
        expect({ file, args, litteral: /message\s*=\s*"/.test(args) }).toEqual({ file, args, litteral: false });
      }
    }
  });

  test("relecture ratée AVEC cache : la cause est affichée, pas seulement l'âge", () => {
    // Le cas que l'issue nomme : un bandeau « hors ligne » qui donne l'âge des
    // données sans jamais dire pourquoi la relecture a échoué.
    const attendu: Record<string, string> = {
      "TimetableWeek.kt": "text = failed.message",
      "GradesScreen.kt": "text = failed.message",
      "Attendance.kt": "text = error.message",
      "Assignments.kt": "val errorMessage = (state as? UiState.Error)?.message",
      "NewsScreen.kt": "PapErrorState(message = error, onRetry = onRetry)",
      "CanteenMenus.kt": "PapErrorState(message = error, onRetry = { refresh() })",
      "MessagesScreen.kt": "PapErrorState(message = error, onRetry = onRetry)",
      "SecurityAlertsScreen.kt": "notice = error",
      "ProfileScreen.kt": "PapErrorState(message = error, onRetry = { refresh() })",
      "RevisionSheets.kt": "PapErrorState(message = state.message, onRetry = onRefresh)",
    };
    for (const [file, bout] of Object.entries(attendu)) {
      const src = readFileSync(join(UI, file), "utf8");
      expect({ file, bout, trouve: src.includes(bout) }).toEqual({ file, bout, trouve: true });
    }
  });
});

describe("échappatoires #147 : pas de titre de route recopié dans un corps d'écran", () => {
  test("le libellé de la barre du haut n'est rendu qu'une fois, par la barre", () => {
    // #135 l'a retiré écran par écran ; ce test le rejoue sur TOUS les titres de
    // `AppShell.kt`, y compris ceux ajoutés depuis.
    const shell = readFileSync(join(UI, "AppShell.kt"), "utf8");
    const titres = [...shell.matchAll(/TopBar\("([^"]+)"/g)].map((m) => m[1]!);
    expect(titres.length).toBeGreaterThan(10);
    // Un libellé de route dans une LIGNE DE NAVIGATION (liste du profil, menu,
    // accès rapide de l'accueil) est légitime : c'est une destination nommée, pas
    // le titre de l'écran. Ce qui est défendu, c'est le titre du même écran
    // répiqué dans son corps.
    const navigation = /PapListItem|DropdownMenuItem|HomeQuickActionUi|TopAction|onClick\s*=|go[A-Z]\w*\)?\s*,?\s*$/;
    const doublons: string[] = [];
    for (const file of ktFiles(UI)) {
      if (file.endsWith("AppShell.kt") || file.endsWith("AppNav.kt")) continue;
      const lignes = codeOnly(readFileSync(file, "utf8")).split("\n");
      for (const titre of titres) {
        for (const [i, ligne] of lignes.entries()) {
          if (!ligne.includes(`"${titre}"`)) continue;
          const autour = lignes.slice(Math.max(0, i - 4), i + 4).join("\n");
          if (navigation.test(autour)) continue;
          doublons.push(`${file}:${i + 1}:${titre}`);
        }
      }
    }
    expect(doublons).toEqual([]);
  });
});