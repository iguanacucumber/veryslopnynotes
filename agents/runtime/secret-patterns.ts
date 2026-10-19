// Motifs du scan anti-secrets, partagés par `check-secrets.ts` et ses tests.
//
// Deux jeux :
//   PATTERNS          — dépôt propre : strict. Un en-tête PEM suffit (un
//                       commentaire qui cite la marque suffit à alerter).
//   VENDORED_PATTERNS — `.agents/` : contenu tiers (skills docs). Leur doc
//                       IMITE des secrets — en-tête PEM sans corps, clé AWS
//                       d'exemple, storageState Playwright, faux token — donc
//                       le jeu strict y hurle sans raison. Ici on exige la
//                       VRAIE preuve : un corps de clé PEM, un token d'une
//                       longueur plausible, un littéral de credential long.
//
// Le carve-out est volontairement étroit : une clé RSA complète, un token
// GitHub/Slack, un vrai storageState ou un mot de passe long restent
// détectés DANS `.agents/`. Seuls les exemples de documentation passent.
export interface SecretPattern {
  name: string;
  re: RegExp;
}

export const PATTERNS: SecretPattern[] = [
  { name: "private-key", re: /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { name: "openrouter-key", re: /sk-or-v1-[A-Za-z0-9]{8,}/ },
  { name: "env-assign", re: /(OPENROUTER_API_KEY|MASTER_KEY|PRONOTE_PASSWORD|MANUAL_PASSWORD)\s*=\s*[^$\s][^\n]{3,}/ },
  { name: "storageState", re: /storageState.*(token|session|cookie)/i },
];

export const VENDORED_PATTERNS: SecretPattern[] = [
  { name: "private-key", re: /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----\n[A-Za-z0-9+/=]{32,}/ },
  { name: "openrouter-key", re: /sk-or-v1-[A-Za-z0-9]{8,}/ },
  { name: "env-assign", re: /(OPENROUTER_API_KEY|MASTER_KEY|PRONOTE_PASSWORD|MANUAL_PASSWORD)\s*=\s*[^$\s][^\n]{3,}/ },
  { name: "github-token", re: /gh[pousr]_[A-Za-z0-9]{30,}/ },
  { name: "slack-token", re: /xox[baprs]-[A-Za-z0-9-]{20,}/ },
  // Clé AWS d'exemple canonique (doc AWS) : exclue, elle n'ouvre rien.
  { name: "aws-key", re: /AKIA(?!IOSFODNN7EXAMPLE)[0-9A-Z]{16}/ },
  // storageState RÉEL : un tableau de cookies. La doc montre `{ cookies: [] }`.
  { name: "storageState", re: /"cookies"\s*:\s*\[\s*\{/ },
  { name: "credential-literal", re: /(api[_-]?key|secret|token|password|passwd|pwd)\s*[:=]\s*["']([A-Za-z0-9+/=_-]{32,})["']/i },
];

// ponytail: allowlist placeholders docs légitimes. Upgrade: gitleaks.
export const PLACEHOLDER_RE = /your|example|placeholder|x{3,}|<[^>]*>|TODO|change-?me|dummy/i;
// Valeur manifestement factice : on ignore le MOT entier, pas un fragment
// (un "xxx" au milieu d'une vraie clé base64 ne l'innocente pas).
export const VALUE_PLACEHOLDER_RE = /^(your|example|dummy|mock|test|changeme|placeholder|xxx)/i;

/** Répertoires de contenu tiers : les motifs y sont assouplis (voir tête). */
export const VENDORED_DIRS = [".agents/"];

/** Jeu de motifs applicable au chemin repo-relative `rel`. */
export function patternsFor(rel: string): SecretPattern[] {
  const inVendored = VENDORED_DIRS.some((d) => rel === d.slice(0, -1) || rel.startsWith(d));
  return inVendored ? VENDORED_PATTERNS : PATTERNS;
}

/** Noms des motifs qui matchent `content` pour le jeu donné. */
export function matchPatterns(content: string, patterns: SecretPattern[]): string[] {
  const hits: string[] = [];
  for (const { name, re } of patterns) {
    const m = content.match(re);
    if (!m) continue;
    if (name === "env-assign") {
      // Ignore lignes placeholders (docs légitimes), échoue sinon.
      const bad = m.input!.split("\n").filter(
        (l) => re.test(l) && !PLACEHOLDER_RE.test(l.split("=").slice(1).join("=")),
      );
      if (!bad.length) continue;
    }
    if (name === "credential-literal" && VALUE_PLACEHOLDER_RE.test(m[2] ?? "")) continue;
    hits.push(name);
  }
  return hits;
}
