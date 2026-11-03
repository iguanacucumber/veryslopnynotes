package fr.veryslopnynotes.app

import android.view.WindowManager
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

/**
 * `FLAG_SECURE` sur une VRAIE fenêtre (#887) : le debug reste capturable, la
 * décision release pose le flag sur l'activité. `make shot` et le débogage
 * WebView dépendent de l'exemption debug ; l'aperçu des récents dépend du flag
 * release.
 */
@RunWith(AndroidJUnit4::class)
class SecureWindowInstrumentedTest {
    private val flag = WindowManager.LayoutParams.FLAG_SECURE

    @Test
    fun debug_capturable_et_release_protegee() {
        assertFalse(secureWindowRequired(isDebugBuild = true))
        assertTrue(secureWindowRequired(isDebugBuild = false))

        val scenario = ActivityScenario.launch(MainActivity::class.java)
        try {
            scenario.onActivity { activity ->
                // L'APK de test est debug : l'activité ne doit PAS masquer la
                // capture au lancement (make shot, CDP).
                assertEquals(0, activity.window.attributes.flags and flag)

                // Le câblage release, sur la même vraie fenêtre.
                applySecureWindow(activity.window, isDebugBuild = false)
                assertTrue(activity.window.attributes.flags and flag != 0)
            }
        } finally {
            scenario.close()
        }
    }
}
