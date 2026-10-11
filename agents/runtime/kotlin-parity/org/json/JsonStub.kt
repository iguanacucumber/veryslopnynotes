// JsonStub.kt — doublure de `org.json` pour le harnais de parité (#202).
//
// `android/core/.../Capabilities.kt` importe `org.json.JSONObject` (SDK Android,
// indisponible sous `kotlinc` seul). Le harnais compile les sources du port
// sans SDK : cette doublure fournit les SIGNATURES utilisées, rien de plus.
// Chaque méthode lève à l'appel — aucune opération de parité n'appelle
// `Capabilities.parse` (lecture de payload, pas domaine pur), donc ce code ne
// s'exécute jamais. Si une future opération l'atteint, elle échoue bruyamment
// au lieu de comparer du faux.
//
// Test-only : compilé uniquement par `tests/unit/kotlin-domain-parity.test.ts`,
// jamais par Gradle, jamais dans l'APK.
package org.json

class JSONObject(@Suppress("UNUSED_PARAMETER") raw: String) {
    fun isNull(@Suppress("UNUSED_PARAMETER") key: String): Boolean =
        throw UnsupportedOperationException("doublure org.json : Capabilities.parse n'est pas rejoué en parité")
    fun optJSONObject(@Suppress("UNUSED_PARAMETER") key: String): JSONObject? =
        throw UnsupportedOperationException("doublure org.json : Capabilities.parse n'est pas rejoué en parité")
    fun optString(@Suppress("UNUSED_PARAMETER") key: String, @Suppress("UNUSED_PARAMETER") default: String): String =
        throw UnsupportedOperationException("doublure org.json : Capabilities.parse n'est pas rejoué en parité")
    fun optJSONArray(@Suppress("UNUSED_PARAMETER") key: String): JSONArray? =
        throw UnsupportedOperationException("doublure org.json : Capabilities.parse n'est pas rejoué en parité")
}

class JSONArray {
    fun length(): Int =
        throw UnsupportedOperationException("doublure org.json : Capabilities.parse n'est pas rejoué en parité")
    fun optString(@Suppress("UNUSED_PARAMETER") index: Int, @Suppress("UNUSED_PARAMETER") default: String): String =
        throw UnsupportedOperationException("doublure org.json : Capabilities.parse n'est pas rejoué en parité")
}
