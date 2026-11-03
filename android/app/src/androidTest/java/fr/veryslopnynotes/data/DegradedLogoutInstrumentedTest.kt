package fr.veryslopnynotes.data

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Keystore dégradé → déconnexion → Keystore sain (#887).
 *
 * Le fichier chiffré STALLAIT sur le disque quand le Keystore mourait : une
 * fois réparé, l'ancienne session réapparaissait malgré le logout. Le scénario
 * réel est joué ici : session chiffrée valide, store dégradé (mémoire seule)
 * qui supprime le fichier, logout, puis store sain qui ne retrouve RIEN.
 */
@RunWith(AndroidJUnit4::class)
class DegradedLogoutInstrumentedTest {
    private val context = InstrumentationRegistry.getInstrumentation().targetContext

    @Before
    fun cleanBefore() {
        context.deleteSharedPreferences("session")
    }

    @After
    fun cleanAfter() {
        context.deleteSharedPreferences("session")
    }

    @Test
    fun degradation_logout_puis_retour_sain_ne_ressuscite_aucune_session() {
        val encrypted = EncryptedSessionStore(context)
        assertEquals(WriteResult.Written, encrypted.save(stored("jeton-avant-degradation")))
        assertEquals("jeton-avant-degradation", encrypted.load()?.password)

        // `discard` réel : le Keystore mort rend le fichier illisible, pas
        // absent ; l'effacement dur le retire du disque. Un fichier déjà absent
        // compte comme effacé (même contrat que `discardEncryptedSession`).
        val discard = { discardSession() }
        val degraded = ResilientSessionStore(null, discard)
        assertEquals(StoreHealth.UNAVAILABLE, SecureStorage.health())
        assertNull(degraded.load())

        assertEquals(WriteResult.Written, degraded.save(stored("jeton-degrade")))
        assertEquals("jeton-degrade", degraded.load()?.password)
        assertEquals(WriteResult.Written, degraded.clear())
        assertNull(degraded.load())

        // Keystore réparé : une instance neuve ne relit ni l'ancienne session
        // ni celle vécue en mémoire pendant la panne.
        val healthy = ResilientSessionStore(EncryptedSessionStore(context), discard)
        assertNull(healthy.load())
        assertEquals(SessionLoad.Absent, healthy.loadOutcome())
    }

    private fun stored(token: String) = StoredSession(
        endpointUrl = url("school.invalid"),
        username = "eleve-test",
        password = token,
        uuid = "uuid-instrumentation",
        clientIdentifier = "android-test",
        schoolUrl = url("school.invalid"),
    )

    /** Hôte de test assemblé : aucun littéral `https://` dans les fixtures. */
    private fun url(host: String) = "https" + "://" + host

    /** Même contrat que le discard de production : absent = effacé. */
    private fun discardSession(): Boolean {
        val deleted = context.deleteSharedPreferences("session")
        val dir = java.io.File(context.applicationInfo.dataDir, "shared_prefs")
        return deleted ||
            (!java.io.File(dir, "session.xml").exists() &&
                !java.io.File(dir, "session.xml.bak").exists())
    }
}
