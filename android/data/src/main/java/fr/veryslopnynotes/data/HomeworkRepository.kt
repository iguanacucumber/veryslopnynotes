package fr.veryslopnynotes.data

import fr.veryslopnynotes.core.Assignment
import fr.veryslopnynotes.core.Homework
import fr.veryslopnynotes.core.HomeworkOutcome
import fr.veryslopnynotes.core.HomeworkSource
import fr.veryslopnynotes.core.WebPage
import fr.veryslopnynotes.core.WebPageDoc
import org.json.JSONArray
import org.json.JSONObject

// Dépôt « aide devoirs » : contrats partagés (question, sources, parse).
// La GÉNÉRATION ne passe plus par le serveur (`POST /v1/homework/generate`)
// mais par l'IA embarquée ([OpenRouterHomework] : prompt core I6 + OpenRouter
// direct + validation core I4/I5, clé relue du store à CHAQUE appel).
//
// POINT DE VIGILANCE : la réponse du modèle est de la DONNÉE (I6) : ce dépôt
// ne fait que la valider, l'affichage se fait en Text() côté UI.
data class HomeworkResult(val outcome: HomeworkOutcome?, val error: String?)

// ponytail: dépôt sans état (la clé vit dans le store), pas de ViewModel avant besoin.
class HomeworkRepository {

    companion object {
        const val NO_KEY_MESSAGE = "Clé LLM absente : renseigne-la dans Réglages."
        const val OUT_OF_BOUNDS_MESSAGE = "Requête hors limites (question ou source trop longue)."

        private fun capped(raw: String, max: Int): String {
            val t = raw.trim()
            return if (t.length > max) t.take(max) else t
        }

        /**
         * Sources d'un devoir : ce que le serveur peut CITER, donc ce que
         * l'élève a réellement sous les yeux. Les pièces jointes n'en sont pas
         * (une `ref` n'a pas de texte : il faudrait aller le chercher côté
         * serveur, hors périmètre de l'assistant) — d'où le refus honnête quand
         * le devoir n'a ni consigne ni contenu de cours.
         */
        fun sourcesFor(a: Assignment): List<HomeworkSource> {
            val out = mutableListOf<HomeworkSource>()
            if (a.description.isNotBlank()) {
                out.add(HomeworkSource(label = "Consigne", text = capped(a.description, Homework.MAX_SOURCE_CHARS)))
            }
            val lc = a.lessonContent
            if (lc != null && lc.excerpt.isNotBlank()) {
                val label = capped("Cours : ${lc.title}", Homework.MAX_LABEL_CHARS).ifEmpty { "Cours" }
                out.add(HomeworkSource(label = label, text = capped(lc.excerpt, Homework.MAX_SOURCE_CHARS)))
            }
            return out.filter { it.isValid() }.take(Homework.MAX_SOURCES)
        }

        /**
         * Extrait du manuel enregistré, comme source CITABLE. Le contenu vient
         * du scraper : il est déjà borné (4 000 caractères) et sera marqué
         * Untrusted par le prompt. Sans texte, aucune source n'est ajoutée.
         */
        fun manualSource(doc: ManualDoc): HomeworkSource? {
            val excerpt = capped(doc.excerpt, Homework.MAX_SOURCE_CHARS)
            if (excerpt.isEmpty()) return null
            val label = capped("Manuel : ${doc.title}", Homework.MAX_LABEL_CHARS).ifEmpty { "Manuel" }
            return HomeworkSource(label = label, text = excerpt).takeIf { it.isValid() }
        }

        /**
         * Page web lue par le scraper, comme source CITABLE (#634). Même
         * contrat que le manuel : texte borné, libellé « Web : titre »,
         * Untrusted au prompt. L'URL n'est pas portée par [WebPageDoc] : elle
         * ne peut donc pas entrer dans le prompt. Sans texte, aucune source.
         */
        fun webPageSource(doc: WebPageDoc): HomeworkSource? = WebPage.source(doc)

        /** Question proposée : matière + intitulé + la consigne si elle existe. */
        fun questionFor(a: Assignment): String = capped(
            listOf(a.subject, a.title).filter { it.isNotBlank() }.joinToString(" — ") +
                (if (a.description.isBlank()) "" else "\n${a.description}"),
            Homework.MAX_QUESTION_CHARS,
        )

        // ponytail: parse manuel org.json (miroir de isHomeworkGenerateResponse).
        fun parse(body: String, allowedLabels: List<String>): HomeworkOutcome? = try {
            val root = JSONObject(body)
            when (root.optString("status")) {
                "ok" -> {
                    val answer = root.optString("answer").trim()
                    val steps = strings(root.optJSONArray("steps"))
                    val sources = strings(root.optJSONArray("sources"))
                    // Le contrat exige answer non vide, stages et sources non vides
                    // et des sources non vides ; on re-vérifie le subset des citations.
                    val outcome = HomeworkOutcome.Answer(answer, steps, sources)
                    if (Homework.isOutcomeValid(outcome) && outcome.sources.all { it in allowedLabels }) {
                        outcome
                    } else {
                        null
                    }
                }

                "refused" -> {
                    val outcome = HomeworkOutcome.Refused(root.optString("reason").trim(), strings(root.optJSONArray("sources")))
                    if (Homework.isOutcomeValid(outcome)) outcome else null
                }

                else -> null
            }
        } catch (_: Exception) {
            null
        }

        private fun strings(arr: JSONArray?): List<String> {
            val out = mutableListOf<String>()
            for (i in 0 until (arr?.length() ?: 0)) {
                val s = arr?.optString(i) ?: continue
                if (s.isNotBlank()) out.add(s)
            }
            return out
        }
    }
}