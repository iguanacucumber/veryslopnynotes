package fr.veryslopnynotes.data

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

/**
 * Roundtrip de la clé LLM sur le VRAI Keystore Android (#887) : écriture
 * chiffrée, relecture par une AUTRE instance (donc depuis le disque), puis
 * effacement. Le secret ne doit jamais apparaître en clair dans `shared_prefs`.
 */
@RunWith(AndroidJUnit4::class)
class LlmKeyRoundtripInstrumentedTest {
    private val context = InstrumentationRegistry.getInstrumentation().targetContext
    private val secret = "instrumentation-only-llm-key"

    @Before
    fun cleanBefore() {
        context.deleteSharedPreferences("llm_keys")
    }

    @After
    fun cleanAfter() {
        context.deleteSharedPreferences("llm_keys")
    }

    @Test
    fun cle_chiffree_relue_par_une_instance_neuve_puis_effacee() {
        val store = EncryptedLlmKeyStore(context)
        store.clear()

        store.save("  $secret  ")
        assertEquals(secret, store.apiKey())
        assertEquals(secret, EncryptedLlmKeyStore(context).apiKey())

        assertFalse(
            "la clé ne doit jamais être écrite en clair sous shared_prefs",
            sharedPrefsContain(secret),
        )

        store.clear()
        assertNull(store.apiKey())
        assertNull(EncryptedLlmKeyStore(context).apiKey())
    }

    private fun sharedPrefsContain(value: String): Boolean {
        val dir = File(context.applicationInfo.dataDir, "shared_prefs")
        return dir.listFiles().orEmpty().any { file ->
            file.isFile && file.readBytes().toString(Charsets.ISO_8859_1).contains(value)
        }
    }
}
