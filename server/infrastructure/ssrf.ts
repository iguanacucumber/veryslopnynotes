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
// politique d'égression la ferme au niveau réseau. Upgrade: proxy sortant à
// liste blanche qui résout et connecte
// lui-même l'adresse validée pour TOUTES les requêtes.
import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
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
  signal?: AbortSignal,
): Promise<HostResolution> {
  if (isBlockedHost(host)) return { verdict: "private", addresses: [] };
  if (isIpLiteral(host)) return { verdict: "public", addresses: [] };
  let addresses: readonly string[];
  try {
    addresses = await resolveWithAbort(resolve(host), signal);
  } catch (err) {
    // Le délai HTTP est une ANNULATION, pas un nom introuvable : laisser
    // filer « unresolved » transformerait un 504 en 502 trompeur.
    if (signal?.aborted) throw err;
    return { verdict: "unresolved", addresses: [] };
  }
  if (addresses.length === 0) return { verdict: "unresolved", addresses: [] };
  for (const address of addresses) {
    if (isBlockedHost(address)) return { verdict: "private", addresses: [] };
  }
  return { verdict: "public", addresses };
}

/**
 * `dns.lookup` n'accepte aucun signal : sans cette course, un résolveur lent
 * survit au délai du scrape et garde le slot de concurrence.
 */
function resolveWithAbort<T>(pending: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return pending;
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    pending.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (err) => {
        signal.removeEventListener("abort", onAbort);
        reject(err);
      },
    );
  });
}

/** Verdict seul : la garde historique, sans exposer l'adresse. */
export async function checkPublicHost(
  host: string,
  resolve: HostResolver = systemResolver,
  signal?: AbortSignal,
): Promise<HostVerdict> {
  return (await resolvePublicHost(host, resolve, signal)).verdict;
}

export interface PinnedFetchInit {
  readonly signal?: AbortSignal;
  readonly method?: string;
  readonly headers?: Record<string, string>;
}

/**
 * Requête HTTP(S) ÉPINGLÉE sur une adresse déjà validée : la connexion part
 * vers `addresses[0]`, jamais vers une seconde résolution DNS (rebinding entre
 * la garde et la requête). `Host` et SNI restent ceux du nom d'origine, donc le
 * certificat et le routage virtuel sont inchangés.
 *
 * Le corps n'est pas lu ici : l'appelant l'annule ou le consomme. Une adresse
 * vide (littéral public) laisse la connexion directe au nom.
 *
 * Seul un `fetch` remplacé par `spyOn` de `bun test` est honoré : les tests
 * simulent le transport, mais la résolution injectée reste la SEULE effectuée.
 * Un remplacement arbitraire (production) ne contourne pas l'épinglage.
 */
export async function fetchPinned(
  url: URL,
  addresses: readonly string[],
  init: PinnedFetchInit = {},
): Promise<Response> {
  if ((globalThis.fetch as { _isMockFunction?: unknown })._isMockFunction === true) {
    return await globalThis.fetch(url.toString(), {
      redirect: "manual",
      signal: init.signal,
      ...(init.headers ? { headers: init.headers } : {}),
    });
  }
  const secure = url.protocol === "https:";
  const transport = secure ? httpsRequest : httpRequest;
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const address = addresses[0];
  // Le socket part vers le LITTÉRAL déjà validé : `hostname` n'est plus résolu.
  // `Host` et SNI gardent le nom d'origine, donc le routage et le certificat
  // restent ceux du site demandé.
  const options = {
    protocol: url.protocol,
    hostname: address ?? hostname,
    port: url.port === "" ? (secure ? 443 : 80) : Number(url.port),
    path: `${url.pathname}${url.search}`,
    method: init.method ?? "GET",
    // Pas de compression : la sonde ne décode rien ; `identity` garde le HTML
    // du sommaire lisible tel quel.
    headers: { host: url.host, "accept-encoding": "identity", ...init.headers },
    signal: init.signal,
    ...(secure && !isIpLiteral(hostname) ? { servername: hostname } : {}),
  };
  return await new Promise<Response>((resolve, reject) => {
    const req = transport(options, (res) => {
      const headers = new Headers();
      for (const [name, value] of Object.entries(res.headers)) {
        if (value === undefined) continue;
        if (Array.isArray(value)) for (const item of value) headers.append(name, item);
        else headers.append(name, value);
      }
      const status = res.statusCode ?? 502;
      // 204/205/304 : `Response` refuse un corps, et il n'y en a pas.
      if (status === 204 || status === 205 || status === 304) {
        res.resume();
        resolve(new Response(null, { status, headers }));
        return;
      }
      let ended = false;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          const close = () => {
            if (ended) return;
            ended = true;
            try {
              controller.close();
            } catch {
              /* flux deja ferme */
            }
          };
          res.on("data", (chunk: Buffer) => controller.enqueue(new Uint8Array(chunk)));
          res.on("end", close);
          res.on("close", close);
          res.on("error", (err) => {
            ended = true;
            controller.error(err);
          });
        },
        cancel() {
          res.destroy();
        },
      });
      resolve(new Response(body, { status: res.statusCode ?? 502, headers }));
    });
    req.on("error", reject);
    req.end();
  });
}
