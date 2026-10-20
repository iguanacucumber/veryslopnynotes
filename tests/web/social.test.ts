import { useParisTz } from "./setup";

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  UNKNOWN_UNREAD,
  conversationCountLabel,
  conversationDateLabel,
  discussionMillis,
  formatDateTime,
  formatLongDate,
  groupRecipients,
  isOwnMessage,
  isRead,
  messagePreview,
  parseDiscussions,
  parseInstant,
  parseMessages,
  parseParticipants,
  parseRecipients,
  pickedCountLabel,
  searchDiscussions,
  sortDiscussions,
  unreadBadgeCount,
  unreadTotal,
  unreadTotalLabel,
} from "../../web/src/features/messages/model";
import {
  attendanceSections,
  attendanceStatus,
  absenceTitle,
  durationLongFr,
  formatDateSpan,
  isUnjustified,
  justifiedLabel,
  parseAttendance,
  parseCapabilities,
  parsePunishments,
  sanctionsVisible,
} from "../../web/src/features/attendance/model";

useParisTz();

const WEB = join(import.meta.dir, "..", "..", "web", "src");
const read = (relative: string): string => readFileSync(join(WEB, relative), "utf8");

const discussionPayload = JSON.stringify({
  discussions: [
    {
      id: "b",
      subject: "Sortie au musée",
      participants: ["M. MARTIN C.", "DUPONT Camille"],
      unreadCount: 2,
      lastMessageAt: "2026-10-09T10:00:00.000Z",
      updatedAt: "2026-10-09T10:00:00.000Z",
    },
    {
      id: "a",
      subject: "Économie — DM",
      participants: ["Mme LEROY D."],
      updatedAt: "2026-10-10T09:00:00.000Z",
    },
    { id: "c", subject: "Sans date", participants: [] },
    { id: "", subject: "Identifiant vide", updatedAt: "2026-10-11T09:00:00.000Z" },
    { id: "d", subject: "", updatedAt: "2026-10-01T00:00:00.000Z" },
  ],
});

describe("messagerie — participants à la demande (#476)", () => {
  test("les participants arrivent AVEC le fil ouvert", () => {
    const payload = JSON.stringify({
      messages: [{ id: "m1", discussionId: "d1", body: "Bonjour", sentAt: "2026-10-18T09:00:00Z" }],
      participants: ["M. MARTIN C.", "DUPONT Camille"],
    });
    expect(parseParticipants(payload)).toEqual(["M. MARTIN C.", "DUPONT Camille"]);
    // Les messages du même payload restent lisibles.
    expect(parseMessages(payload)).toHaveLength(1);
  });

  test("payload sans participants = aucun nom, jamais une exception", () => {
    expect(parseParticipants(null)).toEqual([]);
    expect(parseParticipants("{pas du json")).toEqual([]);
    expect(parseParticipants(JSON.stringify({ messages: [] }))).toEqual([]);
    expect(parseParticipants(JSON.stringify({ participants: "non" }))).toEqual([]);
  });

  test("la recherche par participant ne porte plus sur la liste", () => {
    // La LISTE ne porte plus les participants (les noms seraient douze
    // requêtes de plus) : le nom ne trouve plus le fil.
    const list = parseDiscussions(JSON.stringify({ discussions: [{ id: "a", subject: "Économie — DM" }] }));
    expect(list[0]?.participants).toEqual([]);
    expect(searchDiscussions(list, "Leroy")).toEqual([]);
    // Le SUJET, lui, se trouve toujours.
    expect(searchDiscussions(list, "economie").map((d) => d.id)).toEqual(["a"]);
  });

  test("l'interface ne promet plus la recherche par participant", () => {
    expect(read("features/messages/MessagesScreen.tsx")).not.toContain("ni participant");
  });
});

describe("messagerie — lecture défensive", () => {
  test("lit le payload canonique et le repli `items` du pont factice", () => {
    const canonical = parseDiscussions(discussionPayload);
    expect(canonical).toHaveLength(4);
    expect(canonical.map((d) => d.id).sort()).toEqual(["a", "b", "c", "d"]);
    // Sujet absent : repli posé par le producteur natif, pas un UUID inventé.
    expect(canonical.find((d) => d.id === "d")?.subject).toBe("Discussion");
    // Un identifiant vide écarte la ligne.
    expect(canonical.some((d) => d.id === "")).toBe(false);

    const fallback = parseDiscussions(
      JSON.stringify({ items: [{ id: "x", participants: ["Mme Y"], lastMessageAt: "2026-10-18T09:00:00Z" }] }),
    );
    expect(fallback).toHaveLength(1);
    expect(fallback[0]?.subject).toBe("Mme Y");
    expect(fallback[0]?.unreadCount).toBe(UNKNOWN_UNREAD);
  });

  test("payload vide ou illisible = liste vide, jamais une exception", () => {
    expect(parseDiscussions(null)).toEqual([]);
    expect(parseDiscussions("{pas du json")).toEqual([]);
    expect(parseDiscussions(JSON.stringify({ discussions: "non" }))).toEqual([]);
  });

  test("le HTML d’un payload reste une donnée, pas du balisage", () => {
    const attack = '<img src=x onerror="alert(1)">';
    const parsed = parseDiscussions(
      JSON.stringify({ discussions: [{ id: "x", subject: attack, updatedAt: "2026-10-01T00:00:00Z" }] }),
    );
    expect(parsed[0]?.subject).toBe(attack);
    // Les sources n’interprètent jamais le contenu.
    expect(read("routes/messages.tsx")).not.toContain("dangerouslySetInnerHTML");
    expect(read("features/messages/MessagesScreen.tsx")).not.toContain("dangerouslySetInnerHTML");
  });

  test("trie sur l’instant parsé, pas sur la chaîne, et stabilise par id", () => {
    const list = parseDiscussions(discussionPayload);
    const sorted = sortDiscussions(list);
    expect(sorted.map((d) => d.id)).toEqual(["a", "b", "d", "c"]);
    // Date seule acceptée (le contrat l’admet) ; date illisible = dernier.
    expect(parseInstant("2026-10-05")).not.toBeNull();
    expect(parseInstant("n’importe quoi")).toBeNull();
    const same = [
      { id: "z", subject: "Z", participants: [], unreadCount: -1, lastMessageAt: "", updatedAt: "2026-10-01T00:00:00Z" },
      { id: "a", subject: "A", participants: [], unreadCount: -1, lastMessageAt: "", updatedAt: "2026-10-01T00:00:00Z" },
    ];
    expect(sortDiscussions(same).map((d) => d.id)).toEqual(["a", "z"]);
    expect(discussionMillis(list[2]!)).toBeNull();
  });

  // #427 : le producteur natif n'enrichit que les 12 premiers fils ; les
  // suivants ARRIVENT SANS date. Un fil de fraîcheur inconnue n'est pas daté
  // « maintenant » (les plus anciens remonteraient en tête) : il est daté
  // « inconnu » et se trie sur l'ordre d'arrivée.
  test("fraîcheur inconnue : un fil non daté garde l’ordre d’arrivée (#427)", () => {
    const payload = JSON.stringify({
      discussions: [
        { id: "z-ancien", subject: "Fil ancien non enrichi" },
        { id: "a-ancien", subject: "Autre fil ancien non enrichi" },
        { id: "recent", subject: "Fil daté", lastMessageAt: "2026-10-10T09:00:00.000Z" },
      ],
    });
    const list = parseDiscussions(payload);
    const ancien = list.find((d) => d.id === "z-ancien")!;
    // La fraîcheur inconnue n'est PAS une date : ni « maintenant », ni une
    // chaîne vide qui ferait croire à une date.
    expect(ancien.updatedAt).toBeNull();
    expect(ancien.lastMessageAt).toBeNull();
    expect(discussionMillis(ancien)).toBeNull();
    // L'interface n'affiche donc aucune date pour ce fil.
    expect(conversationDateLabel(ancien)).toBe("");
    // Un fil DATED passe devant ; deux fils inconnus gardent l'ordre du
    // payload (PAS l'ordre alphabétique des `id`).
    expect(sortDiscussions(list).map((d) => d.id)).toEqual(["recent", "z-ancien", "a-ancien"]);
    // La recherche suit le même tri.
    expect(searchDiscussions(list, "fil").map((d) => d.id)).toEqual(["recent", "z-ancien", "a-ancien"]);
  });

  test("non-lus : compteur inconnu = aucun badge, jamais « 0 »", () => {
    const list = parseDiscussions(discussionPayload);
    const b = list.find((d) => d.id === "b")!;
    const a = list.find((d) => d.id === "a")!;
    expect(unreadBadgeCount(b)).toBe(2);
    expect(unreadBadgeCount(a)).toBe(0);
    expect(isRead(b)).toBe(false);
    expect(isRead(a)).toBe(false); // inconnu ≠ lu
    expect(isRead({ ...a, unreadCount: 0 })).toBe(true);
    expect(unreadTotal(list)).toBe(1);
    expect(unreadTotalLabel(1)).toBe("1 non lu");
    expect(unreadTotalLabel(3)).toBe("3 non lus");
    expect(conversationCountLabel(1)).toBe("1 discussion");
    expect(conversationCountLabel(3)).toBe("3 discussions");
  });

  test("recherche : sujet + participants, accents pliés", () => {
    const list = parseDiscussions(discussionPayload);
    expect(searchDiscussions(list, "economie").map((d) => d.id)).toEqual(["a"]);
    expect(searchDiscussions(list, "camille").map((d) => d.id)).toEqual(["b"]);
    expect(searchDiscussions(list, "   ").length).toBe(4);
  });

  test("aperçu borné, temps lisible, message propre aligné à droite", () => {
    expect(messagePreview("  Bonjour\n\nle   monde  ")).toBe("Bonjour le monde");
    expect(messagePreview("Bonjour le monde", 5)).toBe("Bonjo…");
    expect(messagePreview("", 10)).toBe("");

    const msg = parseMessages(
      JSON.stringify({
        messages: [
          {
            id: "m1",
            discussionId: "a",
            authorName: "",
            body: "Réponse du compte",
            sentAt: "2026-10-10T09:30:00.000Z",
          },
        ],
      }),
    );
    expect(isOwnMessage(msg[0]!)).toBe(true);
    expect(formatLongDate(msg[0]!.sentAt)).toContain("2026");
    expect(formatDateTime(msg[0]!.sentAt)).toContain("2026");
    expect(formatLongDate("pas une date")).toBe("");
  });

  test("messages : corps obligatoire, pièce jointe hors contrat écartée", () => {
    const rows = parseMessages(
      JSON.stringify({
        items: [
          {
            id: "m1",
            discussionId: "a",
            authorName: "M. MARTIN",
            body: "Bonjour",
            sentAt: "2026-10-10T09:30:00Z",
            attachments: [{ id: "att1", label: "sujet.pdf", ref: "homework:1:file:0" }],
          },
          { id: "m2", discussionId: "a", body: "", sentAt: "2026-10-10T09:30:00Z" },
          {
            id: "m3",
            discussionId: "a",
            body: "Photo",
            attachments: [{ id: "a", label: "x", ref: "https://example.test/x" }],
          },
        ],
      }),
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]?.attachments).toHaveLength(1);
    expect(rows[1]?.attachments).toEqual([]);
  });

  test("destinataires groupés, types traduits, repli honnête", () => {
    const canonical = parseRecipients(
      JSON.stringify({
        recipients: [
          { id: "r1", displayName: "M. MARTIN", kind: "teacher" },
          { id: "r2", displayName: "Camille", kind: "student" },
          { id: "r3", displayName: "Vie scolaire", kind: "administration" },
          { id: "r4", displayName: "Inconnu", kind: "autre" },
        ],
      }),
    );
    const groups = groupRecipients(canonical);
    expect(groups.map((g) => g.label)).toEqual(["Professeurs", "Élèves", "Administration", "Destinataire"]);
    expect(groups[0]?.recipients.map((r) => r.id)).toEqual(["r1"]);

    const mock = parseRecipients(JSON.stringify({ items: [{ id: "r1", name: "M. MARTIN C." }] }));
    expect(mock[0]?.displayName).toBe("M. MARTIN C.");
    expect(groupRecipients(mock)[0]?.label).toBe("Destinataire");
    expect(pickedCountLabel(0)).toBe("0 destinataire");
    expect(pickedCountLabel(2)).toBe("2 destinataires");
  });
});

describe("vie scolaire — absences, retards, sanctions", () => {
  const attendancePayload = JSON.stringify({
    absences: [
      {
        id: "a1",
        kind: "absence",
        date: "2026-10-12T08:00:00+02:00",
        dateEnd: "2026-10-12T12:00:00+02:00",
        durationMinutes: 240,
        justified: true,
        motif: "Maladie",
        subject: "Maths",
        periodId: "p1",
      },
      {
        id: "a2",
        kind: "late",
        date: "2026-10-15T08:00:00+02:00",
        durationMinutes: 20,
        justified: false,
        motif: "Transport",
      },
      { id: "a3", kind: "late", date: "2026-10-16", justified: null, motif: "" },
      { id: "a4", kind: "absence", date: "2026-13-01", durationMinutes: 60, justified: false },
      {
        id: "a5",
        kind: "absence",
        date: "2026-10-10T08:00:00Z",
        dateEnd: "2026-10-09T08:00:00Z",
      },
      { id: "a6", kind: "delay", date: "2026-10-17", justified: true },
    ],
    periods: [{ periodId: "p1", name: "Trimestre 1", absences: 1, late: 1, missingMinutes: 260 }],
  });

  test("lit, borne et écarte les événements hors contrat", () => {
    const data = parseAttendance(attendancePayload);
    expect(data.absences.map((a) => a.id)).toEqual(["a6", "a3", "a2", "a1"]);
    expect(data.absences.find((a) => a.id === "a6")?.kind).toBe("late");
    expect(data.absences.some((a) => a.id === "a4")).toBe(false); // date illisible
    expect(data.absences.some((a) => a.id === "a5")).toBe(false); // fin avant début
    expect(data.periods[0]?.name).toBe("Trimestre 1");
    expect(parseAttendance("{cassé")).toEqual({ absences: [], periods: [] });
  });

  test("repli `items` du pont factice", () => {
    const data = parseAttendance(
      JSON.stringify({
        items: [{ id: "x", kind: "delay", date: "2026-10-15T08:00:00Z", durationMinutes: 20, justified: false }],
      }),
    );
    expect(data.absences).toHaveLength(1);
    expect(data.absences[0]?.kind).toBe("late");
  });

  test("compteurs : justifié, injustifié, non affirmé", () => {
    const rows = parseAttendance(attendancePayload).absences;
    const status = attendanceStatus(rows);
    expect(status.eventCount).toBe(4);
    expect(status.absenceCount).toBe(1);
    expect(status.lateCount).toBe(3);
    expect(status.totalMinutes).toBe(260);
    expect(status.justifiedCount).toBe(2);
    expect(status.unjustifiedCount).toBe(1);
    expect(status.unverifiedCount).toBe(1);
    expect(status.unjustifiedMinutes).toBe(20);
    expect(status.state).toBe("unjustified");
    expect(status.detail).toContain("20 min sur 4 h 20 min");
    expect(isUnjustified(rows.find((r) => r.id === "a3")!)).toBe(false);

    // Une justification NON affirmée reste inconnue : l'écran ne peut pas
    // dire « toutes justifiées » (le natif ne publie `justified: false`).
    const unknown = attendanceStatus(rows.filter((r) => r.justified !== false));
    expect(unknown.state).toBe("unverified");
    expect(unknown.title).toBe("Des heures non vérifiées");
    expect(unknown.detail).not.toContain("justifiées");
    expect(unknown.pendingCount).toBe(1);

    const clean = attendanceStatus(rows.filter((r) => r.justified === true));
    expect(clean.state).toBe("clean");
    expect(clean.title).toBe("Aucune heure injustifiée");
    expect(clean.detail).toContain("sont justifiés");
  });

  test("sections fixes : absences puis retards, vides omises", () => {
    const rows = parseAttendance(attendancePayload).absences;
    expect(attendanceSections(rows).map((s) => [s.title, s.rows.length])).toEqual([
      ["Absences", 1],
      ["Retards", 3],
    ]);
    expect(attendanceSections([])).toEqual([]);
    expect(absenceTitle(rows.find((r) => r.id === "a1")!)).toBe("Maladie");
    expect(absenceTitle(rows.find((r) => r.id === "a2")!)).toBe("Transport");
    expect(justifiedLabel(true)).toBe("justifiée");
    expect(justifiedLabel(false)).toBe("non justifiée");
    expect(justifiedLabel(null)).toBe("");
  });

  test("durées et étendue de dates", () => {
    expect(durationLongFr(0)).toBe("0 min");
    expect(durationLongFr(45)).toBe("45 min");
    expect(durationLongFr(60)).toBe("1 h");
    expect(durationLongFr(252)).toBe("4 h 12 min");
    expect(durationLongFr(-4)).toBe("0 min");

    const rows = parseAttendance(attendancePayload).absences;
    const sameDay = formatDateSpan(rows.find((r) => r.id === "a1")!);
    expect(sameDay).toContain(formatLongDate("2026-10-12T08:00:00+02:00"));
    expect(sameDay).toContain("·");
    expect(sameDay).toContain("–");

    const noTime = formatDateSpan({
      id: "x",
      kind: "absence",
      date: "2026-10-12",
      dateEnd: "2026-10-12",
      subject: null,
      motif: null,
      minutes: null,
      justified: null,
      periodId: null,
    });
    expect(noTime).toBe(formatLongDate("2026-10-12"));

    const multiDay = formatDateSpan({
      id: "y",
      kind: "absence",
      date: "2026-10-12T08:00:00Z",
      dateEnd: "2026-10-14T12:00:00Z",
      subject: null,
      motif: null,
      minutes: null,
      justified: null,
      periodId: null,
    });
    expect(multiDay).toContain("→");

    expect(formatDateSpan({ ...rows[0]!, date: "illisible" })).toBe("");
  });

  test("sanctions : date, motif, durée (jamais un niveau de gravité)", () => {
    const rows = parsePunishments(
      JSON.stringify({
        punishments: [
          {
            id: "p1",
            date: "2026-10-02T10:00:00Z",
            type: "Avertissement",
            motif: "Bavardage",
            durationMinutes: 120,
          },
          {
            id: "p2",
            date: "2026-10-05",
            type: "Exclusion",
            motif: "Perturbation",
            durationMinutes: 90,
          },
          { id: "p3", date: "pas une date", type: "X", motif: "Y" },
          { id: "p4", date: "2026-10-01", type: "", motif: "Y" },
        ],
      }),
    );
    expect(rows.map((p) => p.id)).toEqual(["p2", "p1"]);
    expect(rows[0]?.durationMinutes).toBe(90);
    expect(rows[1]?.durationMinutes).toBe(120);
    expect(parsePunishments(null)).toEqual([]);
    expect(parsePunishments(JSON.stringify({ items: [] }))).toEqual([]);
  });

  test("capacités : contrat, repli factice, ou liste directe", () => {
    expect(parseCapabilities(JSON.stringify({ capabilities: { tabs: ["grades", "punishments"] } }))).toEqual([
      "grades",
      "punishments",
    ]);
    expect(parseCapabilities(JSON.stringify({ items: { tabs: ["attendance"] } }))).toEqual(["attendance"]);
    expect(parseCapabilities(JSON.stringify({ tabs: ["punishments"] }))).toEqual(["punishments"]);
    // Inconnu ≠ liste vide (#413) : un payload illisible n'affirme RIEN, donc
    // rien n'est masqué. Une liste vide, elle, est un contrat AFFIRMÉ.
    expect(parseCapabilities("{}")).toBeNull();
    expect(parseCapabilities(null)).toBeNull();
    expect(parseCapabilities(JSON.stringify({ capabilities: null }))).toBeNull();
    expect(parseCapabilities(JSON.stringify({ capabilities: { tabs: [] } }))).toEqual([]);
  });

  // #413 : Capabilities inconnues = rien n'est affirmé = rien n'est masqué.
  // La sanction ne disparaît pas sur une panne (ni sur un contrat invalide
  // publié comme `capabilities: null` par le natif).
  test("la sanction reste visible quand les capacités sont inconnues", () => {
    expect(sanctionsVisible(null)).toBe(true);
    expect(sanctionsVisible(parseCapabilities(JSON.stringify({ capabilities: null })))).toBe(true);
    expect(sanctionsVisible(parseCapabilities("{}"))).toBe(true);
    // Une liste AFFIRMÉE qui n'a pas l'onglet, elle, masque la sanction.
    expect(sanctionsVisible(parseCapabilities(JSON.stringify({ capabilities: { tabs: ["grades"] } })))).toBe(
      false,
    );
    expect(sanctionsVisible(parseCapabilities(JSON.stringify({ capabilities: { tabs: [] } })))).toBe(false);
  });
});

describe("écrans — garde-fous de source", () => {
  const routes = ["routes/messages.tsx", "routes/attendance.tsx", "routes/sanctions.tsx"];
  const features = [
    "features/messages/model.ts",
    "features/messages/MessagesScreen.tsx",
    "features/attendance/model.ts",
    "features/attendance/SchoolLifeScreens.tsx",
  ];

  test("aucun réseau, aucun HTML injecté", () => {
    for (const file of [...routes, ...features]) {
      const source = read(file);
      expect(source, file).not.toContain("dangerouslySetInnerHTML");
      expect(source, file).not.toMatch(/\bfetch\s*\(/);
      expect(source, file).not.toMatch(/\bXMLHttpRequest\b/);
      expect(source, file).not.toMatch(/\bWebSocket\b/);
      expect(source, file).not.toMatch(/\beval\s*\(/);
    }
  });

  test("les routes passent par le pont natif et les ressources offline-first", () => {
    const messages = read("routes/messages.tsx");
    for (const method of [
      "bridge.messages()",
      "bridge.thread(",
      "bridge.reply(",
      "bridge.createMessage(",
      "bridge.setRead(",
      "bridge.deleteMessage(",
      "bridge.recipients()",
    ]) {
      expect(messages, method).toContain(method);
    }
    expect(read("routes/attendance.tsx")).toContain('useResource("attendance")');
    expect(read("routes/sanctions.tsx")).toContain('useResource("punishments")');
  });

  test("confirmation de suppression et cibles tactiles", () => {
    const messages = read("features/messages/MessagesScreen.tsx");
    expect(messages).toContain('role="alertdialog"');
    expect(messages).toContain("Supprimer la discussion");
    // 48 px minimum sur les contrôles interactifs de la messagerie.
    expect(messages).toContain("minHeight: 48");
    expect(read("features/attendance/SchoolLifeScreens.tsx")).toContain("minHeight: 48");
    // Le retour du fil ramène à la liste sans quitter la route (sentinelle
    // d’historique de même URL, consommée par le retour système).
    expect(messages).toContain("Retour à la liste des discussions");
    expect(read("routes/messages.tsx")).toContain("window.history.pushState");
    expect(read("routes/messages.tsx")).toContain('addEventListener("popstate"');
  });
});
