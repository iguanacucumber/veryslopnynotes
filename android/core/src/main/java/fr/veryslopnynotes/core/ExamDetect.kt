package fr.veryslopnynotes.core

// Candidat DS/interro : entrée de `buildRevisionTitle` / `assembleRevisionSheet`,
// construit par le pont depuis un devoir.
//
// Pur : aucun réseau, aucun SQLite, aucun Android (I3).

data class ExamCandidate(
    val source: String,
    val id: String,
    val subject: String,
    val date: String,
    val confidence: String,
    val matched: String,
)
