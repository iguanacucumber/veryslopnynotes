package fr.veryslopnynotes.data

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.os.Handler
import android.os.Looper
import fr.veryslopnynotes.core.ChildAccount
import fr.veryslopnynotes.core.ServerConfig
import fr.veryslopnynotes.core.UserProfile
import fr.veryslopnynotes.core.UserProfileRules
import okhttp3.Call
import okhttp3.Callback
import okhttp3.Request
import okhttp3.Response
import org.json.JSONObject
import java.io.IOException

/** Photo de profil : absente (réF non publiée ou média KO) ou décodée du proxy. */
sealed interface PhotoState {
    data object Absent : PhotoState
    data class Loaded(val bitmap: Bitmap) : PhotoState
}

/** Résultat de lecture du profil : profil, aucun profil publié, ou échec réseau. */
sealed interface MeResult {
    data class Ok(val profile: UserProfile?) : MeResult
    data class Err(val message: String) : MeResult
}

// Profil #82 : GET /v1/me via ApiClient (allowlist serveur seule, I1) et photo
// via le PROXY serveur /v1/media à partir de la réF opaque — jamais d'adresse
// Pronote/ENT dans l'app, jamais de WebView.
// ponytail: rien n'est persisté ici (mode anonyme) : le profil vit en mémoire et
// disparaît à la déconnexion (AccountStore.logout). Upgrade: cache profil chiffré
// si l'utilisateur demande explicitement de garder son profil hors-ligne.
class ProfileRepository(
    private val api: ApiClient,
    // Rappel sur le thread principal comme SyncedRepository : l'état Compose
    // n'est jamais écrit depuis le thread OkHttp.
    private val main: Handler = Handler(Looper.getMainLooper()),
) {
    fun meRequest(): Request = api.buildGet(ME_PATH)

    /** Async (comme SyncedRepository) : le profil n'est JAMAIS écrit sur disque. */
    fun fetchMe(cb: (MeResult) -> Unit) {
        val call = api.client().newCall(meRequest())
        call.enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                post(cb, MeResult.Err("Hors-ligne, profil indisponible."))
            }

            override fun onResponse(call: Call, response: Response) {
                response.use {
                    if (!it.isSuccessful) {
                        post(cb, MeResult.Err("Profil indisponible (HTTP ${it.code})."))
                        return
                    }
                    // user null = infos non publiées : ce n'est pas une erreur.
                    post(cb, MeResult.Ok(parse(it.body?.string().orEmpty())))
                }
            }
        })
    }

    /**
     * Photo via le proxy serveur : /v1/media?ref=<réF opaque> (allowlist
     * contrôlée par ApiClient). Réf absente/invalide ou échec = null, l'UI
     * affiche les initiales. Aucune URL Pronote n'est jamais construite ici.
     */
    fun fetchPhoto(profile: UserProfile, cb: (Bitmap?) -> Unit) {
        val path = photoPath(profile) ?: run { post(cb, null); return }
        val call = api.client().newCall(api.buildGet(path))
        call.enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                post(cb, null)
            }

            override fun onResponse(call: Call, response: Response) {
                response.use {
                    val bytes = if (it.isSuccessful) it.body?.bytes() else null
                    post(cb, if (bytes == null) null else decodePhoto(bytes))
                }
            }
        })
    }

    private fun <T> post(cb: (T) -> Unit, value: T) {
        try {
            main.post { cb(value) }
        } catch (_: Exception) {
            cb(value)
        }
    }

    companion object {
        const val ME_PATH = "/v1/me"

        // Borne de décodage : une photo d'identité ne dépasse pas quelques
        // dizaines de Ko. Au-delà = payload refusé (pas de OOM sur l'UI thread).
        const val PHOTO_MAX_BYTES = 2 * 1024 * 1024
        private const val PHOTO_MAX_PX = 512

        /** Chemin proxy de la photo, ou null si le contrat n'en publie pas. */
        fun photoPath(profile: UserProfile): String? {
            if (!UserProfileRules.isValidPhotoRef(profile.photoRef)) return null
            if (!UserProfileRules.isValidAccountId(profile.accountId)) return null
            return ServerConfig.mediaPath(profile.photoRef, profile.accountId)
        }

        /**
         * Payload /v1/me -> profil. `user` absent ou null = établissement sans
         * infos publiées : null (écran vide), jamais de profil d'exemple.
         * Toute valeur non conforme au contrat fait échouer isValid.
         */
        fun parse(body: String): UserProfile? {
            return try {
                val root = JSONObject(body)
                if (root.isNull("user")) return null
                val u = root.optJSONObject("user") ?: return null
                val accountId = u.optString("accountId", "").trim()
                val displayName = u.optString("displayName", "").trim()
                val kidsArr = u.optJSONArray("kids")
                val kids = mutableListOf<ChildAccount>()
                if (kidsArr != null) {
                    for (i in 0 until kidsArr.length()) {
                        val k = kidsArr.optJSONObject(i) ?: continue
                        kids.add(
                            ChildAccount(
                                accountId = k.optString("accountId", "").trim(),
                                displayName = k.optString("displayName", "").trim(),
                                classLabel = k.optString("classLabel", "").trim(),
                            ),
                        )
                    }
                }
                val profile = UserProfile(
                    accountId = accountId,
                    displayName = displayName,
                    firstName = u.optString("firstName", "").trim(),
                    lastName = u.optString("lastName", "").trim(),
                    classLabel = u.optString("classLabel", "").trim(),
                    periodName = u.optString("periodName", "").trim(),
                    photoRef = u.optString("photoRef", "").trim(),
                    hasKids = u.optBoolean("hasKids", false),
                    kids = kids,
                )
                if (UserProfileRules.isValid(profile)) profile else null
            } catch (_: Exception) {
                null
            }
        }

        /**
         * Décode les octets renvoyés par le proxy serveur. Bornes : taille
         * maximale + rééchantillonnage, sinon null (avatar de repli).
         */
        fun decodePhoto(bytes: ByteArray): Bitmap? {
            if (bytes.isEmpty() || bytes.size > PHOTO_MAX_BYTES) return null
            val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
            if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
            var sample = 1
            while (bounds.outWidth / sample > PHOTO_MAX_PX || bounds.outHeight / sample > PHOTO_MAX_PX) sample *= 2
            val opts = BitmapFactory.Options().apply { inSampleSize = sample }
            return try {
                BitmapFactory.decodeByteArray(bytes, 0, bytes.size, opts)
            } catch (_: Exception) {
                null
            }
        }
    }
}