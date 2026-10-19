package fr.veryslopnynotes.core

// Profil du compte appairé #82 : miroir de shared/contracts/models.ts UserInfo.
// La photo est une RÉF `photo:<id>` lue sur le client local (jamais une
// adresse) : l'app ne connaît aucune adresse d'établissement (I1).
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

    /**
     * Borne du libellé de PÉRIODE (#420) : plus large que le nom, car un
     * établissement peut écrire « Trimestre 1 — année scolaire 2026-2027 ».
     * Miroir de `USER_PERIOD_NAME_MAX_CHARS` (contrat TS) : la parité est
     * prouvée par `tests/unit/kotlin-profile-parity.test.ts`.
     */
    const val MAX_PERIOD_NAME = 100
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
