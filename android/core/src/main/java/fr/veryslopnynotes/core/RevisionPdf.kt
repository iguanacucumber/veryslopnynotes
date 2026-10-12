package fr.veryslopnynotes.core

import android.graphics.Paint
import android.graphics.Typeface
import android.graphics.pdf.PdfDocument
import java.io.OutputStream

// Export PDF d'une fiche de révision via `PdfDocument` natif (port Kotlin #207).
//
// Remplace le writer PDF-1.4 maison du serveur (octets + xref assemblés à la
// main, tombé sur les accents — cf. le test xref de `bugs-domain-jobs`) : sur
// l'appareil, le système compose le PDF lui-même. API 26 (minSdk), ZÉRO
// dépendance — c'est tout l'objet de ce fichier.
//
// Le CONTENU dessiné vient de `revisionPdfLines` (même découpage titre/date/
// corps/gabarit que la référence, rejoué en parité dans
// `tests/unit/kotlin-jobs-parity.test.ts`) : ce fichier ne fait que paginer et
// dessiner, aucune logique métier.
//
// Fichier non rejoué par le harnais `kotlinc` seul (`android.graphics` vient du
// SDK) : vérifié par `check-kotlin` (structure) + `make android-compile` (le
// compilateur, dès que le SDK est présent).
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
        val doc = PdfDocument()
        try {
            var pageNum = 1
            var page = doc.startPage(PdfDocument.PageInfo.Builder(PAGE_WIDTH, PAGE_HEIGHT, pageNum).create())
            var y = MARGIN + TITLE_SIZE
            for ((index, line) in lines.withIndex()) {
                if (y > PAGE_HEIGHT - MARGIN) {
                    doc.finishPage(page)
                    pageNum += 1
                    page = doc.startPage(PdfDocument.PageInfo.Builder(PAGE_WIDTH, PAGE_HEIGHT, pageNum).create())
                    y = MARGIN + TEXT_SIZE
                }
                val paint = when (index) {
                    0 -> titlePaint
                    1 -> metaPaint
                    else -> textPaint
                }
                page.canvas.drawText(line, MARGIN.toFloat(), y, paint)
                y += LINE_HEIGHT
            }
            doc.finishPage(page)
            doc.writeTo(out)
        } finally {
            doc.close()
        }
    }
}
