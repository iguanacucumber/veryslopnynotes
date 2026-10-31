// Garde SSRF avec RÉSOLUTION DNS.
//
// La garde littérale (`shared/contracts/net.ts`) refuse les IP privées, mais un
// NOM public qui résout vers une IP privée (`nip.io`, `localtest.me`, DNS
// interne) passait : le navigateur partait vers l'adresse interne.
//
// Ici le nom est RÉSOLU, puis CHAQUE adresse obtenue est testée contre les
// plages privées/réservées. Un nom dont UNE seule adresse est privée est
// refusé : le navigateur peut très bien choisir celle-là.
//
// ponytail: `dns.lookup` (résolveur du système, comme Chromium) + un
// résolveur INJECTABLE (les tests ne touchent jamais le réseau).
//
// Fenêtre TOCTOU RÉSIDUELLE : la résolution est vérifiée ICI, mais le
// navigateur (et le `fetch` de la chaîne de redirections) résout de son côté,
// au moment de la connexion. Un enregistrement DNS qui change entre les deux
// peut donc faire partir la connexion vers une IP interne alors que la
// vérification a vu une IP publique. La fenêtre est réelle, elle est courte,
// et elle n'est pas fermable sans épingler l'adresse.
// Upgrade: épingler l'adresse résolue (connecter l'IP en gardant l'en-tête
// Host, ou des `--host-resolver-rules` pour Chromium) pour fermer cette
// fenêtre.
import { lookup } from "node:dns/promises";
import { isBlockedHost, isIpLiteral } from "../../shared/contracts/net";

/** Résolveur injectable : les tests fournissent un faux (aucune requête DNS). */
export type HostResolver = (host: string) => Promise<readonly string[]>;

/**
 * Résolveur système (NSS, `/etc/hosts`), comme le navigateur ; `all` pour
 * toutes les adresses (A et AAAA), `verbatim` pour garder l'ordre des familles.
 */
export const systemResolver: HostResolver = async (host: string) => {
  const entries = await lookup(host, { all: true, verbatim: true });
  return entries.map((entry) => entry.address);
};

export type HostVerdict =
  /** Hôte public : aucune adresse privée obtenue. */
  | "public"
  /** Littéral privé, ou nom qui résout vers une IP privée. */
  | "private"
  /** Nom introuvable : la navigation n'aboutirait de toute façon pas. */
  | "unresolved";

/** Un nom est résolu, puis CHAQUE adresse obtenue est testée. */
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
