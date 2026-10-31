package fr.veryslopnynotes.core

// Profil du compte appairé : miroir de shared/contracts/models.ts UserInfo.
// La photo est une RÉF `photo:<id>` lue sur le client local (jamais une adresse, I1).
// Aucune donnée personnelle n'est persistée : le profil vit en mémoire et repart
// à la déconnexion.
// ponytail: dates = 10 premiers caractères de l'ISO, stdlib seule.
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

/** Compte enfant d'un compte parent (multi-compte). */
data class ChildAccount(
    val accountId: String,
    val displayName: String,
    val classLabel: String = "",
)

object UserProfileRules {
    const val MAX_NAME = 64

    /**
     * Borne du libellé de PÉRIODE : plus large que le nom, car un établissement
     * peut écrire « Trimestre 1 — année scolaire 2026-2027 ».
     */
    const val MAX_PERIOD_NAME = 100
    const val MAX_PHOTO_REF = 200
    const val MAX_KIDS = 8
    const val MAX_ACCOUNT_ID = 64

    // Même forme que le contrat TS : `photo:` + jeton de fichier. Toute URL est
    // donc refusée par construction.
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
        if (profile.periodName.length > MAX_PERIOD_NAME) return false
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
