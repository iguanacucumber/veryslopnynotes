package fr.veryslopnynotes.core

// Photo -> modèle vision (#587). Le texte du prompt reste soumis à la garde
// I4 ; l'image, elle, est OPAQUE : elle ne peut pas être scannée pour des
// secrets. Elle ne part donc que sur un geste explicite de l'élève, après
// ré-encodage (métadonnées supprimées) et dans une borne stricte.
//
// Ce fichier est PUR (stdlib seule) : le harnais de parité peut l'exécuter.

/**
 * Une image prête pour le fournisseur.
 *
 * `mime` est TOUJOURS un type bitmap non exécutable (I6) ; le pont ne produit
 * que du JPEG ré-encodé. `base64` est la donnée du corps multipart JSON.
 */
data class VisionImage(
    val mime: String,
    val base64: String,
) {
    fun isValid(): Boolean {
        if (mime != "image/jpeg" && mime != "image/png" && mime != "image/webp") return false
        if (base64.isEmpty() || base64.length > MAX_IMAGE_BASE64_CHARS) return false
        if (!BASE64_RE.matches(base64)) return false
        return decodedSize(base64) <= MAX_IMAGE_BYTES
    }

    companion object {
        const val MAX_IMAGE_BYTES = 2_000_000

        /** Base64 gonfle d'environ 4/3 : borne un peu au-dessus de 2 Mo. */
        const val MAX_IMAGE_BASE64_CHARS = 2_800_000

        private val BASE64_RE = Regex("^[A-Za-z0-9+/]+={0,2}$")

        /** Taille décodée estimée, sans décoder (l'image peut être grosse). */
        fun decodedSize(base64: String): Int {
            if (base64.isEmpty()) return 0
            val padding = when {
                base64.endsWith("==") -> 2
                base64.endsWith("=") -> 1
                else -> 0
            }
            return (base64.length / 4) * 3 - padding
        }
    }
}

/**
 * Prompt texte DÉJÀ validé par `buildSafePrompt` + les images qui
 * l'accompagnent.
 *
 * Le type porte la garantie : le texte a passé la garde I4, les images ont
 * passé [VisionImage.isValid] et ne peuvent pas être réinterprétées comme du
 * texte. Aucun outil, aucun effet externe.
 */
data class SafeVisionPrompt(
    val prompt: SafePrompt,
    val images: List<VisionImage>,
)

interface SafeVisionPromptProvider {
    fun generateVisionSafe(prompt: SafeVisionPrompt, apiKey: String?): String
}

/**
 * Construit et valide un prompt vision. Une image minimum, une maximum :
 * au-delà, le coût et la surface augmentent sans besoin métier.
 */
fun buildSafeVisionPrompt(
    system: String,
    data: List<Untrusted<String>>,
    image: VisionImage,
    nonce: String? = null,
): SafeVisionPrompt {
    if (!image.isValid()) throw AiError("image invalide (I6)")
    val prompt = buildSafePrompt(system, data, nonce)
    assertNoSecretsInPrompt(prompt, data)
    return SafeVisionPrompt(prompt = prompt, images = listOf(image))
}

/**
 * Même pipeline que [generateGuardedJson], avec une image déclarée DONNÉE.
 * La sortie est validée par la garde I5 exactement comme un prompt texte.
 */
fun generateGuardedVisionJson(
    provider: SafeVisionPromptProvider,
    system: String,
    data: List<Untrusted<String>>,
    image: VisionImage,
    nonce: String? = null,
    apiKey: String? = null,
): JsonValue {
    val safe = buildSafeVisionPrompt(system, data, image, nonce)
    val out = provider.generateVisionSafe(safe, apiKey)
    return parseJsonOutput(out)
}
