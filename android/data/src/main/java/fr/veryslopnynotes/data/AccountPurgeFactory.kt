package fr.veryslopnynotes.data

import fr.veryslopnynotes.core.ThreadMessageCache
import java.io.File

/**
 * Les objets réels que la purge doit atteindre. Tous les stores sont fournis
 * explicitement : une étape manquante est un échec de plan, jamais un oubli.
 */
class AccountPurgeTargets(
    val sessions: SessionStore,
    val accounts: AccountStore,
    val cacheStore: CacheStore,
    val cacheRoot: File,
    val manuals: ManualStore,
    val lessons: LessonNotesRepository,
    val teacherChat: TeacherChatLocalStore,
    val prefs: SubjectPrefsRepository,
    val llmKeys: LlmKeyStore,
    val serverStore: ServerStore,
    val webView: WebViewAccountData = WebViewAccountData(),
    /** États du pont qui ne sont pas des stores (adresses de manuel essayées). */
    val onManualPurged: () -> Unit = {},
)

/**
 * Câblage UNIQUE des étapes de purge. L'ordre suit l'inventaire : les artefacts
 * nommés d'abord, le cache EN DERNIER. Pour une bascule, l'étape cache publie
 * le nouveau client dans la même section critique que l'effacement (I16).
 */
object AccountPurgeFactory {
    fun runner(targets: AccountPurgeTargets): AccountPurgeRunner = AccountPurgeRunner { mode, switch ->
        if (mode == AccountPurgeMode.ACCOUNT_SWITCH && switch == null) {
            AccountPurgeResult.Incomplete(emptyList(), emptyList(), listOf(AccountDataStore.CACHE))
        } else {
            plan(targets, mode, switch).purge()
        }
    }

    fun plan(
        targets: AccountPurgeTargets,
        mode: AccountPurgeMode,
        switch: AccountSwitch? = null,
    ): AccountPurgePlan = AccountPurgePlan.of(
        mode,
        listOf(
            AccountPurgeStep(AccountDataStore.SESSION) {
                var cleared = false
                SessionRepair.clearSession {
                    cleared = targets.sessions.clear().ok
                }
                cleared
            },
            AccountPurgeStep(AccountDataStore.ACCOUNTS) { targets.accounts.clear().ok },
            AccountPurgeStep(AccountDataStore.COURSE_NOTES) { targets.lessons.clear() },
            AccountPurgeStep(AccountDataStore.TEACHER_CHAT) { targets.teacherChat.clear() },
            AccountPurgeStep(AccountDataStore.SUBJECT_PREFS) { targets.prefs.clear() },
            AccountPurgeStep(AccountDataStore.MANUAL) {
                val cleared = targets.manuals.clearAccountData()
                targets.onManualPurged()
                cleared
            },
            AccountPurgeStep(AccountDataStore.ATTACHMENTS) {
                DownloadedFiles.purge(targets.cacheRoot, DownloadedFiles.ATTACHMENTS)
            },
            AccountPurgeStep(AccountDataStore.EXPORTS) {
                DownloadedFiles.purge(targets.cacheRoot, DownloadedFiles.EXPORTS)
            },
            AccountPurgeStep(AccountDataStore.PHOTOS) { deleteDir(File(targets.cacheRoot, "photos")) },
            AccountPurgeStep(AccountDataStore.READ_STATE) { targets.webView.clearReadState() },
            AccountPurgeStep(AccountDataStore.WEBVIEW) { targets.webView.clearCache() },
            AccountPurgeStep(AccountDataStore.LLM_KEY) {
                try {
                    targets.llmKeys.clear()
                    !targets.llmKeys.isConfigured()
                } catch (_: Exception) {
                    false
                }
            },
            AccountPurgeStep(AccountDataStore.SERVER_URL) { targets.serverStore.clear() },
            AccountPurgeStep(AccountDataStore.CACHE) {
                val target = switch
                if (target == null) {
                    CacheScope.purge(targets.cacheStore)
                } else {
                    // Une bascule remplace aussi les caches mémoire, avant de
                    // publier le nouveau client.
                    ThreadMessageCache.clear()
                    DiscussionListCache.clear()
                    CacheScope.switchAccount(
                        targets.cacheStore,
                        target.previous,
                        target.current,
                        target.publish,
                    ) != CacheSwitch.Failed
                }
            },
        ),
    )

    private fun deleteDir(dir: File): Boolean = try {
        !dir.exists() || (dir.deleteRecursively() && !dir.exists())
    } catch (_: Exception) {
        false
    }
}
