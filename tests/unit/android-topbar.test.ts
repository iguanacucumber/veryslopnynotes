// Barre du haut façon Papillon (#325) : pastilles tonales, une seule pilule
// d'actions, période qui REMPLACE le titre sur Notes, couleur défilée thémée.
//
// Pourquoi un test de source : `make check` ne lance pas d'émulateur. Les
// invariants visibles ici sont ceux qu'une refonte casse en silence — une cible
// tactile qui rétrécit, un jeton de couleur Material qui revient, ou le doublon
// « Trimestre 1 » qui réapparaît dans la barre.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { codeOnly } from "../../agents/runtime/source-guards";

const ROOT = join(import.meta.dir, "..", "..");
const UI = join(ROOT, "android/ui/src/main/java/fr/veryslopnynotes/ui");
const read = (file: string) => codeOnly(readFileSync(join(UI, file), "utf8"));
const shell = read("AppShell.kt");
const rows = read("GradesRows.kt");

describe("barre du haut façon Papillon (#325)", () => {
  test("pastilles : 40 dp visuel, cible tactile de 48 dp", () => {
    expect(shell).toContain("private val TopBarChipHeight = 40.dp");
    expect(shell).toContain("private val TopBarChipHit = TouchTarget");
    expect(shell).toContain("private val TopBarChipInset = (TopBarChipHit - TopBarChipHeight) / 2");
    // Fond de pastille : le jeton Papillon, jamais une couleur littérale.
    expect(shell).toContain("shape = CircleShape");
    expect(shell).toContain("color = scheme.surfaceVariant");
    expect(shell).not.toMatch(/Color\(0x/);
  });

  test("actions : une seule pilule, séparateur, et pas de menu vide", () => {
    expect(shell).toContain("val hasRefresh = actions.any { it is TopAction.Refresh }");
    // Un groupe sans relecture ni destination ne peint rien.
    expect(shell).toContain("if (!hasRefresh && destinations.isEmpty()) return");
    // Le fond de la pilule et le filet entre les deux actions.
    expect(shell).toContain(".background(scheme.surfaceVariant)");
    expect(shell).toContain(".background(scheme.outlineVariant)");
    // Libellés annoncés : rien ne change pour TalkBack.
    expect(shell).toContain('contentDescription = "Actualiser"');
    expect(shell).toContain('contentDescription = "Plus d\'actions"');
    expect(shell).toContain("TopBarActions(actions = actions, onNavigate = onNavigate, onRefresh = onRefresh)");
  });

  test("Notes : la pastille de période remplace le titre (plus de doublon)", () => {
    expect(shell).toContain("val leadingReplacesTitle = back == null && leading != null");
    // Le slot publié prend la largeur restante sans pousser les actions.
    expect(shell).toContain(".weight(1f, fill = false)");
    // Le titre garde sa branche et son point d'entrée d'accessibilité…
    expect(shell).toContain("text = published?.title ?: bar?.title ?: APP_NAME");
    expect(shell).toContain("Modifier.semantics { heading() }");
    // … tandis que le slot publié porte le heading quand il remplace le titre.
    expect(shell).toContain(".semantics { heading() }");
    // La pastille de période elle-même prend la géométrie de la barre.
    expect(rows).toContain("shape = CircleShape");
    expect(rows).toContain("containerColor = MaterialTheme.colorScheme.surfaceVariant");
  });

  test("fond défilé thémé et filet de séparation animé", () => {
    // Le défaut M3 est `surfaceContainer`, non posé par Papillon : en clair il
    // virait au lavande. La barre choisit donc explicitement son jeton.
    expect(shell).toContain("scrolledContainerColor = scheme.surfaceContainerLow");
    expect(shell).toContain("val hairline by animateFloatAsState(");
    expect(shell).toContain(".alpha(hairline)");
    expect(shell).toContain(".background(scheme.outlineVariant)");
  });
});
