package fr.veryslopnynotes.app

// Type MIME d'une pièce jointe, déduit de l'extension DONNÉE PAR LE SERVEUR.
//
// I6 : le contenu externe est une DONNÉE, jamais un programme. Un nom de
// fichier choisi par le serveur ne doit donc jamais décider d'un type
// EXÉCUTABLE : une pièce jointe `consignes.html` partait vers un lecteur
// tiers comme du HTML exécutable (script), au lieu d'octets inertes.
//
// Trois verrous, du plus large au plus étroit :
//   1. la TABLE des formats scolaires est une liste blanche BORNÉE : tout ce
//      qui n'y figure pas sort en `application/octet-stream` ;
//   2. les extensions lisibles comme du texte mais dont le type « naturel »
//      est EXÉCUTABLE (html, xml, svg…) sortent explicitement en
//      `text/plain` : la source reste lisible, le script ne s'exécute pas ;
//   3. le garde-fou final refuse TOUT type exécutable, même si une table
//      était étendue par erreur plus tard.
//
// Ce fichier est SANS dépendance Android (ni `Context`, ni `FileProvider`) :
// il compile seul sous `kotlinc`, donc il est testable pour de vrai
// (`tests/unit/attachment-mime.test.ts`) au lieu d'être lu comme du texte.

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

/**
 * Formats scolaires connus : leur type RÉEL est servi, le lecteur s'ouvre
 * normalement. Liste BORNÉE — ce qui n'y est pas sort en octet-stream.
 */
private val MIME_BY_EXTENSION: Map<String, String> = mapOf(
    // Images
    "jpg" to "image/jpeg",
    "jpeg" to "image/jpeg",
    "png" to "image/png",
    "gif" to "image/gif",
    "webp" to "image/webp",
    "bmp" to "image/bmp",
    "heic" to "image/heic",
    // Documents
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
    // Texte
    "txt" to "text/plain",
    "csv" to "text/csv",
    "md" to "text/markdown",
    "markdown" to "text/markdown",
    // Audio / vidéo
    "mp3" to "audio/mpeg",
    "m4a" to "audio/mp4",
    "mp4" to "video/mp4",
    "mov" to "video/quicktime",
)

/**
 * Extensions lisibles comme du texte, mais dont le type « naturel » est
 * EXÉCUTABLE : elles sortent en `text/plain` (source visible, script mort).
 */
private val TEXT_ONLY_EXTENSIONS: Set<String> = setOf(
    "html", "htm", "xhtml", "xht", "shtml", "mhtml", "mht", "hta",
    "xml", "xsl", "xslt", "svg", "svgz",
    "js", "mjs", "vbs",
)

/**
 * Type MIME d'une pièce jointe, déduit de l'extension de son nom.
 *
 * Le nom vient du SERVEUR : le type qui en découle est donc une DONNÉE, pas
 * une instruction (I6). Aucun type exécutable ne sort d'ici — ni pour
 * `consignes.html`, ni pour `plan.svg`, ni pour `notes.xml`.
 */
fun mimeOf(name: String): String {
    val ext = name.trim().substringAfterLast('.', "").lowercase()
    val type = MIME_BY_EXTENSION[ext]
        ?: if (ext in TEXT_ONLY_EXTENSIONS) "text/plain" else "application/octet-stream"
    // Garde-fou final : un type exécutable ne sort JAMAIS, même si les tables
    // étaient étendues par erreur (le test d'architecture verrouille les
    // tables, ce test verrouille le comportement).
    return if (type in EXECUTABLE_MIME_TYPES) "text/plain" else type
}
