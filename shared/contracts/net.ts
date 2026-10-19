// Garde SSRF partagée (issue #362) — contrat ET serveur, UNE implémentation.
//
// Pourquoi un module partagé : la garde était DUPLIQUÉE (contrat + scraper).
// Les deux copies ne testaient que des chaînes IPv4 littérales, alors que
// `new URL()` NORMALISE l'hôte : "127.0.0.1" devient "[::ffff:7f00:1]",
// "2130706433" et "0x7f000001" deviennent "127.0.0.1". La boucle locale
// passait donc la garde (constaté : l'extrait contenait le corps d'un service
// interne). Une seule implémentation = un seul trou possible.
//
// Périmètre : hôte LITTÉRAL privé/interne (loopback, RFC1918, link-local,
// métadonnées cloud, ULA IPv6, IPv4-mapped IPv6, formes entières/hexadécimales
// /octales). Un nom DNS reste ACCEPTÉ ICI : cette garde est LITTÉRALE (elle
// vit dans un validateur synchrone, donc sans E/S). C'est le SERVEUR qui
// résout le nom avant la navigation — `server/infrastructure/ssrf.ts`
// (issue #419) : le nom est résolu et chaque adresse obtenue est testée
// contre les plages privées.
// ponytail: analyse lexicale pure, zéro dépendance, zéro résolution DNS.
// Upgrade: (déjà fait côté serveur) résolution DNS + re-test à chaque
// redirection (cf. `assertPublicUrl` côté serveur).

/** Partie d'adresse IPv4 : décimal, hexadécimal (0x…) ou octal (0177…). */
function ipv4Part(part: string): number | null {
  if (/^0[xX][0-9a-fA-F]+$/.test(part)) return Number.parseInt(part.slice(2), 16);
  if (/^0[0-7]+$/.test(part)) return Number.parseInt(part.slice(1), 8);
  if (/^[0-9]+$/.test(part)) return Number(part);
  return null;
}

/**
 * "1.2.3.4" | "2130706433" | "0x7f000001" | "0177.0.0.1" | "127.1" -> 4 octets.
 * La dernière partie absorbe les octets manquants (127.1 = 127.0.0.1), comme
 * la spec WHATWG : c'est ce qui fait que "2130706433" = 127.0.0.1.
 */
function parseIPv4(host: string): number[] | null {
  const parts = host.split(".");
  if (parts.length < 1 || parts.length > 4) return null;
  const nums: number[] = [];
  for (const part of parts) {
    const n = ipv4Part(part);
    if (n === null || !Number.isInteger(n) || n < 0) return null;
    nums.push(n);
  }
  const last = nums.length - 1;
  for (let i = 0; i < last; i += 1) if ((nums[i] ?? 0) > 255) return null;
  if ((nums[last] ?? 0) >= 256 ** (5 - nums.length)) return null;
  const tail: number[] = [];
  let v = nums[last] ?? 0;
  for (let i = 0; i < 4 - last; i += 1) {
    tail.unshift(v % 256);
    v = Math.floor(v / 256);
  }
  return [...nums.slice(0, last), ...tail];
}

/** IPv4-mapped : ::ffff:127.0.0.1 -> [127,0,0,1]. */
function ipv6TailToIPv4(g: readonly number[]): number[] {
  const hi = g[6] ?? 0;
  const lo = g[7] ?? 0;
  return [hi >> 8, hi & 0xff, lo >> 8, lo & 0xff];
}

/** Plages IPv4 privées/réversées : jamais une cible de scrape. */
function isBlockedIPv4(b: readonly number[]): boolean {
  const a = b[0] ?? 0;
  const s = b[1] ?? 0;
  const t = b[2] ?? 0;
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 10) return true; // 10/8
  if (a === 100 && s >= 64 && s <= 127) return true; // 100.64/10 (CGNAT)
  if (a === 127) return true; // 127/8 (loopback)
  if (a === 169 && s === 254) return true; // 169.254/16 (link-local + métadonnées)
  if (a === 172 && s >= 16 && s <= 31) return true; // 172.16/12
  if (a === 192 && s === 168) return true; // 192.168/16
  if (a === 192 && s === 0 && (t === 0 || t === 2)) return true; // 192.0.0/24, 192.0.2/24
  if (a === 192 && s === 88 && t === 99) return true; // 192.88.99/24
  if (a === 198 && (s === 18 || s === 19)) return true; // 198.18/15
  if (a === 198 && s === 51 && t === 100) return true; // 198.51.100/24
  if (a === 203 && s === 0 && t === 113) return true; // 203.0.113/24
  if (a >= 224) return true; // 224/4 multicast + 240/4 réservé
  return false;
}

/** Groupe IPv6 hexadécimal (1..4 chiffres). */
function hex16(part: string): number | null {
  if (!/^[0-9a-fA-F]{1,4}$/.test(part)) return null;
  return Number.parseInt(part, 16);
}

/** IPv6 littéral -> 8 groupes de 16 bits ("::ffff:127.0.0.1" compris). */
function parseIPv6(host: string): number[] | null {
  let s = host.split("%")[0] ?? ""; // zone id (fe80::1%eth0) : ignorée
  if (!s.includes(":")) return null;
  const withV4 = /^(.*:)(\d{1,3}(?:\.\d{1,3}){3})$/.exec(s);
  if (withV4) {
    const bytes = parseIPv4(withV4[2] ?? "");
    if (!bytes) return null;
    const hi = ((bytes[0] ?? 0) << 8) | (bytes[1] ?? 0);
    const lo = ((bytes[2] ?? 0) << 8) | (bytes[3] ?? 0);
    s = `${withV4[1] ?? ""}${hi.toString(16)}:${lo.toString(16)}`;
  }
  const groups: number[] = [];
  const dbl = s.indexOf("::");
  if (dbl >= 0) {
    if (s.indexOf("::", dbl + 1) >= 0) return null; // deux « :: »
    const head = s.slice(0, dbl);
    const tail = s.slice(dbl + 2);
    const headParts = head === "" ? [] : head.split(":");
    const tailParts = tail === "" ? [] : tail.split(":");
    if (headParts.length + tailParts.length > 7) return null; // « :: » doit compresser
    for (const p of headParts) {
      const g = hex16(p);
      if (g === null) return null;
      groups.push(g);
    }
    for (let i = 0; i < 8 - headParts.length - tailParts.length; i += 1) groups.push(0);
    for (const p of tailParts) {
      const g = hex16(p);
      if (g === null) return null;
      groups.push(g);
    }
    return groups.length === 8 ? groups : null;
  }
  const parts = s.split(":");
  if (parts.length !== 8) return null;
  for (const p of parts) {
    const g = hex16(p);
    if (g === null) return null;
    groups.push(g);
  }
  return groups;
}

/** Plages IPv6 privées/réversées : jamais une cible de scrape. */
function isBlockedIPv6(g: readonly number[]): boolean {
  const zero = (from: number, to: number): boolean => {
    for (let i = from; i <= to; i += 1) if ((g[i] ?? 0) !== 0) return false;
    return true;
  };
  if (zero(0, 7)) return true; // :: (non spécifié)
  if (zero(0, 6) && (g[7] ?? 0) === 1) return true; // ::1 (loopback)
  if (zero(0, 4) && (g[5] ?? 0) === 0xffff) return isBlockedIPv4(ipv6TailToIPv4(g)); // ::ffff:a.b.c.d
  if (zero(0, 5)) return isBlockedIPv4(ipv6TailToIPv4(g)); // ::a.b.c.d (déprécié)
  if ((g[0] ?? 0) === 0x0064 && (g[1] ?? 0) === 0xff9b && zero(2, 5)) {
    return isBlockedIPv4(ipv6TailToIPv4(g)); // 64:ff9b::/96 (NAT64)
  }
  if ((g[0] ?? 0) === 0x2002) {
    // 6to4 : IPv4 embarqué dans les groupes 1-2.
    const hi = g[1] ?? 0;
    const lo = g[2] ?? 0;
    return isBlockedIPv4([hi >> 8, hi & 0xff, lo >> 8, lo & 0xff]);
  }
  if ((g[0] ?? 0) === 0x2001 && (g[1] ?? 0) === 0x0db8) return true; // 2001:db8::/32
  if ((g[0] ?? 0) === 0x2001 && (g[1] ?? 0) <= 0x01ff) return true; // 2001::/23 (Teredo)
  if ((g[0] ?? 0) === 0x0100 && zero(1, 3)) return true; // 100::/64 (discard)
  if (((g[0] ?? 0) & 0xfe00) === 0xfc00) return true; // fc00::/7 (ULA)
  if (((g[0] ?? 0) & 0xffc0) === 0xfe80) return true; // fe80::/10 (link-local)
  if (((g[0] ?? 0) & 0xffc0) === 0xfec0) return true; // fec0::/10 (site-local, déprécié)
  if (((g[0] ?? 0) & 0xff00) === 0xff00) return true; // ff00::/8 (multicast)
  return false;
}

/**
 * Hôte privé/interne ? Couvre IPv4 (littéral, entier, hex, octal), IPv6
 * (mapped, ULA, link-local, multicast) et les noms de loopback. Un nom DNS
 * public est accepté (garde LITTÉRALE : la résolution DNS est faite par le
 * serveur, cf. `server/infrastructure/ssrf.ts`).
 */
export function isBlockedHost(host: string): boolean {
  let h = host.trim().toLowerCase();
  if (h === "") return true; // hôte vide : refus par prudence
  if (h.startsWith("[") && h.endsWith("]")) h = h.slice(1, -1);
  if (h.endsWith(".")) h = h.slice(0, -1); // FQDN point final
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  if (h.endsWith(".local") || h.endsWith(".internal")) return true; // mDNS / réseau interne
  if (h.includes(":")) {
    const groups = parseIPv6(h);
    return groups === null ? true : isBlockedIPv6(groups); // IPv6 illisible = refus
  }
  const v4 = parseIPv4(h);
  if (v4) return isBlockedIPv4(v4);
  if (/^[0-9.]+$/.test(h) || /^0[xX]/.test(h)) return true; // numérique illisible = refus
  return false;
}

/**
 * L'hôte est-il un LITTÉRAL IP (v4 ou v6) ? Une adresse ne se résout pas :
 * le dialogue est direct. Sert à ne pas demander une résolution DNS d'un
 * littéral — et à ne pas casser les IPv6 littéraux publics, que le
 * résolveur refuserait entre crochets (`[2606:4700::1111]`).
 */
export function isIpLiteral(host: string): boolean {
  let h = host.trim().toLowerCase();
  if (h === "") return false;
  if (h.startsWith("[") && h.endsWith("]")) h = h.slice(1, -1);
  if (h.endsWith(".")) h = h.slice(0, -1); // FQDN point final
  if (h.includes(":")) return parseIPv6(h) !== null;
  return parseIPv4(h) !== null;
}

/** URL http(s) PUBLIQUE ? (protocole + hôte non privé/interne). */
export function isPublicHttpUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  return !isBlockedHost(u.hostname);
}
