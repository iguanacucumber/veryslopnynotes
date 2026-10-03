// API devoirs generate (issue #27) — POST /v1/homework/generate.
// I7 : retourne JSON validé uniquement, aucun push/store/effet métier.
// Erreurs typées sans secret : 400 requête invalide, 501 LLM non configuré, 500 sortie invalide.
import {
  HOMEWORK_MAX_BODY_CHARS,
  isHomeworkGenerateRequest,
  isHomeworkGenerateResponse,
} from "../../shared/contracts/api";
import { generateHomework } from "../ai/homework";
import type { LLMProvider } from "../domain/ports";
import { apiError } from "./errors";

export async function handleHomeworkGenerate(
  req: Request,
  llm: LLMProvider | null,
): Promise<Response> {
  if (!llm) return apiError("not_implemented", "assistant devoirs non configuré");
  let body: unknown;
  try {
    const text = await req.text();
    // Corps borné AVANT parse : même discipline que toggle / messagerie / prefs.
    if (text.length > HOMEWORK_MAX_BODY_CHARS) return apiError("bad_request", "invalid homework request");
    body = JSON.parse(text);
  } catch {
    return apiError("bad_request", "invalid JSON body");
  }
  if (!isHomeworkGenerateRequest(body)) return apiError("bad_request", "invalid homework request");
  try {
    const result = await generateHomework(llm, body);
    if (!isHomeworkGenerateResponse(result)) return apiError("internal", "invalid homework payload");
    return Response.json(result);
  } catch (err) {
    const msg = (err as Error)?.message ?? "";
    // Requête invalide vue côté service (bornes/contrat) -> 400, sinon 500 générique sans détail.
    if (msg.includes("requête devoirs invalide")) return apiError("bad_request", "invalid homework request");
    return apiError("internal", "homework generation failed");
  }
}
