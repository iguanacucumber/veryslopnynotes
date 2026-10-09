// Capacités dynamiques (#87) : quels onglets cet établissement sert
// réellement. Observation STRUCTURELLE, aucune requête Pronote. Déplacé tel
// quel depuis pronote-client-reader.ts.
import type { Capabilities } from "../../../shared/contracts/models";
import { PronoteReadError } from "../../domain/ports";
import { capabilitiesFromProbe } from "../../domain/capabilities";
import type { ReaderCtx } from "./primitives";
import { refreshSession, toReadError } from "./primitives";

/**
 * #87 : capacités dynamiques — onglets Pronote réellement servis par cet
 * établissement. Observation STRUCTURELLE (le client expose-t-il la méthode de
 * l'onglet ?) : aucune requête Pronote, donc aucune erreur possible côté
 * établissement. Onglet non observé = capacité absente, JAMAIS un `true`
 * deviné : la réduction canonique est faite par server/domain/capabilities.
 * ponytail: `discussions` (onglet Discussions de Papillon) reste absent tant
 * que pronotets n'expose pas l'onglet ; l'app masque donc l'entrée, ce qui est
 * le comportement correct pour un établissement qui ne l'a pas. Upgrade: mapper
 * `client.information` quand la lib le publiera.
 */
export async function getCapabilities(ctx: ReaderCtx, accountId: string): Promise<Capabilities> {
  const id = (accountId ?? "").trim();
  if (!id) throw new PronoteReadError("capabilities session expired", "session_expired");
  let client;
  try {
    await refreshSession(ctx, id);
    client = ctx.sessions.requireClient(id);
  } catch (err) {
    const mapped = toReadError(err, "capabilities");
    ctx.logger(`capabilities -> error ${mapped.code}`);
    throw mapped;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw = client as any;
    const periods = Array.isArray(raw?.periods) ? (raw.periods as unknown[]) : [];
    const anyPeriod = (method: string): boolean => periods.some((p) => typeof (p as { [k: string]: unknown })?.[method] === "function");
    const caps = capabilitiesFromProbe(
      id,
      {
        grades: anyPeriod("grades"),
        homework: typeof raw?.homework === "function",
        timetable: typeof raw?.lessons === "function",
        news: typeof raw?.informationAndSurveys === "function",
        menus: typeof raw?.menus === "function",
        attendance: anyPeriod("absences") || anyPeriod("delays"),
        punishments: anyPeriod("punishments"),
        profile: typeof raw?.info === "object" && raw.info !== null,
      },
      new Date().toISOString(),
    );
    // Logs = compteurs seuls (aucun nom, aucun hôte, aucun secret).
    ctx.logger(`capabilities -> ok ${caps.tabs.length} onglet(s) actif(s)`);
    return caps;
  } catch {
    // Détection impossible = aucune capacité affirmée, jamais une erreur 500.
    ctx.logger("capabilities -> indisponible, aucune capacite");
    return capabilitiesFromProbe(id, {}, new Date().toISOString());
  }
}
