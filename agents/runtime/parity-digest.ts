// L'EMPREINTE du port Kotlin de parité : la CLÉ du cache CI de son jar.
//
// UNE SEULE SOURCE DE VÉRITÉ. `parityDigest()` (tests/unit/fixtures/
// parity-sources.ts) est le calcul que le harnais de compilation utilise pour
// nommer son dossier de cache local. La CI met le jar en cache sous la MÊME
// clé : deux calculs, deux clés, un cache mort.
//
// POURQUOI CE SCRIPT ATTEINT LES FIXTURES : la LISTE des sources du port vit
// là (elle est le bien du harnais, qui les compile). La recopier ici serait
// une DEUXIÈME source de vérité — celle qu'il ne faut surtout pas.
//
// Sortie : l'empreinte seule (16 hex), sur stdout — la CI en fait une sortie
// d'étape (`$GITHUB_OUTPUT`), puis la clé du cache `actions/cache`.
import { parityDigest } from "../../tests/unit/fixtures/parity-sources";

console.log(parityDigest());
