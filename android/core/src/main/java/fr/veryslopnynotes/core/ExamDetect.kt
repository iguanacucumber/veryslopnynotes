package fr.veryslopnynotes.core

// Candidat DS/interro sur données structurées.
//
// Seul le MODÈLE survit (#651) : il est l'entrée de `buildRevisionTitle` /
// `assembleRevisionSheet` et le pont en construit un depuis un devoir. La
// détection heuristique n'avait aucun appelant de production : elle est
// supprimée avec ses constantes et son type de créneau EDT.
//
// Pur : aucun réseau, aucun SQLite, aucun Android (I3).

/** Candidat DS/interro détecté sur données structurées. */
data class ExamCandidate(
    val source: String,
    val id: String,
    val subject: String,
    val date: String,
    val confidence: String,
    val matched: String,
)
