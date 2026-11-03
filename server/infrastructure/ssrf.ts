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
// Fenêtre TOCTOU : l'adresse vérifiée est ÉPINGLÉE pour le document et les
// hôtes de la chaîne de redirections via `--host-resolver-rules` (cf.
// `manuals-scrape.ts`), donc Chromium ne peut pas rebinder ces noms. Les
// sous-ressources, dont l'hôte n'est connu qu'à la requête, restent résolues
// par le navigateur : leur vérification garde la fenêtre courte, et la
// politique d'égression (`docs/architecture/SERVER-EGRESS.md`) la ferme au
// niveau réseau. Upgrade: proxy sortant à liste blanche qui résout et connecte
// lui-même l'adresse validée pour TOUTES les requêtes.
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

/** Verdict + adresses : l'appelant peut épingler une adresse déjà validée. */
export interface HostResolution {
  readonly verdict: HostVerdict;
  /** Adresses publiques validées ; vide pour un littéral public ou un refus. */
  readonly addresses: readonly string[];
}

/** Un nom est résolu, puis CHAQUE adresse obtenue est testée. */
export async function resolvePublicHost(
  host: string,
  resolve: HostResolver = systemResolver,
): Promise<HostResolution> {
  if (isBlockedHost(host)) return { verdict: "private", addresses: [] };
  if (isIpLiteral(host)) return { verdict: "public", addresses: [] };
  let addresses: readonly string[];
  try {
    addresses = await resolve(host);
  } catch {
    return { verdict: "unresolved", addresses: [] };
  }
  if (addresses.length === 0) return { verdict: "unresolved", addresses: [] };
  for (const address of addresses) {
    if (isBlockedHost(address)) return { verdict: "private", addresses: [] };
  }
  return { verdict: "public", addresses };
}

/** Verdict seul : la garde historique, sans exposer l'adresse. */
export async function checkPublicHost(
  host: string,
  resolve: HostResolver = systemResolver,
): Promise<HostVerdict> {
  return (await resolvePublicHost(host, resolve)).verdict;
}
