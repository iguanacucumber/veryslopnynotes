package fr.veryslopnynotes.app

import android.graphics.Bitmap
import android.util.Base64
import fr.veryslopnynotes.core.ChildAccount
import fr.veryslopnynotes.core.UserProfile
import fr.veryslopnynotes.data.MeResult
import fr.veryslopnynotes.data.PhotoState
import fr.veryslopnynotes.data.ProfileRepository
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream

// --- Profil ----------------------------------------------------------------

internal fun VsnBridge.profileMe(): JSONObject {
    val result = await<MeResult> { cb -> profileRepo.fetchMe(cb) }
        ?: throw BridgeFailure("unavailable", "Profil indisponible.")
    return when (result) {
        is MeResult.Ok -> {
            cachedProfile = result.profile
            JSONObject()
                .put("payload", JSONObject().put("user", result.profile?.let { profileJson(it) } ?: JSONObject.NULL).toString())
        }
        is MeResult.Err -> {
            sessionOrThrow(result.message)
            JSONObject()
                .put("payload", JSONObject.NULL)
                .put("error", result.message)
        }
    }
}

internal fun VsnBridge.profilePhoto(): JSONObject {
    val me = await<MeResult> { cb -> profileRepo.fetchMe(cb) }
    val profile = (me as? MeResult.Ok)?.profile
        ?: return JSONObject().put("dataUrl", JSONObject.NULL)
    cachedProfile = profile
    val photo = await<PhotoState> { cb -> profileRepo.fetchPhoto(profile) { bitmap -> cb(bitmap.toState()) } }
    val bitmap = (photo as? PhotoState.Loaded)?.bitmap
        ?: return JSONObject().put("dataUrl", JSONObject.NULL)
    return try {
        val out = ByteArrayOutputStream()
        bitmap.compress(Bitmap.CompressFormat.PNG, 100, out)
        val bytes = out.toByteArray()
        if (bytes.isEmpty() || bytes.size > ProfileRepository.PHOTO_MAX_BYTES) {
            JSONObject().put("dataUrl", JSONObject.NULL)
        } else {
            val encoded = Base64.encodeToString(bytes, Base64.NO_WRAP)
            JSONObject().put("dataUrl", "data:image/png;base64,$encoded")
        }
    } catch (_: Exception) {
        JSONObject().put("dataUrl", JSONObject.NULL)
    }
}

internal fun Bitmap?.toState(): PhotoState =
    if (this == null) PhotoState.Absent else PhotoState.Loaded(this)

internal fun VsnBridge.profileJson(profile: UserProfile): JSONObject = JSONObject()
    .put("accountId", profile.accountId)
    .put("displayName", profile.displayName)
    .put("firstName", profile.firstName)
    .put("lastName", profile.lastName)
    .put("classLabel", profile.classLabel)
    .put("periodName", profile.periodName)
    .put("hasKids", profile.hasKids)
    .put("kids", JSONArray().apply {
        for (k: ChildAccount in profile.kids) {
            put(
                JSONObject()
                    .put("accountId", k.accountId)
                    .put("displayName", k.displayName)
                    .put("classLabel", k.classLabel),
            )
        }
    })

