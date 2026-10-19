// Provenance du bundle vendu : `bun build keynote/vendor/entry.js --format=iife
// --minify --outfile=keynote/vendor/three.min.js` (three@0.186.1, MIT).
// L'IIFE seule n'exporte rien : on pose le namespace sur globalThis.
import * as THREE from "three";
globalThis.THREE = THREE;
