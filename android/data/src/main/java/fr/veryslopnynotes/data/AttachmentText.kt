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

    /**
     * Entrée HTML bornée AVANT désinfection. Le retrait des balises est
     * linéaire, mais la sortie est plafonnée à [MAX_CHARS] : désinfecter 10 Mo
     * de balisage pour n'en garder que 8 000 caractères ne sert à rien. La
     * coupe d'entrée est SIGNALÉE comme les autres (I35).
     */
    const val MAX_HTML_INPUT_CHARS = MAX_CHARS * 4

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
        "mhtml", "mht", "hta", "xml", "xsl", "xslt", "svg", "svgz", "js", "mjs", "vbs",
    )

    /**
     * Extensions qui contiennent du BALISAGE : elles passent par [sanitizeHtml],
     * même quand le type MIME (table blanche d'`AttachmentMime`) les sert en
     * `text/plain` — c'est le cas de `.mhtml`, `.mht` et `.hta`, dont le script
     * ne doit jamais arriver brut dans l'invite.
     */
    private val HTML_EXTENSIONS = setOf(
        "html", "htm", "xhtml", "xht", "shtml", "mhtml", "mht", "hta",
    )

    /** Blocs dont le CONTENU est retiré avec la balise : rien d'actif ne reste. */
    private val HTML_ACTIVE_BLOCKS = setOf(
        "script", "style", "template", "noscript", "iframe", "object", "embed", "svg",
    )

    /** Balises de bloc : elles valent une fin de ligne, jamais du vide. */
    private val HTML_BLOCK_TAGS = setOf(
        "p", "div", "li", "tr", "h1", "h2", "h3", "h4", "h5", "h6",
        "section", "article", "blockquote", "pre", "table", "ul", "ol",
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
        val ext = name.trim().substringAfterLast('.', "").lowercase()
        // Le balisage est décidé par le TYPE et par l'EXTENSION : `.mhtml`,
        // `.mht` et `.hta` sortent en `text/plain` mais restent du HTML.
        val isHtml = mime == "text/html" || ext in HTML_EXTENSIONS
        val head = if (isHtml && raw.length > MAX_HTML_INPUT_CHARS) {
            raw.substring(0, MAX_HTML_INPUT_CHARS)
        } else {
            raw
        }
        val text = if (isHtml) sanitizeHtml(head) else sanitizeText(raw)
        if (text.isBlank()) return AttachmentTextResult.Unreadable("format_non_lisible")
        val result = bounded(text, maxChars)
        // Une coupe d'ENTRÉE est une coupe : la taille d'avant reste publiée,
        // pour que « Ce qui est envoyé » dise ce qui a été retiré (I35).
        if (head.length < raw.length && result is AttachmentTextResult.Readable) {
            return AttachmentTextResult.Readable(result.text, true, maxOf(raw.length, result.originalChars))
        }
        return result
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
     * Retire le balisage RÉEL, puis décode les entités UNE SEULE FOIS. Un `<`
     * décodé est du TEXTE : `x &lt; 3 et y &gt; 2` devient `x < 3 et y > 2` et
     * n'est jamais relu comme une balise — décoder d'abord ferait de
     * `< 3 et y >` une balise et effacerait les maths. Aucun parseur, aucun
     * rendu : seuls les nœuds texte restent.
     *
     * Balayage LINÉAIRE (`indexOf`) : un `<` sans `>` suivant est du texte, donc
     * une entrée pleine de `<` malformés coûte un balayage, pas un par `<`.
     */
    private fun sanitizeHtml(raw: String): String {
        val out = StringBuilder(raw.length)
        var i = 0
        while (i < raw.length) {
            val lt = raw.indexOf('<', i)
            if (lt < 0) {
                out.append(raw, i, raw.length)
                break
            }
            out.append(raw, i, lt)
            // Commentaire : retiré, ou tout ce qui suit s'il n'est pas fermé.
            if (raw.startsWith("<!--", lt)) {
                val end = raw.indexOf("-->", lt + 4)
                if (end < 0) break
                out.append(' ')
                i = end + 3
                continue
            }
            val gt = raw.indexOf('>', lt + 1)
            if (gt < 0) {
                // Pas de `>` : ce n'est pas une balise, c'est du texte.
                out.append(raw, lt, raw.length)
                break
            }
            val closing = raw[lt + 1] == '/'
            val name = tagNameAt(raw, if (closing) lt + 2 else lt + 1)
            val selfClosing = raw[gt - 1] == '/'
            when {
                name in HTML_ACTIVE_BLOCKS && !closing && !selfClosing -> {
                    // Bloc actif : son CONTENU part avec la balise.
                    out.append(' ')
                    i = skipActiveBlock(raw, name, gt + 1)
                    continue
                }
                name == "br" -> out.append('\n')
                name == "li" && !closing -> out.append("• ")
                name in HTML_BLOCK_TAGS -> out.append('\n')
                else -> out.append(' ')
            }
            i = gt + 1
        }
        // Un SEUL décodage, APRÈS le retrait du balisage : jamais de re-strip.
        return sanitizeText(decodeEntities(out.toString()))
    }

    /** Nom de balise en minuscules à partir de [from] (`""` si aucun). */
    private fun tagNameAt(raw: String, from: Int): String {
        var end = from
        while (end < raw.length && raw[end].isLetterOrDigit()) end += 1
        return raw.substring(from, end).lowercase()
    }

    /**
     * Index juste après la balise fermante de [name], ou [String.length] si le
     * bloc n'est jamais fermé : un `<script>` ouvert ne laisse rien passer.
     */
    private fun skipActiveBlock(raw: String, name: String, from: Int): Int {
        var i = from
        while (true) {
            val open = raw.indexOf("</", i)
            if (open < 0) return raw.length
            val gt = raw.indexOf('>', open)
            if (gt < 0) return raw.length
            if (tagNameAt(raw, open + 2) == name) return gt + 1
            i = gt + 1
        }
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
                val inflated = if (dict.contains("/FlateDecode")) inflate(encoded) else Inflated(encoded, false)
                // Une COUPE de décompression est signalée (I35) ; une vraie
                // corruption reste une corruption : le flux est sauté, sans
                // faire croire que l'extraction a été bornée.
                if (inflated.capped) truncated = true
                val decoded = inflated.bytes
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
        // Flux restants NON parcourus : la coupe est SIGNALÉE (I35).
        if (streams >= MAX_PDF_STREAMS && hasStreamAfter(raw, cursor)) truncated = true
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

    /** Un début de flux existe-t-il après [from] ? (`endstream` en contient un.) */
    private fun hasStreamAfter(raw: String, from: Int): Boolean {
        var i = raw.indexOf("stream", from)
        while (i >= 0) {
            if (i < 3 || !raw.regionMatches(i - 3, "end", 0, 3)) return true
            i = raw.indexOf("stream", i + "stream".length)
        }
        return false
    }

    /** Résultat d'une décompression : `capped` distingue une COUPE d'une corruption. */
    private class Inflated(val bytes: ByteArray?, val capped: Boolean)

    private fun inflate(raw: ByteArray): Inflated {
        if (raw.isEmpty()) return Inflated(null, false)
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
                if (total > MAX_PDF_DECODED_BYTES) return Inflated(null, true)
                out.write(buffer, 0, n)
            }
            Inflated(out.toByteArray().takeIf { it.isNotEmpty() }, false)
        } catch (_: Exception) {
            Inflated(null, false)
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
