// L'interface ne nie pas une information que l'établissement n'a pas
// publiée (#424). Les écrans sont RENDUS (`react-dom/server`) puis lus : ce
// n'est pas une lecture de source, c'est ce que l'utilisateur voit.
//
// - le natif ne publie `justified` que pour les événements JUSTIFIÉS : une
//   absence de ce champ est INCONNUE, pas « tout est justifié » ;
// - une sanction publie une DURÉE (`durationMinutes`), jamais un niveau.
import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import {
  AttendanceScreen,
  SanctionsScreen,
} from "../../web/src/features/attendance/SchoolLifeScreens";
import {
  parseAttendance,
  parsePunishments,
  type Absence,
  type Punishment,
} from "../../web/src/features/attendance/model";

function renderAttendance(rows: Absence[], onlyPending = false): string {
  return renderToStaticMarkup(
    createElement(
      MemoryRouter,
      null,
      createElement(AttendanceScreen, {
        rows,
        loading: false,
        error: null,
        stale: false,
        onlyPending,
        canSeeSanctions: false,
        onOnlyPendingChange: () => {},
        onRefresh: () => {},
      }),
    ),
  );
}

function renderSanctions(rows: Punishment[]): string {
  return renderToStaticMarkup(
    createElement(
      MemoryRouter,
      null,
      createElement(SanctionsScreen, {
        rows,
        loading: false,
        error: null,
        stale: false,
        onRefresh: () => {},
      }),
    ),
  );
}

describe("assiduité — la justification absente est INCONNUE, pas justifiée", () => {
  // Deux heures manquées, aucune information de justification : le natif ne
  // publie pas `justified` (il ne le fait que pour un événement justifié).
  const rows = parseAttendance(
    JSON.stringify({
      absences: [
        { id: "a1", kind: "absence", date: "2026-10-12T08:00:00Z", durationMinutes: 120 },
        { id: "a2", kind: "absence", date: "2026-10-13T08:00:00Z", durationMinutes: 120 },
      ],
    }),
  ).absences;

  test("n'affirme pas que tout est justifié", () => {
    const html = renderAttendance(rows);
    expect(html).not.toContain("sont justifiés");
    expect(html).not.toContain("Aucune heure injustifiée");
  });

  test("affiche le compte des heures non vérifiées", () => {
    const html = renderAttendance(rows);
    expect(html).toContain("Des heures non vérifiées");
    // 4 h manquées, dont 4 h sans justification publiée.
    expect(html).toContain("4 h sur 4 h manquées");
    expect(html).toContain("justification non publiée");
  });

  test("le filtre « à justifier » liste les événements sans justification", () => {
    const html = renderAttendance(rows);
    expect(html).toContain("À justifier (2)");
    // Filtre actif : les deux événements sont listés, pas une liste vide.
    const filtered = renderAttendance(rows, true);
    expect(filtered).toContain("À justifier (2)");
    expect(filtered).toContain("Absences (2)");
  });

  test("une absence JUSTIFIÉE reste justifiée", () => {
    const justified = parseAttendance(
      JSON.stringify({
        absences: [{ id: "a1", kind: "absence", date: "2026-10-12T08:00:00Z", durationMinutes: 120, justified: true }],
      }),
    ).absences;
    const html = renderAttendance(justified);
    expect(html).toContain("Aucune heure injustifiée");
    expect(html).toContain("sont justifiés");
    expect(html).toContain("À justifier (0)");
  });

  test("injustifiée ET inconnue : les deux sont dites, rien n'est déduit", () => {
    const mixed = parseAttendance(
      JSON.stringify({
        absences: [
          { id: "a1", kind: "absence", date: "2026-10-12T08:00:00Z", durationMinutes: 60, justified: false },
          { id: "a2", kind: "absence", date: "2026-10-13T08:00:00Z", durationMinutes: 120 },
        ],
      }),
    ).absences;
    const html = renderAttendance(mixed);
    expect(html).toContain("Des heures injustifiées");
    expect(html).toContain("1 h sur 3 h manquées");
    expect(html).toContain("1 sans information de justification");
    expect(html).toContain("À justifier (2)");
  });
});

describe("sanction — une durée, pas un niveau", () => {
  test("la durée publiée s'affiche en heures lisibles", () => {
    const rows = parsePunishments(
      JSON.stringify({
        punishments: [
          {
            id: "p1",
            date: "2026-10-02T10:00:00Z",
            type: "Retenue",
            motif: "Devoir non fait",
            durationMinutes: 120,
          },
        ],
      }),
    );
    const html = renderSanctions(rows);
    expect(html).toContain("Durée : 2 h");
    expect(html).not.toContain("Niveau");
  });

  test("l'ancien champ `gravity` n'est plus lu comme un niveau", () => {
    // Le natif publiait la durée dans `gravity` : le web en faisait un
    // « Niveau 120 ». Le champ a disparu du payload, il ne doit plus rien
    // afficher.
    const rows = parsePunishments(
      JSON.stringify({
        punishments: [
          {
            id: "p1",
            date: "2026-10-02T10:00:00Z",
            type: "Retenue",
            motif: "Devoir non fait",
            gravity: 120,
          },
        ],
      }),
    );
    const html = renderSanctions(rows);
    expect(html).not.toContain("Niveau");
    expect(html).not.toContain("Durée");
  });
});
