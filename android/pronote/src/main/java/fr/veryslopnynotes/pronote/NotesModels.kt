package fr.veryslopnynotes.pronote

import java.time.LocalDateTime

/** Matière (`N`/`L`, `groups` = `estServiceGroupe`, défaut `false`). */
class Subject(json: JVal?) : PronoteObject(json) {
    val id: String = r(::strOf, listOf("N"))
    val name: String = r(::strOf, listOf("L"))
    val groups: Boolean = r(::boolOf, listOf("estServiceGroupe"), ResolveOpts.withDefault(false))
}

/** `subject` reconstruit depuis le même dict ; `null` = code `|N` inconnu. */
class Average(json: JVal?) : PronoteObject(json) {
    val student: String? = r(::gradeParse, listOf("moyEleve", "V"))
    val outOf: String? = r(::gradeParse, listOf("baremeMoyEleve", "V"))
    val defaultOutOf: String? = r(::gradeParse, listOf("baremeMoyEleveParDefault", "V"), ResolveOpts.withDefault<String?>( ""))
    val classAverage: String? = r(::gradeParse, listOf("moyClasse", "V"))
    val min: String? = r(::gradeParse, listOf("moyMin", "V"))
    val max: String? = r(::gradeParse, listOf("moyMax", "V"))
    val subject: Subject = Subject(json)
    val backgroundColor: String? = r(::optStr, listOf("couleur"), ResolveOpts.lenient())
}

/**
 * `period` résolu via `Period.instances`, `null` si inconnu ; `isOptionnal` =
 * `facultatif && !bonus`, comme la coquille TS.
 */
class Grade(json: JVal?) : PronoteObject(json) {
    val id: String = r(::strOf, listOf("N"))
    val grade: String? = r(::gradeParse, listOf("note", "V"))
    val outOf: String? = r(::gradeParse, listOf("bareme", "V"))
    val defaultOutOf: String? = r(::gradeParse, listOf("baremeParDefaut", "V"), ResolveOpts.lenient())
    val date: LocalDateTime = r(::dateParse, listOf("date", "V"))
    val subject: Subject = r({ v -> Subject(v) }, listOf("service", "V"))
    val period: Period? =
        // `===` strict sur la valeur brute : `N` non-texte ne matche jamais.
        r({ v -> (v as? JVal.Str)?.value?.let { n -> Period.instances.firstOrNull { it.id == n } } }, listOf("periode", "V", "N"), ResolveOpts.lenient())
    val average: String? = r(::gradeParse, listOf("moyenne", "V"), ResolveOpts.lenient())
    val max: String? = r(::gradeParse, listOf("noteMax", "V"), ResolveOpts.lenient())
    val min: String? = r(::gradeParse, listOf("noteMin", "V"), ResolveOpts.lenient())
    val coefficient: String? = r(::optStr, listOf("coefficient"), ResolveOpts.lenient())
    val comment: String? = r(::optStr, listOf("commentaire"), ResolveOpts.lenient())
    val isBonus: Boolean = r(::boolOf, listOf("estBonus"), ResolveOpts.withDefault(false))
    val isOptionnal: Boolean = r(::boolOf, listOf("estFacultatif"), ResolveOpts.withDefault(false)) && !isBonus
    val isOutOf20: Boolean = r(::boolOf, listOf("estRamenerSur20"), ResolveOpts.withDefault(false))
}
