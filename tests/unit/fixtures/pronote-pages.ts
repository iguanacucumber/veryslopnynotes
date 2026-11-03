// Pages d'ouverture PRONOTE — une fixture par cause typée (#877).
//
// Aucune adresse réelle : seuls les MOTS de la page décident de la cause. La
// page saine contient « IP » dans un commentaire : la sous-chaîne seule n'est
// plus une suspension.
export const START_PAGE =
  `<html><body onload="Start({h: '123456', a: 'abcdef', CrA: '1', CoA: '0', http: ''})"></body></html>`;

export const START_PAGE_WITH_IP_WORD =
  `<!-- IP --><html><body onload="Start({h: '42', a: 'z'})"></body></html>`;

export const START_WITHOUT_H = `<html><body onload="Start({a: 'x'})"></body></html>`;

export const SUSPENDED_PAGE_FR =
  `<html><body><h1>Accès refusé</h1><p>Votre adresse IP a été suspendue par l'établissement.</p></body></html>`;

export const SUSPENDED_PAGE_EN =
  `<html><body><h1>Access denied</h1><p>Your IP address is suspended.</p></body></html>`;

export const SUSPENDED_PAGE_TAG_SPLIT =
  `<html><body><p>Votre adresse <b>IP</b> a été <i>bannie</i>.</p></body></html>`;

export const UNEXPECTED_PAGE = `<html><body><h1>Bienvenue</h1></body></html>`;
