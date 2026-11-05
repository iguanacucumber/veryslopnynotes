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
  // Hôte d'établissement Pronote : `<etab>.index-education.net`. La démo et le
  // hub sont allowlistés, un vrai établissement est une donnée d'école.
  { name: "pronote-host", re: /\b(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+index-education\.(?:net|fr)\b/i },
  // IPv4 PUBLIQUE : octets validés, sans zéro de tête (sinon une suite de
  // chiffres de SVG « 3.24.091.008 » passerait pour une adresse).
  {
    name: "ipv4",
    re: /(?<![\d.])(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}(?![\d.])/,
  },
  // E-mail en clair. Domaine en minuscules : `this@VsnBridge.reject` (label
  // Kotlin) n'est pas une adresse. Un `user@host` d'URL est exclu juste avant.
  {
    name: "email",
    re: /(?<![A-Za-z0-9._%+:/@-])([a-z0-9][a-z0-9._%+-]+)@([a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+)/,
  },
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
  { name: "pronote-host", re: /\b(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+index-education\.(?:net|fr)\b/i },
  {
    name: "ipv4",
    re: /(?<![\d.])(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}(?![\d.])/,
  },
  {
    name: "email",
    re: /(?<![A-Za-z0-9._%+:/@-])([a-z0-9][a-z0-9._%+-]+)@([a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+)/,
  },
  { name: "credential-literal", re: /(api[_-]?key|secret|token|password|passwd|pwd)\s*[:=]\s*["']([A-Za-z0-9+/=_-]{32,})["']/i },
];

// Hôtes Pronote admis : la démo publique et le hub d'Index Éducation. Un
// établissement (`<etab>.index-education.net`) est une donnée d'école réelle.
// Assemblé : l'hôte de démo est interdit partout ailleurs (demo-school.test.ts).
export const ALLOWED_PRONOTE_HOSTS = new Set([
  ["demo.", "index-education", ".net"].join(""),
  ["hubeduconnect.", "index-education", ".net"].join(""),
]);

// Domaines de documentation (RFC 2606) : jamais une personne réelle.
const ALLOWED_EMAIL_DOMAINS = new Set(["example.com", "example.net", "example.org"]);
const ALLOWED_EMAIL_SUFFIXES = [".invalid", ".example", ".test", ".localhost"];

// Adresses de boucle locale/privées/réservées (RFC 1918, 5737, 6598) et
// résolveurs publics de doc : jamais une machine d'école.
const ALLOWED_IPS = new Set([
  "0.0.0.0",
  "1.1.1.1",
  "1.2.3.4",
  "8.8.8.8",
  "93.184.216.34", // example.com, l'adresse publique de la doc
]);

export function isAllowedIp(ip: string): boolean {
  if (ALLOWED_IPS.has(ip)) return true;
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b, c] = parts as [number, number, number, number];
  if (a === 10 || a === 127 || a === 0) return true; // privé / boucle / indéfini
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
  if (a === 192 && b === 168) return true; // 192.168/16
  if (a === 169 && b === 254) return true; // lien local
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64/10
  if (a === 192 && b === 0 && c === 2) return true; // TEST-NET-1
  if (a === 198 && b === 51 && c === 100) return true; // TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return true; // TEST-NET-3
  return a >= 224; // multicast/réservé
}

function isAllowedEmailDomain(domain: string): boolean {
  const d = domain.toLowerCase();
  return ALLOWED_EMAIL_DOMAINS.has(d) || ALLOWED_EMAIL_SUFFIXES.some((s) => d.endsWith(s));
}

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
    if (name === "ipv4") {
      if (!all.some((m) => !isAllowedIp(m[0]))) continue;
    }
    if (name === "email") {
      if (!all.some((m) => !isAllowedEmailDomain(m[2] ?? ""))) continue;
    }
    if (name === "pronote-host") {
      // Un hôte allowlisté n'excuse que LUI-MÊME : un établissement plus bas
      // dans le même fichier échoue quand même.
      if (!all.some((m) => !ALLOWED_PRONOTE_HOSTS.has(m[0].toLowerCase()))) continue;
    }
    hits.push(name);
  }
  return hits;
}
