// #397 : le signal « session morte » est BRANCHÉ, et le compte appairé est
// ENREGISTRÉ.
//
// Le problème : `DeviceAuth.reject()` était un no-op — `setOnRejected` n'avait
// AUCUN appelant. Le natif gardait donc le jeton mort ET son cache, et le
// magasin multi-compte n'était jamais alimenté (`account_ids` vide : le compte
// courant valait toujours `null`).
//
// Ce test lit les VRAIES sources (jamais une copie) : il échoue dès qu'on
// débranche le signal, qu'on remplace la purge par un autre chemin, ou qu'on
// cesse d'enregistrer le compte appairé.
//
// La DÉCISION (purge ou pas) est une fonction pure : elle est donc testée
// EXÉCUTÉE (`tests/unit/kotlin-session-repair.test.ts`). Ici, c'est le CÂBLAGE
// qui est épinglé.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { codeOnly } from "../../agents/runtime/source-guards";
import { readBridgeSource } from "../unit/fixtures/bridge-source";

const ROOT = join(import.meta.dir, "..", "..");
const DATA = join(ROOT, "android/data/src/main/java/fr/veryslopnynotes/data");
const DEVICE_AUTH = join(DATA, "DeviceAuth.kt");
const REPAIR = join(DATA, "SessionRepair.kt");
const ACCOUNT = join(DATA, "AccountStore.kt");
const PAIRING = join(DATA, "PairingRepository.kt");
const WORKER = join(DATA, "PeriodicSyncWorker.kt");
const APP_CONTEXT = join(ROOT, "web/src/ui/AppContext.tsx");

/** Corps d'une fonction Kotlin (jusqu'à la déclaration suivante). */
function body(src: string, signature: string): string {
  const start = src.indexOf(signature);
  if (start === -1) return "";
  const end = src.indexOf("\n    private fun", start);
  return src.slice(start, end === -1 ? src.length : end);
}

describe("réparation d'une session morte (#397)", () => {
  test("le signal a un ABONNÉ : l'app branche la réparation", () => {
    const bridge = readBridgeSource();
    // `setOnRejected` n'a plus ZERO appelant : c'était le cœur du défaut.
    expect(bridge).toContain("DeviceAuth.setOnRejected");
    // Branché UNE fois, au démarrage (dans le `init` du pont).
    const occurrences = bridge.split("DeviceAuth.setOnRejected").length - 1;
    expect({ occurrences }).toEqual({ occurrences: 1 });
    // Le job de fond NE s'abonne pas : il partage le process, il remplacerait
    // l'abonné de l'app (le signal n'a qu'un abonné).
    const worker = readFileSync(WORKER, "utf8");
    expect(codeOnly(worker)).not.toContain("setOnRejected");
  });

  test("l'abonné répare par le chemin EXISTANT (accounts.logout())", () => {
    const bridge = readBridgeSource();
    const rejected = body(bridge, "private fun onSessionRejected()");
    expect(rejected).toContain("accounts.logout()");
    // La session du pont tombe aussi : `session.status` ne doit pas dire
    // « restaurée » pour une session morte.
    expect(rejected).toContain("sessionReady = false");
  });

  test("la purge invalide la session ET purge le cache (un seul chemin)", () => {
    const account = readFileSync(ACCOUNT, "utf8");
    const repair = readFileSync(REPAIR, "utf8");
    // La déconnexion ET la session morte partagent le MÊME code de purge.
    expect(account).toContain("SessionRepair.purge(");
    expect(account).not.toContain("SessionEpoch.invalidate");
    // La purge : session persistée invalidée, session en mémoire abandonnée,
    // cache purgé sous la garde d'époque.
    expect(repair).toContain("invalidateSession()");
    expect(repair).toContain("PronoteSession.clear()");
    expect(repair).toContain("CacheScope.purge(cacheStore)");
    expect(repair).not.toContain("SessionEpoch.invalidate");
    // Le store de session PERSISTÉ est bien invalidé (le jeton mort ne doit
    // pas survivre à la purge).
    expect(account).toContain("sessions.clear()");
  });

  test("PAS de boucle : la purge ne lève jamais le signal", () => {
    const repair = readFileSync(REPAIR, "utf8");
    const account = readFileSync(ACCOUNT, "utf8");
    expect(codeOnly(repair)).not.toContain("reject()");
    expect(codeOnly(account)).not.toContain("reject()");
    // Le signal reste levé par les DÉPÔTS (le client du téléphone échoue),
    // jamais par la réparation.
    const deviceAuth = readFileSync(DEVICE_AUTH, "utf8");
    expect(codeOnly(deviceAuth)).toContain("onRejected?.invoke()");
    // Et il ne fait JAMAIS échouer celui qui le lève (une purge en échec ne
    // doit pas tuer le fil du dépôt : la promesse JS pendrait).
    expect(codeOnly(deviceAuth)).toContain("catch (_: Exception)");
  });

  test("le compte appairé est ENREGISTRÉ à l'appairage", () => {
    const bridge = readBridgeSource();
    const pairing = readFileSync(PAIRING, "utf8");
    // `accounts.add` est appelé sur le chemin `pairing.pair`.
    expect(bridge).toContain("accounts.add(");
    const paired = body(bridge, "private fun pair(p: JSONObject)");
    expect(paired).toContain("accounts.add(");
    // Le compte appairé devient le compte COURANT (c'est lui que la
    // relecture annonce) : `current()` ne vaut plus `null`.
    expect(paired).toContain("accounts.select(");
    // L'appairage PUBLIE l'identifiant du compte…
    expect(pairing).toContain("client.infoId");
    expect(pairing).toContain("data class Ok(val accountId: String?)");
    // …et c'est l'id de la ressource client, jamais le login ni le jeton.
    const code = codeOnly(pairing);
    expect(code).not.toMatch(/infoId.*(username|password)/);
  });

  test("l'interface renvoie vers l'appairage (le refus 401 est bien publié)", () => {
    const bridge = readBridgeSource();
    // Le rejet devient un refus `auth_required` : c'est ce code que l'interface
    // écoute pour renvoyer vers l'appairage.
    expect(bridge).toContain('throw BridgeFailure("auth_required", error)');
    const appContext = readFileSync(APP_CONTEXT, "utf8");
    expect(appContext).toContain("vsn:auth");
    expect(appContext).toContain("setAuthLost(true)");
  });
});
