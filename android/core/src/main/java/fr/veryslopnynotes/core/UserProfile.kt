package fr.veryslopnynotes.core

// Profil du compte appairé #82 : miroir de shared/contracts/models.ts UserInfo.
// La photo est une RÉF OPAQUE (`photo:<id>`) : l'app ne connaît jamais d'adresse
// Pronote, elle passe par le proxy serveur (ServerConfig.photoUrl, I1).
// Aucune donnée personnelle n'est persistée par ce modèle (mode anonyme : le
// profil vit en mémoire, il repart à la déconnexion).
// ponytail: dates = 10 premiers caractères de l'ISO, stdlib seule (pas de lib date).
data class UserProfile(
    val accountId: String,
    val displayName: String,
    val firstName: String = "",
    val lastName: String = "",
    val classLabel: String = "",
    val periodName: String = "",
    val photoRef: String = "",
    val hasKids: Boolean = false,
    val kids: List<ChildAccount> = emptyList(),
)

/** Compte enfant d'un compte parent (multi-compte #82). */
data class ChildAccount(
    val accountId: String,
    val displayName: String,
    val classLabel: String = "",
)

object UserProfileRules {
    const val MAX_NAME = 64
    const val MAX_PHOTO_REF = 200
    const val MAX_KIDS = 8
    const val MAX_ACCOUNT_ID = 64

    // Même forme que le contrat TS : `photo:` + jeton de fichier. Toute URL
    // (http://, https://, //, data:) est donc refusée par construction.
    private val PHOTO_REF_RE = Regex("^photo:[A-Za-z0-9._-]{1,150}$")

    fun isValidAccountId(id: String): Boolean = id.isNotBlank() && id.length <= MAX_ACCOUNT_ID

    fun isValidPhotoRef(ref: String): Boolean = ref.length <= MAX_PHOTO_REF && PHOTO_REF_RE.matches(ref)

    fun isValid(profile: UserProfile): Boolean {
        if (!isValidAccountId(profile.accountId)) return false
        val name = profile.displayName.trim()
        if (name.isEmpty() || name.length > MAX_NAME) return false
        if (profile.firstName.length > MAX_NAME) return false
        if (profile.lastName.length > MAX_NAME) return false
        if (profile.classLabel.length > MAX_NAME) return false
        if (profile.periodName.length > MAX_NAME) return false
        // photoRef présent = réf valide, jamais une adresse (I1).
        if (profile.photoRef.isNotEmpty() && !isValidPhotoRef(profile.photoRef)) return false
        if (profile.kids.size > MAX_KIDS) return false
        for (k in profile.kids) {
            if (!isValidAccountId(k.accountId)) return false
            if (k.displayName.trim().isEmpty() || k.displayName.length > MAX_NAME) return false
        }
        return true
    }
}

/** Initiales pour l'avatar de repli (photo absente = pas d'image cassée). */
fun profileInitials(profile: UserProfile): String {
    val words = profile.displayName.trim().split(" ", "-", "_").filter { it.isNotEmpty() }
    val letters = words.take(2).map { it.first().uppercaseChar() }
    return if (letters.isEmpty()) "?" else letters.joinToString("")
}