package fr.veryslopnynotes.data

import fr.veryslopnynotes.core.AiContext
import fr.veryslopnynotes.core.AiContextItem
import java.io.ByteArrayOutputStream
import java.nio.charset.StandardCharsets
import java.util.zip.Inflater

// #631 : extraction LOCALE du texte d'une pièce jointe. Aucun réseau ici :
// les octets viennent de la frontière (client Pronote ou cache du compte).
//
// Le contenu externe reste une DONNÉE (I6) :
//   - HTML : les balises sont retirées, les scripts/styles SUPPRIMÉS ; aucun
//     HTML n'est rendu ni interprété ;
//   - PDF : seuls les flux texte sont lus (aucun rendu, aucune exécution) ;
//   - image : pas d'OCR ici, la frontière peut passer par le chemin vision ;
//   - tout type exécutable/inconnu devient « illisible », jamais un crash.
//
// Toutes les coupes sont SIGNALÉES (`truncated`) : taille téléchargée, nombre
// de pages PDF, caractères. Le fichier est PUR (java.* seulement) : le harnais
// de parité l'exécute sur des fixtures synthétiques.
sealed class AttachmentTextResult {
    data class Readable(
        val text: String,
        val truncated: Boolean,
        /** Taille AVANT la coupe, pour que « Ce qui est envoyé » dise ce qui a été retiré. */
        val originalChars: Int = text.length,
    ) : AttachmentTextResult()

    /** Raison STABLE (clé machine), traduite en libellé par [toAiContextItem]. */
    data class Unreadable(val reason: String) : AttachmentTextResult()
}

object AttachmentText {
    /** Même plafond que le cache des pièces jointes : rien de plus n'est lu. */
    const val MAX_BYTES = DownloadedFiles.MAX_BYTES

    /** Borne de texte extrait, alignée sur la borne de payload d'un cours. */
    const val MAX_CHARS = 8000

    /** Pages PDF lues au plus (une page scannée n'est pas OCR-isée ici). */
    const val MAX_PDF_PAGES = 20

    /** Flux PDF parcourus au plus, même si aucun n'est du texte. */
    const val MAX_PDF_STREAMS = 200

    /** Décompression PDF bornée (protection contre une bombe). */
    const val MAX_PDF_DECODED_BYTES = 4 * 1024 * 1024

    /** Total décompressé sur TOUS les flux : une pile de bombes ne passe pas. */
    const val MAX_PDF_TOTAL_DECODED_BYTES = 8 * 1024 * 1024

    /** Pièces jointes téléchargées au plus par appel IA. */
    const val MAX_ATTACHMENTS = 6

    /** Images envoyées au chemin vision au plus (coût borné). */
    const val MAX_VISION_ATTACHMENTS = 2

    /**
     * Entités NOMMÉES usuelles (français + ponctuation). Liste BORNÉE : une
     * entité inconnue reste telle quelle, jamais interprétée comme du HTML.
     */
    private val NAMED_ENTITIES = mapOf(
        "amp" to "&", "lt" to "<", "gt" to ">", "quot" to "\"", "apos" to "'",
        "nbsp" to " ", "deg" to "°", "euro" to "€", "times" to "×", "divide" to "÷",
        "plusmn" to "±", "sup2" to "²", "sup3" to "³", "frac12" to "½",
        "laquo" to "«", "raquo" to "»", "ndash" to "–", "mdash" to "—",
        "rsquo" to "’", "lsquo" to "‘", "ldquo" to "“", "rdquo" to "”", "hellip" to "…",
        "eacute" to "é", "egrave" to "è", "agrave" to "à", "ccedil" to "ç",
        "ecirc" to "ê", "icirc" to "î", "ocirc" to "ô", "ucirc" to "û",
        "euml" to "ë", "iuml" to "ï", "uuml" to "ü", "oelig" to "œ", "aelig" to "æ",
    )

    private val TEXT_EXTENSIONS = setOf(
        "txt", "md", "markdown", "csv", "html", "htm", "xhtml", "xht", "shtml",
        "xml", "xsl", "xslt", "svg", "svgz", "js", "mjs", "vbs",
    )

    /**
     * Extrait le texte de [bytes]. [mime] vient de `mimeOf` (table blanche) ;
     * il ne rend jamais un type exécutable. Une erreur interne devient
     * « illisible », jamais une exception qui remonte au pont.
     */
    fun extract(
        name: String,
        mime: String,
        bytes: ByteArray,
        maxChars: Int = MAX_CHARS,
        maxPages: Int = MAX_PDF_PAGES,
    ): AttachmentTextResult {
        if (bytes.isEmpty()) return AttachmentTextResult.Unreadable("vide")
        if (bytes.size > MAX_BYTES) return AttachmentTextResult.Unreadable("taille")
        val ext = name.trim().substringAfterLast('.', "").lowercase()
        return try {
            when {
                mime == "application/pdf" || ext == "pdf" || startsWithPdf(bytes) ->
                    readPdf(bytes, maxChars, maxPages)
                mime.startsWith("image/") -> AttachmentTextResult.Unreadable("image_vision")
                mime.startsWith("text/") || ext in TEXT_EXTENSIONS ->
                    readText(bytes, name, mime, maxChars)
                // Un fichier sans extension mais visiblement du texte (UTF-8
                // valide, aucun octet NUL, peu de contrôles) reste lisible :
                // refuser tout ce qui n'est pas reconnu cacherait une consigne
                // en `.txt` nommée `consigne` sans extension.
                looksLikeText(bytes) -> readText(bytes, name, "text/plain", maxChars)
                else -> AttachmentTextResult.Unreadable("format_non_lisible")
            }
        } catch (_: Exception) {
            AttachmentTextResult.Unreadable("extraction_impossible")
        }
    }

    /**
     * Convertit un résultat en source citable. Un format illisible reste une
     * source NOMMÉE (« Pièce jointe : X (illisible) ») pour que le modèle sache
     * ce qui manque ; le texte explicatif n'est jamais un HTML rendu.
     */
    fun toAiContextItem(label: String, result: AttachmentTextResult): AiContextItem = when (result) {
        is AttachmentTextResult.Readable ->
            AiContext.attachment(
                label,
                result.text,
                truncated = result.truncated,
                originalChars = result.originalChars,
            )
        is AttachmentTextResult.Unreadable ->
            AiContext.attachmentUnreadable(label, unreadableMessage(result.reason))
    }

    /** Message français borné, jamais le nom du fichier ni une URL. */
    fun unreadableMessage(reason: String): String = when (reason) {
        "vide" -> "Pièce jointe vide : aucun texte à lire."
        "taille" -> "Pièce jointe trop volumineuse : elle n'a pas été lue."
        "format_non_lisible" -> "Format de pièce jointe non pris en charge : elle n'a pas été lue."
        "pdf_sans_texte" -> "PDF sans texte lisible : l'OCR d'un scan n'est pas disponible."
        "image_vision" -> "Image non transcrite : le chemin vision n'a pas pu la lire."
        "image_vision_indisponible" -> "Image non transcrite : aucune clé LLM n'est disponible pour la vision."
        "extraction_impossible" -> "Pièce jointe illisible : son contenu n'a pas pu être extrait."
        else -> "Pièce jointe illisible : elle n'a pas pu être lue."
    }

    private fun startsWithPdf(bytes: ByteArray): Boolean =
        bytes.size >= 5 &&
            bytes[0] == '%'.code.toByte() &&
            bytes[1] == 'P'.code.toByte() &&
            bytes[2] == 'D'.code.toByte() &&
            bytes[3] == 'F'.code.toByte() &&
            bytes[4] == '-'.code.toByte()

    /**
     * Détection de texte SANS extension ni type : décodage UTF-8 STRICT, aucun
     * octet NUL, et au plus 5 % de caractères de contrôle. Un binaire (ZIP,
     * image, exécutable) échoue à l'un des trois.
     */
    private fun looksLikeText(bytes: ByteArray): Boolean {
        if (bytes.isEmpty() || bytes.any { it == 0.toByte() }) return false
        val text = try {
            val decoder = StandardCharsets.UTF_8.newDecoder()
                .onMalformedInput(java.nio.charset.CodingErrorAction.REPORT)
                .onUnmappableCharacter(java.nio.charset.CodingErrorAction.REPORT)
            val buffer = decoder.decode(java.nio.ByteBuffer.wrap(bytes))
            val chars = CharArray(buffer.remaining())
            buffer.get(chars)
            String(chars)
        } catch (_: Exception) {
            return false
        }
        if (text.isBlank()) return false
        val controls = text.count { it.isISOControl() && it != '\n' && it != '\t' && it != '\r' }
        return controls * 20 <= text.length
    }

    private fun readText(
        bytes: ByteArray,
        name: String,
        mime: String,
        maxChars: Int,
    ): AttachmentTextResult {
        val raw = String(bytes, StandardCharsets.UTF_8)
            .removePrefix("\uFEFF")
            .replace("\r\n", "\n")
            .replace('\r', '\n')
        val isHtml = mime == "text/html" ||
            name.trim().substringAfterLast('.', "").lowercase() in setOf("html", "htm", "xhtml", "xht", "shtml")
        val text = if (isHtml) sanitizeHtml(raw) else sanitizeText(raw)
        if (text.isBlank()) return AttachmentTextResult.Unreadable("format_non_lisible")
        return bounded(text, maxChars)
    }

    private fun sanitizeText(raw: String): String {
        val out = StringBuilder(raw.length)
        for (c in raw) {
            when {
                c == '\n' || c == '\t' -> out.append(c)
                c.isISOControl() -> out.append(' ')
                else -> out.append(c)
            }
        }
        return out.toString().replace(Regex("[ \\t]+\\n"), "\n").replace(Regex("\\n{3,}"), "\n\n").trim()
    }

    /**
     * Retire les blocs actifs AVANT les balises, puis décode les entités. Aucun
     * parseur HTML, aucun rendu : seuls les nœuds texte restent.
     */
    private fun sanitizeHtml(raw: String): String {
        var s = Regex("(?is)<(script|style|template|noscript|iframe|object|embed|svg)[^>]*>.*?</\\1\\s*>")
            .replace(raw, " ")
        s = Regex("(?is)<!--.*?-->").replace(s, " ")
        s = Regex("(?i)<br\\s*/?>").replace(s, "\n")
        s = Regex("(?i)</(p|div|li|tr|h[1-6]|section|article|blockquote|pre|table|ul|ol)>")
            .replace(s, "\n")
        s = Regex("(?i)<li[^>]*>").replace(s, "• ")
        s = Regex("<[^>]*>", RegexOption.DOT_MATCHES_ALL).replace(s, " ")
        // Deuxième passe APRÈS décodage : `&lt;script&gt;` ne doit pas
        // réapparaître comme une balise ni laisser son contenu actif.
        val decoded = Regex("(?is)<(script|style|template|noscript|iframe|object|embed|svg)[^>]*>.*?</\\1\\s*>")
            .replace(decodeEntities(s), " ")
        return sanitizeText(Regex("<[^>]*>", RegexOption.DOT_MATCHES_ALL).replace(decoded, " "))
    }

    private fun decodeEntities(raw: String): String {
        val numeric = Regex("&#x([0-9a-fA-F]+);|&#([0-9]+);").replace(raw) { m ->
            val code = m.groupValues[1].ifEmpty { null }?.toIntOrNull(16)
                ?: m.groupValues[2].toIntOrNull(10)
                ?: return@replace m.value
            if (code <= 0 || code > 0x10FFFF) return@replace m.value
            String(Character.toChars(code))
        }
        return Regex("&(\\w+);").replace(numeric) { m -> NAMED_ENTITIES[m.groupValues[1]] ?: m.value }
    }

    private fun bounded(text: String, maxChars: Int): AttachmentTextResult {
        val limit = maxChars.coerceAtLeast(1)
        val points = text.codePointCount(0, text.length)
        if (points <= limit) return AttachmentTextResult.Readable(text, false, points)
        val end = text.offsetByCodePoints(0, limit)
        return AttachmentTextResult.Readable(text.substring(0, end).trimEnd(), true, points)
    }

    // --- PDF (texte seulement) -------------------------------------------------

    /**
     * Extraction MINIMALE et SÛRE des flux texte d'un PDF. Aucun rendu, aucune
     * exécution : les objets `stream` sont décompressés au besoin (FlateDecode)
     * puis seules les chaînes des opérateurs texte sont lues. Un PDF scanné
     * (aucune chaîne texte) est « illisible » avec la raison explicite.
     */
    private fun readPdf(bytes: ByteArray, maxChars: Int, maxPages: Int): AttachmentTextResult {
        val raw = String(bytes, StandardCharsets.ISO_8859_1)
        val pageCount = Regex("/Type\\s*/Page(?![A-Za-z0-9])").findAll(raw).count()
        var truncated = pageCount > maxPages
        val out = StringBuilder()
        var textPages = 0
        var streams = 0
        var decodedTotal = 0
        var cursor = 0
        while (streams < MAX_PDF_STREAMS) {
            val start = raw.indexOf("stream", cursor)
            if (start < 0) break
            var body = start + "stream".length
            if (raw.startsWith("\r\n", body)) body += 2 else if (raw.startsWith("\n", body) || raw.startsWith("\r", body)) body += 1
            val end = raw.indexOf("endstream", body)
            if (end < 0) break
            streams += 1
            val dictStart = raw.lastIndexOf("obj", start)
            val dict = raw.substring(if (dictStart >= 0) dictStart else 0, start)
            if (isTextStream(dict)) {
                val encoded = raw.substring(body, end).toByteArray(StandardCharsets.ISO_8859_1)
                val decoded = if (dict.contains("/FlateDecode")) inflate(encoded) else encoded
                if (decoded != null) {
                    decodedTotal += decoded.size
                    if (decodedTotal > MAX_PDF_TOTAL_DECODED_BYTES) {
                        truncated = true
                        break
                    }
                    val text = pdfText(String(decoded, StandardCharsets.ISO_8859_1))
                    if (text.isNotBlank()) {
                        if (textPages >= maxPages) {
                            truncated = true
                            break
                        }
                        textPages += 1
                        if (out.isNotEmpty()) out.append('\n')
                        out.append(text)
                        if (out.length > maxChars) truncated = true
                    }
                }
            }
            cursor = end + "endstream".length
        }
        if (out.isBlank()) return AttachmentTextResult.Unreadable("pdf_sans_texte")
        return bounded(sanitizeText(out.toString()), maxChars).let {
            when (it) {
                is AttachmentTextResult.Readable ->
                    AttachmentTextResult.Readable(it.text, it.truncated || truncated, it.originalChars)
                is AttachmentTextResult.Unreadable -> it
            }
        }
    }

    /** Les flux de police/image/XObject ne sont pas du texte de page. */
    private fun isTextStream(dict: String): Boolean =
        !Regex("/Subtype\\s*/(Image|Type1|TrueType|Type0|CIDFont|Metadata)").containsMatchIn(dict) &&
            !Regex("/Type\\s*/(XObject|Font|Metadata)").containsMatchIn(dict)

    private fun inflate(raw: ByteArray): ByteArray? {
        if (raw.isEmpty()) return null
        val inflater = Inflater()
        return try {
            inflater.setInput(raw)
            val out = ByteArrayOutputStream()
            val buffer = ByteArray(8192)
            var total = 0
            while (!inflater.finished()) {
                val n = inflater.inflate(buffer)
                if (n == 0) {
                    if (inflater.needsInput() || inflater.needsDictionary()) break
                    continue
                }
                total += n
                if (total > MAX_PDF_DECODED_BYTES) return null
                out.write(buffer, 0, n)
            }
            out.toByteArray().takeIf { it.isNotEmpty() }
        } catch (_: Exception) {
            null
        } finally {
            inflater.end()
        }
    }

    /**
     * Chaînes littérales `(…)` et hexadécimales `<…>` d'un flux de contenu,
     * avec les échappements PDF usuels. Les opérateurs de positionnement
     * ajoutent un retour à la ligne pour garder des paragraphes lisibles.
     */
    private fun pdfText(content: String): String {
        val out = StringBuilder()
        var i = 0
        while (i < content.length) {
            when (content[i]) {
                '(' -> {
                    val literal = StringBuilder()
                    var depth = 1
                    i += 1
                    while (i < content.length && depth > 0) {
                        val c = content[i]
                        when {
                            c == '\\' && i + 1 < content.length -> {
                                i += 1
                                literal.append(unescapePdf(content[i]))
                            }
                            c == '(' -> {
                                depth += 1
                                literal.append(c)
                            }
                            c == ')' -> {
                                depth -= 1
                                if (depth > 0) literal.append(c)
                            }
                            else -> literal.append(c)
                        }
                        i += 1
                    }
                    if (literal.isNotEmpty()) out.append(literal).append(' ')
                }
                '<' -> {
                    if (i + 1 < content.length && content[i + 1] == '<') {
                        i += 2
                        continue
                    }
                    val end = content.indexOf('>', i + 1)
                    if (end < 0) break
                    decodeHex(content.substring(i + 1, end))?.let { if (it.isNotBlank()) out.append(it).append(' ') }
                    i = end + 1
                }
                'B' -> {
                    if (i + 1 < content.length && content[i + 1] == 'T') {
                        i += 2
                        continue
                    }
                    i += 1
                }
                'E' -> {
                    if (i + 1 < content.length && content[i + 1] == 'T') {
                        if (out.isNotEmpty() && out.last() != '\n') out.append('\n')
                        i += 2
                        continue
                    }
                    i += 1
                }
                'T' -> {
                    if (i + 1 < content.length && content[i + 1] == '*') {
                        if (out.isNotEmpty() && out.last() != '\n') out.append('\n')
                        i += 2
                        continue
                    }
                    i += 1
                }
                else -> i += 1
            }
        }
        return out.toString()
    }

    private fun unescapePdf(c: Char): Char = when (c) {
        'n' -> '\n'
        'r' -> '\r'
        't' -> '\t'
        'b' -> '\b'
        'f' -> '\u000C'
        '(', ')', '\\' -> c
        else -> c
    }

    private fun decodeHex(raw: String): String? {
        val hex = raw.filter { !it.isWhitespace() }
        if (hex.isEmpty() || hex.length % 2 != 0) return null
        val bytes = ByteArray(hex.length / 2)
        for (i in bytes.indices) {
            val value = hex.substring(i * 2, i * 2 + 2).toIntOrNull(16) ?: return null
            bytes[i] = value.toByte()
        }
        return if (bytes.size >= 2 && bytes[0] == 0xFE.toByte() && bytes[1] == 0xFF.toByte()) {
            String(bytes.copyOfRange(2, bytes.size), StandardCharsets.UTF_16BE)
        } else {
            String(bytes, StandardCharsets.ISO_8859_1)
        }
    }
}
