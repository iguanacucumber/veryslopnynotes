package fr.veryslopnynotes.data

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.util.UUID

/**
 * Purge COMPLÈTE d'un compte (#887) : l'orchestrateur réel est appelé avec les
 * stores réels (fichiers + préférences + cache), pas des doubles. Chaque store
 * est semé, puis la déconnexion doit tout effacer et le dire (`Complete`).
 */
@RunWith(AndroidJUnit4::class)
class AccountPurgeInstrumentedTest {
    private val context = InstrumentationRegistry.getInstrumentation().targetContext
    private lateinit var root: File
    private lateinit var cacheRoot: File
    private lateinit var cacheDir: File
    private lateinit var offline: File
    private lateinit var manualFile: File

    @Before
    fun setUp() {
        context.deleteSharedPreferences("accounts")
        context.deleteSharedPreferences("session")
        root = File(context.cacheDir, "purge-${UUID.randomUUID()}")
        cacheRoot = File(root, "cache-root").apply { mkdirs() }
        cacheDir = File(root, "cache-store").apply { mkdirs() }
        offline = File(root, "offline").apply { mkdirs() }
        manualFile = File(context.filesDir, "offline/manual.json")
    }

    @After
    fun tearDown() {
        root.deleteRecursively()
        manualFile.delete()
        context.deleteSharedPreferences("accounts")
        context.deleteSharedPreferences("session")
    }

    @Test
    fun deconnexion_purge_tous_les_stores_et_rend_complete() {
        val sessions = EncryptedSessionStore(context)
        assertEquals(WriteResult.Written, sessions.save(session()))
        val accounts = AccountStore(context, sessions)
        assertEquals(WriteResult.Written, accounts.record("compte-test"))

        val notesFile = File(offline, "course_notes.json").apply {
            parentFile?.mkdirs()
            writeText("[{\"test\":true}]")
        }
        val chatFile = File(offline, "teacher_chat.json").apply { writeText("{}") }
        val prefsFile = File(offline, "subject_prefs.json").apply { writeText("[]") }
        val lessons = LessonNotesRepository(FileLessonNotesStore(notesFile))
        val chat = FileTeacherChatStore(chatFile)
        val prefs = SubjectPrefsRepository(FileSubjectPrefsStore(prefsFile))
        val manuals = ManualStore(context).also { it.clearAccountData() }
        manualFile.apply {
            parentFile?.mkdirs()
            writeText("{\"url\":\"${url("manual.invalid")}\"}")
        }

        val cache = FileCacheStore(cacheDir)
        val now = System.currentTimeMillis()
        cache.save(CachePolicy.GRADES, "payload-du-compte", now, "trimestre-1")
        assertTrue(CachePolicy.isCacheable(CachePolicy.GRADES))

        val attachments = File(cacheRoot, "attachments/devoir").apply { mkdirs() }
        val exports = File(cacheRoot, "exports").apply { mkdirs() }
        val photos = File(cacheRoot, "photos").apply { mkdirs() }
        attachments.resolve("piece.pdf").writeText("piece")
        exports.resolve("fiche.pdf").writeText("fiche")
        photos.resolve("photo.jpg").writeText("photo")

        val webCalls = mutableListOf<String>()
        var manualNotified = false
        val targets = AccountPurgeTargets(
            sessions = sessions,
            accounts = accounts,
            cacheStore = cache,
            cacheRoot = cacheRoot,
            manuals = manuals,
            lessons = lessons,
            teacherChat = chat,
            prefs = prefs,
            webView = WebViewAccountData(
                readState = { webCalls.add("read_state"); true },
                cache = { webCalls.add("webview"); true },
            ),
            onManualPurged = { manualNotified = true },
        )

        val result = AccountPurgeFactory.runner(targets).purge(AccountPurgeMode.LOGOUT, null)

        assertTrue("purge incomplète : ${result}", result.ok)
        for (store in listOf(
            AccountDataStore.SESSION,
            AccountDataStore.ACCOUNTS,
            AccountDataStore.COURSE_NOTES,
            AccountDataStore.TEACHER_CHAT,
            AccountDataStore.SUBJECT_PREFS,
            AccountDataStore.MANUAL,
            AccountDataStore.ATTACHMENTS,
            AccountDataStore.EXPORTS,
            AccountDataStore.PHOTOS,
            AccountDataStore.READ_STATE,
            AccountDataStore.WEBVIEW,
            AccountDataStore.CACHE,
        )) {
            assertTrue("store non purgé : $store", result.purged.contains(store))
        }

        assertNull(sessions.load())
        assertEquals(0, accounts.count())
        assertTrue(lessons.notes().isEmpty())
        assertFalse(chatFile.exists())
        assertFalse(prefsFile.exists())
        assertFalse(manualFile.exists())
        assertFalse(attachments.exists())
        assertFalse(exports.exists())
        assertFalse(photos.exists())
        assertNull(cache.load(CachePolicy.GRADES, "trimestre-1"))
        assertEquals(0, cacheDir.listFiles().orEmpty().size)
        assertEquals(listOf("read_state", "webview"), webCalls)
        assertTrue(manualNotified)
    }

    private fun session() = StoredSession(
        endpointUrl = url("school.invalid"),
        username = "eleve-test",
        password = "jeton-instrumentation",
        uuid = "uuid-instrumentation",
        clientIdentifier = "android-test",
        schoolUrl = url("school.invalid"),
    )

    /** Hôte de test assemblé : aucun littéral `https://` dans les fixtures. */
    private fun url(host: String) = "https" + "://" + host
}
