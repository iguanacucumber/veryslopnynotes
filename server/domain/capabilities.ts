// Capacités dynamiques (#87) — parité Papillon : un onglet absent de
// l'établissement n'est pas une erreur, c'est une capacité `false`. Ce module
// est PUR (aucun réseau, aucun SQLite : I3) : l'adaptateur d'intégration
// observe ce que pronotets expose, ce module réduit l'observation à la liste
// canonique des onglets actifs. Règle d'or : jamais de `true` deviné, un
// onglet non observé = absent de la liste.
import { TAB_CAPABILITIES, isCapabilities } from "../../shared/contracts/models";
import type { Capabilities, TabCapability } from "../../shared/contracts/models";

/** Observation de l'adaptateur : onglet → actif ? (absent = false). */
export type CapabilityProbe = Readonly<Partial<Record<TabCapability, boolean>>>;

/**
 * Réduit une observation à la liste contractuelle : ordre canonique
 * `TAB_CAPABILITIES`, sans doublon, uniquement les onglets observés actifs.
 * Observation vide = aucun onglet actif (l'app masque tout, elle ne casse rien :
 * les routes concernées renvoient déjà des listes vides).
 */
export function capabilitiesFromProbe(accountId: string, probe: CapabilityProbe, at: string): Capabilities {
  const tabs: TabCapability[] = [];
  for (const tab of TAB_CAPABILITIES) {
    if (probe[tab] === true && !tabs.includes(tab)) tabs.push(tab);
  }
  // `candidate2` garde le type structural (sinon le garde-fou `isCapabilities`
  // narrowed le repli à `never`) : c'est le type qui simplifie la comparaison.
  const candidate2 = { accountId: accountId.trim(), tabs, fetchedAt: at };
  const candidate: Capabilities = candidate2;
  // Défense : un contrat invalide (accountId vide, date illisible) n'affirme
  // AUCUNE capacité — les appelsants gardent ainsi le droit de répondre
  // `capabilities: null` plutôt que d'inventer des onglets actifs.
  return isCapabilities(candidate) ? candidate : { accountId: candidate2.accountId, tabs: [], fetchedAt: candidate2.fetchedAt };
}

/**
 * Capacité d'un onglet. `null`/absent = capacités non déterminées : la
 * réponse n'affirme rien, donc faux côté serveur (l'app applique sa propre
 * règle sur `CapabilitiesResponse.capabilities === null` : rien n'est masqué).
 */
export function hasCapability(caps: Capabilities | null | undefined, tab: TabCapability): boolean {
  return caps?.tabs.includes(tab) === true;
}

/**
 * Onglets désactivés = tous les onglets connus moins ceux observés actifs.
 * Sert au masquage côté app et aux tests (un onglet absent est bien listé
 * comme désactivé, jamais oublié).
 */
export function disabledTabs(caps: Capabilities | null | undefined): TabCapability[] {
  const enabled = new Set(caps?.tabs ?? []);
  return TAB_CAPABILITIES.filter((t) => !enabled.has(t));
}
