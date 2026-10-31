package fr.veryslopnynotes.core

import android.graphics.Paint
import android.graphics.Typeface
import android.graphics.pdf.PdfDocument
import java.io.OutputStream

// Export PDF d'une fiche de révision via `PdfDocument` natif.
//
// Remplace le writer PDF-1.4 maison du serveur (tombé sur les accents) : le
// système compose le PDF lui-même. API 26 (minSdk), ZÉRO dépendance.
//
// Le CONTENU dessiné vient de `revisionPdfLines` : ce fichier ne fait que
// paginer et dessiner. Les sources viennent de la liste canonique de la fiche.
//
// ponytail: une passe, texte seul, police système. Upgrade: entête coloré /
// numéros de page si la recette `make shot` le demande.

object RevisionPdf {
    const val PAGE_WIDTH = 595
    const val PAGE_HEIGHT = 842
    const val MARGIN = 50
    const val TITLE_SIZE = 16f
    const val TEXT_SIZE = 12f
    const val LINE_HEIGHT = 17f

    /**
     * Écrit la fiche en PDF sur `out` (A4, une page ou plus). Fiche invalide =
     * refus propre (`IllegalArgumentException`), jamais un PDF à moitié écrit.
     */
    fun writeSheet(sheet: RevisionSheet, out: OutputStream) {
        val lines = revisionPdfLines(sheet)
        val titlePaint = Paint().apply {
            textSize = TITLE_SIZE
            typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
        }
        val textPaint = Paint().apply {
            textSize = TEXT_SIZE
        }
        val metaPaint = Paint().apply {
            textSize = TEXT_SIZE
            typeface = Typeface.create(Typeface.DEFAULT, Typeface.ITALIC)
        }
        // La coupe à REVISION_PDF_WRAP est une borne LOGIQUE (rejouée en parité).
        // La PRÉSENTATION se remballe par MÉTRIQUE réelle pour tenir dans la page.
        val maxWidth = (PAGE_WIDTH - 2 * MARGIN).toFloat()
        val draw = mutableListOf<Pair<String, Paint>>()
        for ((index, line) in lines.withIndex()) {
            val paint = when (index) {
                0 -> titlePaint
                1 -> metaPaint
                else -> textPaint
            }
            for (part in fitLine(line, paint, maxWidth)) draw.add(part to paint)
        }
        val doc = PdfDocument()
        try {
            var pageNum = 1
            var page = doc.startPage(PdfDocument.PageInfo.Builder(PAGE_WIDTH, PAGE_HEIGHT, pageNum).create())
            var y = MARGIN + TITLE_SIZE
            for ((text, paint) in draw) {
                if (y > PAGE_HEIGHT - MARGIN) {
                    doc.finishPage(page)
                    pageNum += 1
                    page = doc.startPage(PdfDocument.PageInfo.Builder(PAGE_WIDTH, PAGE_HEIGHT, pageNum).create())
                    y = MARGIN + TEXT_SIZE
                }
                page.canvas.drawText(text, MARGIN.toFloat(), y, paint)
                y += LINE_HEIGHT
            }
            doc.finishPage(page)
            doc.writeTo(out)
        } finally {
            doc.close()
        }
    }

    /**
     * Emballe une ligne à la métrique réelle : aux espaces, sinon en dur.
     */
    private fun fitLine(text: String, paint: Paint, maxWidth: Float): List<String> {
        if (paint.measureText(text) <= maxWidth) return listOf(text)
        val out = mutableListOf<String>()
        var cur = ""
        for (word in text.split(" ")) {
            if (word.isEmpty()) continue
            val cand = if (cur.isEmpty()) word else "$cur $word"
            if (paint.measureText(cand) <= maxWidth) {
                cur = cand
                continue
            }
            if (cur.isNotEmpty()) out.add(cur)
            val pieces = if (paint.measureText(word) > maxWidth) hardPieces(word, paint, maxWidth) else listOf(word)
            for (k in 0 until pieces.size - 1) out.add(pieces[k])
            cur = pieces.last()
        }
        if (cur.isNotEmpty()) out.add(cur)
        return out.ifEmpty { listOf(" ") }
    }

    /** Coupe en dur au caractère, sans jamais séparer une paire de surrogates. */
    private fun hardPieces(word: String, paint: Paint, maxWidth: Float): List<String> {
        val out = mutableListOf<String>()
        var cur = ""
        var i = 0
        while (i < word.length) {
            var end = i + 1
            if (Character.isHighSurrogate(word[i]) && end < word.length) end += 1
            val piece = word.substring(i, end)
            val cand = cur + piece
            if (cur.isNotEmpty() && paint.measureText(cand) > maxWidth) {
                out.add(cur)
                cur = piece
            } else {
                cur = cand
            }
            i = end
        }
        if (cur.isNotEmpty()) out.add(cur)
        return out
    }
}
