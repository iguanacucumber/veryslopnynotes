package fr.veryslopnynotes.data

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.util.UUID

/**
 * Fichier corrompu (#887) : la cible part en quarantaine, la sauvegarde est
 * restaurée ; sans sauvegarde l'erreur est DITE (`LocalDataUnreadable`), jamais
 * écrasée en silence. Le vrai `DurableFile` tourne sur le système de fichiers
 * de l'émulateur (rename atomique + fsync).
 */
@RunWith(AndroidJUnit4::class)
class CorruptFileInstrumentedTest {
    private lateinit var dir: File

    @Before
    fun setUp() {
        dir = File(
            InstrumentationRegistry.getInstrumentation().targetContext.cacheDir,
            "corrupt-${UUID.randomUUID()}",
        ).apply { mkdirs() }
    }

    @After
    fun tearDown() {
        dir.deleteRecursively()
    }

    @Test
    fun corruption_restaure_la_sauvegarde_et_garde_l_octet_en_quarantaine() {
        val target = File(dir, "store.json")
        DurableFile.write(target, "v1".toByteArray())
        DurableFile.write(target, "v2".toByteArray())
        target.writeText("BAD{corrompu")

        val value = DurableFile.read(target) { raw -> raw.takeIf { !it.startsWith("BAD") } }

        assertEquals("v1", value)
        assertEquals("v1", target.readText())
        val quarantined = quarantined(target)
        assertTrue("le fichier corrompu doit rester inspectable", quarantined.isFile)
        assertEquals("BAD{corrompu", quarantined.readText())
    }

    @Test
    fun sans_sauvegarde_la_lecture_leve_et_ne_perd_pas_le_fichier() {
        val target = File(dir, "store.json")
        target.writeText("BAD{seul")

        assertThrows(LocalDataUnreadable::class.java) {
            DurableFile.read(target) { raw -> raw.takeIf { !it.startsWith("BAD") } }
        }

        assertFalse(target.exists())
        assertEquals("BAD{seul", quarantined(target).readText())
    }

    private fun quarantined(target: File): File =
        File(dir, "quarantine").listFiles()
            .orEmpty()
            .single { it.name.startsWith("${target.name}.") && it.name.endsWith(".corrupt") }
}
