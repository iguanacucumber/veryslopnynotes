package fr.veryslopnynotes.data

import android.content.SharedPreferences

/**
 * Adaptateur Android de [KeyValueStore] : `commit()` SYNCHRONE, jamais
 * `apply()`, et son `Boolean` est rendu tel quel. Un échec disque remonte donc
 * à l'appelant au lieu d'être perdu après le retour.
 */
internal class SharedPrefsKeyValue(private val prefs: SharedPreferences) : KeyValueStore {
    override fun getString(key: String): String? = prefs.getString(key, null)

    override fun commit(values: Map<String, String>): Boolean = try {
        val editor = prefs.edit()
        for ((key, value) in values) editor.putString(key, value)
        editor.commit()
    } catch (_: Exception) {
        false
    }

    override fun clear(): Boolean = try {
        prefs.edit().clear().commit()
    } catch (_: Exception) {
        false
    }
}
