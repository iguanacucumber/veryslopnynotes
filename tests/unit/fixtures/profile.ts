// Fixtures 100 % synthétiques #82 (profil + accueil). Aucun secret, aucun hôte
// réel, aucune URL Pronote, aucune donnée d'établissement : les ids sont des
// jetons ("acc-fake-*") et la photo est une RÉF OPAQUE `photo:<id>`.
export const syntheticAccountId = "acc-fake-1";

/** Périodes de l'année (contrat #74, déjà servies par /v1/periods). */
export const syntheticPeriods = [
  { id: "per-fake-1", name: "Trimestre 1", start: "2026-09-01T00:00:00.000Z", end: "2026-11-30T23:59:59.000Z" },
  { id: "per-fake-2", name: "Trimestre 2", start: "2026-12-01T00:00:00.000Z", end: "2027-03-31T23:59:59.000Z" },
];

/** Profil élève minimal (photo absente = état propre, pas d'image inventée). */
export const syntheticUserInfo = {
  accountId: syntheticAccountId,
  displayName: "Camille Exemple",
  firstName: "Camille",
  lastName: "Exemple",
  classLabel: "3E-Fake",
  periodId: "per-fake-1",
  periodName: "Trimestre 1",
};

/** Compte parent : deux enfants listés + photo de profil (réF opaque). */
export const syntheticParentUserInfo = {
  accountId: "acc-fake-parent",
  displayName: "Parent Exemple",
  photoRef: "photo:file-fake-1",
  hasKids: true,
  kids: [
    { accountId: "acc-fake-1", displayName: "Camille Exemple", classLabel: "3E-Fake" },
    { accountId: "acc-fake-2", displayName: "Noé Exemple", classLabel: "5A-Fake" },
  ],
};

// --- payload Reader#82 : faux client pronotets (info / children / periods) ---
export function syntheticProfileClient(
  options: {
    name?: string | null;
    className?: string | null;
    pictureId?: string | null;
    kids?: unknown[];
    periods?: unknown[];
    infoThrows?: boolean;
  } = {},
) {
  const {
    name = "Camille Exemple",
    className = "3E-Fake",
    pictureId = "file-fake-1",
    kids = [],
    periods = syntheticPeriods,
    infoThrows = false,
  } = options;
  const info = infoThrows
    ? null
    : {
        id: syntheticAccountId,
        name,
        className,
        // L'URL de la pièce est une donnée Pronote : elle ne doit JAMAIS sortir
        // du serveur (le contrat ne porte que `photo:<id>`).
        profilePicture:
          pictureId === null ? null : { id: pictureId, url: "https://photo.invalid/pic.png", data: async () => new Uint8Array([1, 2, 3]) },
      };
  return { info, children: kids, periods };
}

/** Enfants (ParentClient.children = ClientInfo[]). */
export function syntheticChild(id: string, name: string, className: string | null = null) {
  return { id, name, className };
}

// --- payloads d'accueil (contrats notes / devoirs / EDT, caches existants) ---
const H = (id: string, start: string, end: string, subject: string, room: string) => ({
  id,
  accountId: syntheticAccountId,
  subject,
  room,
  start,
  end,
});

export const syntheticTimetablePayload = {
  entries: [
    H("t-fake-1", "2026-10-05T08:00:00.000Z", "2026-10-05T09:00:00.000Z", "Maths", "B12"),
    H("t-fake-2", "2026-10-03T08:00:00.000Z", "2026-10-03T09:00:00.000Z", "Histoire", ""),
    H("t-fake-3", "2026-10-06T14:00:00.000Z", "2026-10-06T15:00:00.000Z", "Anglais", "C03"),
  ],
};

export const syntheticAssignmentsPayload = {
  assignments: [
    {
      id: "a-fake-1",
      accountId: syntheticAccountId,
      subject: "Français",
      title: "Rédaction",
      dueDate: "2026-10-07T08:00:00.000Z",
      done: false,
    },
    {
      id: "a-fake-2",
      accountId: syntheticAccountId,
      subject: "Maths",
      title: "Exercice 4",
      dueDate: "2026-10-02T08:00:00.000Z",
      done: false,
    },
    {
      id: "a-fake-3",
      accountId: syntheticAccountId,
      subject: "SVT",
      title: "Devoir fait",
      dueDate: "2026-10-20T08:00:00.000Z",
      done: true,
    },
  ],
};

export const syntheticGradesPayload = {
  grades: [
    { id: "g-fake-1", accountId: syntheticAccountId, subject: "Maths", value: 15.5, scale: 20, date: "2026-09-20T10:00:00.000Z" },
    { id: "g-fake-2", accountId: syntheticAccountId, subject: "Français", value: 12, scale: 20, date: "2026-09-28T10:00:00.000Z" },
  ],
  averages: {
    algorithm: "subject",
    periodId: "per-fake-1",
    general: { value: 13.75, origin: "estimated", subjectCount: 2 },
    subjects: [{ subject: "Maths", value: 15.5, origin: "estimated", gradeCount: 1 }],
    history: [{ date: "2026-09-20T10:00:00.000Z", value: 15.5 }],
    influences: [{ gradeId: "g-fake-1", subject: "Maths", impact: 1.5 }],
  },
};