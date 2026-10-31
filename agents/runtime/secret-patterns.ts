// Motifs du scan anti-secrets, partagés par `check-secrets.ts` et ses tests.
//
// Deux jeux :
//   PATTERNS          — dépôt propre : strict, un en-tête PEM suffit.
//   VENDORED_PATTERNS — `.agents/` : la doc tierce IMITE des secrets (PEM sans
//                       corps, clé AWS d'exemple, faux token), donc on exige la
//                       VRAIE preuve (corps de clé, longueur plausible).
//
// Le carve-out est étroit : une clé complète, un token GitHub/Slack ou un vrai
// storageState restent détectés DANS `.agents/`.
export interface SecretPattern {
  name: string;
  re: RegExp;
}

export const PATTERNS: SecretPattern[] = [
  { name: "private-key", re: /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { name: "openrouter-key", re: /sk-or-v1-[A-Za-z0-9]{8,}/ },
  { name: "env-assign", re: /(OPENROUTER_API_KEY|MASTER_KEY|PRONOTE_PASSWORD|MANUAL_PASSWORD)\s*=\s*[^$\s][^\n]{3,}/ },
  { name: "storageState", re: /storageState.*(token|session|cookie)/i },
  { name: "github-token", re: /gh[pousr]_[A-Za-z0-9]{30,}/ },
  { name: "slack-token", re: /xox[baprs]-[A-Za-z0-9-]{20,}/ },
  // Clé AWS d'exemple canonique (doc AWS) : exclue, elle n'ouvre rien.
  { name: "aws-key", re: /AKIA(?!IOSFODNN7EXAMPLE)[0-9A-Z]{16}/ },
  // JWT : trois segments base64url. Un cours qui parle de JWT n'en a pas.
  { name: "jwt", re: /eyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}/ },
  // Identifiants dans une URL : `https://user:pass@host/`. 8 caractères mini,
  // pour ignorer « user:pass@ » des tests et des docs.
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
  // JWT : trois segments base64url d'une longueur plausible, préfixe `eyJ`
  // (base64 de `{"`, propre à un header). Un cours qui MENTIONNE un JWT n'en a pas.
  { name: "jwt", re: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ },
  // Identifiants dans une URL : 12 caractères mini, sinon les exemples de doc
  // (« user:password@ », « user:changeme@ ») seraient signalés.
  { name: "url-credential", re: /https?:\/\/[^\s/:@"]+:[^\s/@"]{12,}@/ },
  { name: "credential-literal", re: /(api[_-]?key|secret|token|password|passwd|pwd)\s*[:=]\s*["']([A-Za-z0-9+/=_-]{32,})["']/i },
];

// ponytail: allowlist placeholders docs légitimes. Upgrade: gitleaks.
export const PLACEHOLDER_RE = /your|example|placeholder|x{3,}|<[^>]*>|TODO|change-?me|dummy/i;
// Valeur manifestement factice : on ignore le MOT entier, pas un fragment
// (un "xxx" au milieu d'une vraie clé base64 ne l'innocente pas).
export const VALUE_PLACEHOLDER_RE = /^(your|example|dummy|mock|test|changeme|placeholder|xxx)/i;

export const VENDORED_DIRS = [".agents/"];

export function patternsFor(rel: string): SecretPattern[] {
  const inVendored = VENDORED_DIRS.some((d) => rel === d.slice(0, -1) || rel.startsWith(d));
  return inVendored ? VENDORED_PATTERNS : PATTERNS;
}

/**
 * Tous les matchs d'un motif (recompilé en global : `matchAll` l'exige).
 * Inspecter le seul PREMIER match laissait un placeholder en tête de fichier
 * excuser le fichier ENTIER, secret compris.
 */
function allMatches(content: string, re: RegExp): RegExpExecArray[] {
  const global = re.flags.includes("g") ? re : new RegExp(re.source, `${re.flags}g`);
  return [...content.matchAll(global)];
}

export function matchPatterns(content: string, patterns: SecretPattern[]): string[] {
  const hits: string[] = [];
  for (const { name, re } of patterns) {
    const all = allMatches(content, re);
    if (!all.length) continue;
    if (name === "env-assign") {
      // Lignes PLACEHOLDER ignorées, les autres échouent. Le test porte sur la
      // VALEUR ENTIÈRE, ancré à son début : sinon `MASTER_KEY=prod-example-x`
      // passait parce qu'un mot de placeholder y figurait.
      const bad = content.split("\n").filter((l) => {
        if (!re.test(l)) return false;
        const value = l.split("=").slice(1).join("=");
        return !VALUE_PLACEHOLDER_RE.test(value.trim());
      });
      if (!bad.length) continue;
    }
    if (name === "credential-literal") {
      // TOUS les matchs inspectés : un placeholder n'excuse plus le fichier.
      const reels = all.filter((m) => !VALUE_PLACEHOLDER_RE.test(m[2] ?? ""));
      if (!reels.length) continue;
    }
    hits.push(name);
  }
  return hits;
}
