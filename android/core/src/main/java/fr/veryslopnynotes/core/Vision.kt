package fr.veryslopnynotes.core

// Photo -> modèle vision. Le texte du prompt reste soumis à la garde I4 ;
// l'image, elle, est OPAQUE : elle ne peut pas être scannée pour des secrets.
// Elle ne part que sur un geste explicite, après ré-encodage (métadonnées
// supprimées) et dans une borne stricte. Pur (stdlib seule).

/**
 * Une image prête pour le fournisseur. `mime` est TOUJOURS un type bitmap non
 * exécutable (I6) ; le pont ne produit que du JPEG ré-encodé.
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

        /** Un envoi peut porter plusieurs pages d'un même énoncé (coût borné). */
        const val MAX_IMAGES = 3

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
 * Prompt texte DÉJÀ validé par `buildSafePrompt` + les images qui l'accompagnent.
 * Le type garantit que les images ont passé [VisionImage.isValid].
 */
data class SafeVisionPrompt(
    val prompt: SafePrompt,
    val images: List<VisionImage>,
)

interface SafeVisionPromptProvider {
    fun generateVisionSafe(prompt: SafeVisionPrompt, apiKey: String?): String
}

/**
 * Construit et valide un prompt vision : de une à [VisionImage.MAX_IMAGES]
 * images (coût et surface bornés).
 */
fun buildSafeVisionPrompt(
    system: String,
    data: List<Untrusted<String>>,
    images: List<VisionImage>,
    nonce: String? = null,
): SafeVisionPrompt {
    if (images.isEmpty() || images.size > VisionImage.MAX_IMAGES) throw AiError("images invalides (I6)")
    if (images.any { !it.isValid() }) throw AiError("image invalide (I6)")
    val prompt = buildSafePrompt(system, data, nonce)
    assertNoSecretsInPrompt(prompt, data)
    return SafeVisionPrompt(prompt = prompt, images = images)
}

fun buildSafeVisionPrompt(
    system: String,
    data: List<Untrusted<String>>,
    image: VisionImage,
    nonce: String? = null,
): SafeVisionPrompt = buildSafeVisionPrompt(system, data, listOf(image), nonce)

/** Même pipeline que [generateGuardedJson], images déclarées DONNÉES ; sortie validée (I5). */
fun generateGuardedVisionJson(
    provider: SafeVisionPromptProvider,
    system: String,
    data: List<Untrusted<String>>,
    images: List<VisionImage>,
    nonce: String? = null,
    apiKey: String? = null,
): JsonValue {
    val safe = buildSafeVisionPrompt(system, data, images, nonce)
    val out = provider.generateVisionSafe(safe, apiKey)
    return parseJsonOutput(out)
}

fun generateGuardedVisionJson(
    provider: SafeVisionPromptProvider,
    system: String,
    data: List<Untrusted<String>>,
    image: VisionImage,
    nonce: String? = null,
    apiKey: String? = null,
): JsonValue = generateGuardedVisionJson(provider, system, data, listOf(image), nonce, apiKey)
