package fr.veryslopnynotes.data

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.os.Handler
import android.os.Looper
import fr.veryslopnynotes.core.ChildAccount
import fr.veryslopnynotes.core.UserProfile
import fr.veryslopnynotes.core.UserProfileRules
import java.time.Clock

sealed interface PhotoState {
    data object Absent : PhotoState
    data class Loaded(val bitmap: Bitmap) : PhotoState
}

sealed interface MeResult {
    data class Ok(val profile: UserProfile?) : MeResult
    data class Err(val message: String) : MeResult
    /** Session changée pendant la lecture : ce profil n'est pas le compte courant. */
    data object Stale : MeResult
}

// Jamais d'adresse d'établissement dans l'app, jamais de WebView.
// ponytail: rien n'est persisté ici (mode anonyme) : le profil vit en mémoire et
// disparaît à la déconnexion (PairingRepository.logoutBlocking). Upgrade: cache profil chiffré
// si l'utilisateur demande explicitement de garder son profil hors-ligne.
class ProfileRepository(
    private val provider: PronoteClientProvider = { PronoteSession.client },
    // Callback sur le thread principal : l'état Compose n'est jamais écrit
    // depuis le thread OkHttp.
    private val main: Handler = Handler(Looper.getMainLooper()),
    private val schoolTime: Clock = schoolClock(),
) {
    /** Le profil n'est jamais écrit sur disque. */
    fun fetchMe(epoch: Long = SessionEpoch.current(), cb: (MeResult) -> Unit) {
        ClientQueue.submitUnit(
            key = "profile-me|",
            work = {
            if (!SessionEpoch.isCurrent(epoch)) {
                post(epoch, cb, MeResult.Stale, MeResult.Stale)
                return@submitUnit
            }
            val client = provider()
            if (client == null) {
                // Sans session : mode anonyme, état vide — jamais d'écran
                // d'erreur plein écran.
                post(epoch, cb, MeResult.Stale, MeResult.Ok(null))
                return@submitUnit
            }
            try {
                // user null = infos non publiées, pas une erreur.
                post(epoch, cb, MeResult.Stale, MeResult.Ok(parse(mePayload(client, schoolTime))))
            } catch (e: Exception) {
                if (isSessionFailure(e)) {
                    DeviceAuth.reject()
                    post(epoch, cb, MeResult.Stale, MeResult.Err(DeviceAuth.REJECTED_MESSAGE))
                } else {
                    post(epoch, cb, MeResult.Stale, MeResult.Ok(null))
                }
            }
            },
            onFailure = { post(epoch, cb, MeResult.Stale, MeResult.Ok(null)) },
        )
    }

    /**
     * Photo lue depuis la réf opaque `photo:<id>` (jamais une URL d'établissement).
     * Réf absente/invalide ou échec = null, l'UI affiche les initiales.
     */
    fun fetchPhoto(epoch: Long = SessionEpoch.current(), profile: UserProfile, cb: (Bitmap?) -> Unit) {
        ClientQueue.submitUnit(
            key = "profile-photo|${profile.photoRef}",
            work = {
            if (!SessionEpoch.isCurrent(epoch)) {
                post(epoch, cb, null, null)
                return@submitUnit
            }
            val bytes = try {
                val client = provider() ?: return@submitUnit post(epoch, cb, null, null)
                val ref = profile.photoRef.trim()
                if (!UserProfileRules.isValidPhotoRef(ref)) return@submitUnit post(epoch, cb, null, null)
                val wantId = ref.removePrefix("photo:")
                val pic = client.info.profilePicture
                if (pic == null || pic.id != wantId) return@submitUnit post(epoch, cb, null, null)
                pic.data()
            } catch (_: Exception) {
                return@submitUnit post(epoch, cb, null, null)
            }
            post(epoch, cb, null, decodePhoto(bytes))
            },
            onFailure = { post(epoch, cb, null, null) },
        )
    }

    /** Livre [value] seulement si l'époque n'a pas changé ; sinon [stale]. */
    private fun <T> post(epoch: Long, cb: (T) -> Unit, stale: T, value: T) {
        val deliver = {
            if (SessionEpoch.isCurrent(epoch)) cb(value) else cb(stale)
        }
        try {
            main.post(deliver)
        } catch (_: Exception) {
            deliver()
        }
    }

    companion object {
        // Borne de décodage : une photo d'identité ne dépasse pas quelques
        // dizaines de Ko. Au-delà = payload refusé (pas de OOM sur l'UI thread).
        const val PHOTO_MAX_BYTES = 2 * 1024 * 1024
        private const val PHOTO_MAX_PX = 512

        /**
         * `user` absent ou null = établissement sans infos publiées : null
         * (écran vide), jamais de profil d'exemple. Une valeur hors contrat
         * fait échouer `isValid`.
         */
        fun parse(body: String): UserProfile? {
            return try {
                val root = org.json.JSONObject(body)
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
         * Bornes taille + rééchantillonnage ; sinon null (avatar de repli).
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
