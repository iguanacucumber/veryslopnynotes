// Garde SSRF avec RÉSOLUTION DNS (issue #419).
//
// #362 a rendu la garde LITTÉRALE (`shared/contracts/net.ts`) : IP privées,
// IPv4-mapped IPv6, formes entières/hexadécimales. Mais un NOM public qui
// résout vers une IP privée (`nip.io`, `localtest.me`, un DNS interne) passait
// la garde : le navigateur partait vers l'adresse interne et le corps de la
// réponse revenait dans l'extrait (rebinding DNS).
//
// Ici le nom est RÉSOLU, puis CHAQUE adresse obtenue est testée contre les
// plages privées/réservées. Un nom dont UNE seule adresse est privée est
// refusé : le navigateur peut très bien choisir celle-là.
//
// ponytail: `dns.lookup` (résolveur du système, comme Chromium) + un
// resolveur INJECTABLE (les tests ne touchent jamais le réseau).
// Upgrade: épingler l'adresse résolue (connecter l'IP, garder l'en-tête
// Host) pour fermer la fenêtre TOCTOU entre la vérification et la connexion.
import { lookup } from "node:dns/promises";
import { isBlockedHost, isIpLiteral } from "../../shared/contracts/net";

/**
 * Résolution d'un nom vers ses adresses. `Promise` : la résolution est une
 * E/S réseau, donc asynchrone par nature. Injectable : les tests fournissent
 * un faux résolveur (aucune requête DNS réelle).
 */
export type HostResolver = (host: string) => Promise<readonly string[]>;

/**
 * Résolveur du système (NSS, `/etc/hosts`) : le même que celui du
 * navigateur — `all` pour TOUTES les adresses (A et AAAA), `verbatim` pour
 * ne pas réordonner les familles.
 */
export const systemResolver: HostResolver = async (host: string) => {
  const entries = await lookup(host, { all: true, verbatim: true });
  return entries.map((entry) => entry.address);
};

/** Verdict de la garde sur un hôte. */
export type HostVerdict =
  /** Hôte public : aucune adresse privée obtenue. */
  | "public"
  /** Hôte privé/interne : littéral privé, ou nom qui résout vers une IP privée. */
  | "private"
  /** Nom introuvable : la navigation n'aboutirait de toute façon pas. */
  | "unresolved";

/**
 * L'hôte est-il PUBLIQUE ?
 *
 * - littéral privé/interne -> `private` (garde littérale de #362, sans DNS) ;
 * - littéral public -> `public` (une adresse ne se résout pas) ;
 * - nom -> résolution, puis CHAQUE adresse obtenue est testée ;
 * - nom introuvable -> `unresolved` (jamais un silence : le navigateur
 *   n'atteindrait rien non plus).
 */
export async function checkPublicHost(
  host: string,
  resolve: HostResolver = systemResolver,
): Promise<HostVerdict> {
  if (isBlockedHost(host)) return "private";
  if (isIpLiteral(host)) return "public";
  let addresses: readonly string[];
  try {
    addresses = await resolve(host);
  } catch {
    return "unresolved";
  }
  if (addresses.length === 0) return "unresolved";
  for (const address of addresses) {
    if (isBlockedHost(address)) return "private";
  }
  return "public";
}
