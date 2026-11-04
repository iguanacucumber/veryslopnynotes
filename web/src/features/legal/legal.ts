// Faits publics des écrans légaux : une source unique pour les URL et les
// fichiers de licence. Aucune version ni adresse inventée ici : la version
// vient du pont, les contacts sont ceux publiés par le dépôt.

export const REPO_URL = "https://github.com/iguanacucumber/veryslopnynotes";
export const SUPPORT_URL = `${REPO_URL}/issues/new/choose`;
export const SECURITY_URL = `${REPO_URL}/security/advisories/new`;

export interface LicenseText {
  file: string;
  label: string;
  detail: string;
}

/** Textes livrés dans `web/public/licenses/` (donc dans l'APK) et rendus dans
 *  l'écran Licences. */
export const LICENSE_TEXTS: readonly LicenseText[] = [
  {
    file: "APP-GPL-3.0-ONLY.txt",
    label: "GNU GPL v3.0 seulement",
    detail: "VerySlopyNyNotes",
  },
  {
    file: "APACHE-2.0.txt",
    label: "Apache License 2.0",
    detail: "AndroidX, OkHttp, ZXing",
  },
  {
    file: "REACT-MIT.txt",
    label: "MIT",
    detail: "React, React DOM",
  },
  {
    file: "REACT-ROUTER-DOM-MIT.txt",
    label: "MIT",
    detail: "React Router DOM",
  },
  {
    file: "PRONOTETS-MIT.txt",
    label: "MIT",
    detail: "pronotets",
  },
  {
    file: "ROLLDOWN-MIT.txt",
    label: "MIT",
    detail: "Rolldown",
  },
  {
    file: "PAPICONS-MIT.txt",
    label: "MIT",
    detail: "Papicons",
  },
  {
    file: "SN-PRO-OFL.txt",
    label: "SIL Open Font License 1.1",
    detail: "SN Pro",
  },
];

/** Les fichiers légaux sont rédigés à ~80 colonnes : le parseur borné traite
 *  chaque ligne comme un bloc. On recolle donc les lignes de continuation
 *  avant analyse (listes, citations et paragraphes). */
export function reflowLegalMarkdown(markdown: string): string {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  const blockStart = /^\s*(?:#{1,6}\s|>\s?|[-+*]\s|\d{1,9}[.)]\s|\||```|\$\$|\\\[)/;
  for (const raw of lines) {
    const line = raw.trimEnd();
    const previous = out[out.length - 1];
    if (previous !== undefined && previous.trim() && line.trim()) {
      if (/^>\s?/.test(previous) && /^>\s?/.test(line)) {
        out[out.length - 1] = `${previous.replace(/\s+$/, "")} ${line.replace(/^>\s?/, "")}`;
        continue;
      }
      const listContinuation =
        /^\s*(?:[-+*]|\d{1,9}[.)])\s/.test(previous) && !blockStart.test(line);
      if (listContinuation || (!blockStart.test(previous) && !blockStart.test(line))) {
        out[out.length - 1] = `${previous} ${line.trim()}`;
        continue;
      }
    }
    out.push(line);
  }
  return out.join("\n");
}
