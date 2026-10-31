package fr.veryslopnynotes.app

// I6 : le nom de fichier vient du SERVEUR, donc le type MIME qui en découle ne
// doit jamais être EXÉCUTABLE (`consignes.html` partait comme du HTML).
// Sans dépendance Android : il compile seul sous `kotlinc`.

/** Types MIME EXÉCUTABLES : le lecteur qui les ouvre INTERPRÈTE le contenu. */
private val EXECUTABLE_MIME_TYPES: Set<String> = setOf(
    "text/html",
    "application/xhtml+xml",
    "image/svg+xml",
    "text/xml",
    "application/xml",
    "text/xml-external-parsed-entity",
    "application/javascript",
    "text/javascript",
    "application/ecmascript",
    "text/ecmascript",
    "application/x-shockwave-flash",
    "application/vnd.ms-htmlhelp",
)

/** Liste blanche bornée : ce qui n'y est pas sort en `application/octet-stream`. */
private val MIME_BY_EXTENSION: Map<String, String> = mapOf(
    "jpg" to "image/jpeg",
    "jpeg" to "image/jpeg",
    "png" to "image/png",
    "gif" to "image/gif",
    "webp" to "image/webp",
    "bmp" to "image/bmp",
    "heic" to "image/heic",
    "pdf" to "application/pdf",
    "odt" to "application/vnd.oasis.opendocument.text",
    "ods" to "application/vnd.oasis.opendocument.spreadsheet",
    "odp" to "application/vnd.oasis.opendocument.presentation",
    "doc" to "application/msword",
    "docx" to "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "xls" to "application/vnd.ms-excel",
    "xlsx" to "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "ppt" to "application/vnd.ms-powerpoint",
    "pptx" to "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "rtf" to "application/rtf",
    "txt" to "text/plain",
    "csv" to "text/csv",
    "md" to "text/markdown",
    "markdown" to "text/markdown",
    "mp3" to "audio/mpeg",
    "m4a" to "audio/mp4",
    "mp4" to "video/mp4",
    "mov" to "video/quicktime",
)

/** Lisibles comme du texte, mais de type naturel EXÉCUTABLE : sortent en `text/plain`. */
private val TEXT_ONLY_EXTENSIONS: Set<String> = setOf(
    "html", "htm", "xhtml", "xht", "shtml", "mhtml", "mht", "hta",
    "xml", "xsl", "xslt", "svg", "svgz",
    "js", "mjs", "vbs",
)

/** Le nom vient du serveur : aucun type exécutable ne sort d'ici (I6). */
fun mimeOf(name: String): String {
    val ext = name.trim().substringAfterLast('.', "").lowercase()
    val type = MIME_BY_EXTENSION[ext]
        ?: if (ext in TEXT_ONLY_EXTENSIONS) "text/plain" else "application/octet-stream"
    // Garde-fou : même une table étendue par erreur ne peut pas laisser passer un
    // type exécutable.
    return if (type in EXECUTABLE_MIME_TYPES) "text/plain" else type
}
