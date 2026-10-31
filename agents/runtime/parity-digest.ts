// Empreinte des sources de PRODUCTION de parité = CLÉ du cache CI du port.
//
// UNE SEULE SOURCE DE VÉRITÉ : `productionDigest()` est le calcul qu'utilise
// le harnais pour nommer son dossier local. Deux calculs, deux clés, un cache
// mort. Les sources vivent dans les fixtures du harnais (qui les compile) : la
// recopier ici serait la deuxième source de vérité.
//
// Les pilotes ne sont PAS dans cette clé : un pilote modifié doit restaurer le
// port et ne recompiler que son overlay.
//
// Sortie : l'empreinte seule (16 hex) sur stdout, reprise dans `$GITHUB_OUTPUT`.
import { productionDigest } from "../../tests/unit/fixtures/parity-sources";

console.log(productionDigest());
