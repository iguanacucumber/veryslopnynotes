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
  // Formes qui manquaient au jeu du dépôt (#503) : elles n'existaient que
  // dans le jeu VENDORED — donc le dossier tiers, le moins contrôlé, était
  // mieux surveillé que le dépôt lui-même.
  { name: "github-token", re: /gh[pousr]_[A-Za-z0-9]{30,}/ },
  { name: "slack-token", re: /xox[baprs]-[A-Za-z0-9-]{20,}/ },
  // Clé AWS d'exemple canonique (doc AWS) : exclue, elle n'ouvre rien.
  { name: "aws-key", re: /AKIA(?!IOSFODNN7EXAMPLE)[0-9A-Z]{16}/ },
  // JWT : trois segments base64url. Un cours qui parle de JWT n'en a pas.
  { name: "jwt", re: /eyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}/ },
  // Identifiants dans une URL : `https://user:pass@host/`. Le mot de passe
  // doit faire 8 caractères ou plus : les ATTACKS DE TEST (« user:pass@ »)
  // sont alors ignorés, comme les exemples de documentation.
  { name: "url-credential", re: /https?:\/\/[^\s/:@"]+:[^\s/@"]{8,}@/ },
  // Littéral de credential : `api_key = "…"`, `password: "…"`.
  { name: "credential-literal", re: /(api[_-]?key|secret|token|password|passwd|pwd)\s*[:=]\s*["']([A-Za-z0-9+/=_-]{32,})["']/i },
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

/**
 * Tous les matchs d'un motif dans le contenu (le motif est recompilé en
 * version globale : `matchAll` l'exige, et on veut TOUS les matchs).
 *
 * #521 : le scan n'inspectait que le PREMIER match de chaque motif — un
 * placeholder en tête de fichier excusait le fichier ENTIER, secret compris.
 */
function allMatches(content: string, re: RegExp): RegExpExecArray[] {
  const global = re.flags.includes("g") ? re : new RegExp(re.source, `${re.flags}g`);
  return [...content.matchAll(global)];
}

/** Noms des motifs qui matchent `content` pour le jeu donné. */
export function matchPatterns(content: string, patterns: SecretPattern[]): string[] {
  const hits: string[] = [];
  for (const { name, re } of patterns) {
    const all = allMatches(content, re);
    if (!all.length) continue;
    if (name === "env-assign") {
      // Ignore les lignes PLACEHOLDER (docs légitimes), échoue sinon.
      //
      // Le test de placeholder porte sur la VALEUR ENTIÈRE, ancré à son
      // début (#503) : avant, il suffisait qu'un mot de placeholder soit
      // PRÉSENT dans la valeur pour que la ligne soit excusée — donc
      // `MASTER_KEY=prod-example-key-9f3a2b` passait. Un vrai secret ne
      // commence pas par « example ».
      const bad = content.split("\n").filter((l) => {
        if (!re.test(l)) return false;
        const value = l.split("=").slice(1).join("=");
        return !VALUE_PLACEHOLDER_RE.test(value.trim());
      });
      if (!bad.length) continue;
    }
    if (name === "credential-literal") {
      // #521 : TOUS les matchs sont inspectés. Le motif ne passe que si
      // AUCUN match n'est un secret réel : un placeholder (premier match)
      // n'excuse plus le fichier entier.
      const reels = all.filter((m) => !VALUE_PLACEHOLDER_RE.test(m[2] ?? ""));
      if (!reels.length) continue;
    }
    hits.push(name);
  }
  return hits;
}
