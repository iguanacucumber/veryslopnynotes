package fr.veryslopnynotes.data

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import fr.veryslopnynotes.pronote.Client
import java.io.File
import java.util.concurrent.TimeUnit

// Sync périodique de fond : SANS serveur, donc ni SSE, ni push, ni cron.
// WorkManager est la seule solution sans serveur. Relit notes/devoirs/EDT par
// la MÊME porte que les écrans (`cachedRead` sur les ressources `CachePolicy`)
// et réécrit le même cache fichier (`offline/`).
//
// Contraintes réseau connecté + batterie non faible, intervalle 6 h, backoff
// exponentiel 10 min, travail unique (KEEP).
//
// Le job démarre un process NEUF : la session n'est pas en RAM, il la RESTAURE
// par le même chemin que le pont. Sans session lisible, il RÉESSAIE : un
// `success()` déclarerait un succès qui n'a rien fait. Session MORTE pendant la
// lecture = succès (signal d'appairage, un retry ne ressusciterait rien).
// ponytail: « jamais appairé » retente aussi (pas d'autre signal).
//   Upgrade: distinguer « store vide » (succès) de « non restaurable » (retry).
// ponytail: Worker bloquant (le module n'a pas de coroutines).
//   Upgrade: une entrée de cache par requête quand SyncedRepository en aura une.
class PeriodicSyncWorker(
    context: Context,
    params: WorkerParameters,
) : Worker(context, params) {
    override fun doWork(): Result {
        return when (val outcome = syncJobOutcome(restoreClient())) {
            is SyncJobOutcome.Retry -> Result.retry()
            is SyncJobOutcome.Refresh -> refresh(outcome.session)
        }
    }

    /**
     * Lecture des trois ressources + réécriture du cache.
     *
     * Les lectures passent par la file PARTAGÉE, comme celles des écrans. Le
     * `Client` est MUTABLE (`refresh()` réassigne son état) : une lecture de
     * l'écran et une du job en parallèle = deux authentifications sur le même
     * compte = erreur 25, puis l'établissement LIMITE le compte.
     *
     * Le job est bloquant : il attend dans la file, délai borné par
     * `READ_TIMEOUT_MS`, puis réessaie (jamais WorkManager bloqué sans fin).
     */
    private fun refresh(client: Client): Result {
        val store = cacheStore()
        // Époque capturée AVANT les lectures : une déconnexion pendant la
        // lecture annule l'écriture du cache.
        val epoch = SessionEpoch.current()
        val now = System.currentTimeMillis()
        return try {
            for (resource in JOB_RESOURCES) {
                // Clé namespacée `job|` : jamais celle d'un écran, donc jamais
                // un résultat étranger.
                val outcome = ClientQueue.submitAndAwait("job|$resource|", READ_TIMEOUT_MS) {
                    safeRead { cachedRead(client, resource, "") }
                } ?: return Result.retry()
                // Un travail qui JETTE est un échec livré : l'attente finit
                // tout de suite, et la cause décide.
                val read = when (outcome) {
                    is QueueOutcome.Failed -> return failure(outcome.cause)
                    is QueueOutcome.Ok -> outcome.value
                }
                when (val decision = syncJobDecision(read)) {
                    SyncJobDecision.Retry -> return Result.retry()
                    SyncJobDecision.SessionDead -> {
                        DeviceAuth.reject()
                        return Result.success()
                    }
                    is SyncJobDecision.Loaded -> {
                        if (!saveIfCurrent(epoch, store, resource, decision.payload, now, "")) {
                            return Result.success()
                        }
                    }
                }
            }
            Result.success()
        } catch (e: Exception) {
            failure(e)
        }
    }

    /**
     * Session MORTE = l'app doit se ré-appairer : le job « réussit ». Autre
     * échec = RÉESSAI (backoff WorkManager).
     */
    private fun failure(e: Throwable): Result =
        if (isSessionFailure(e)) {
            DeviceAuth.reject()
            Result.success()
        } else {
            Result.retry()
        }

    /**
     * Session du process, restaurée si absente, par le même chemin que le pont.
     * `null` = aucune session lisible : le job réessaiera. La session déjà en
     * RAM est réutilisée ; la restauration passe par le verrou partagé, donc
     * pont et job n'ouvrent jamais deux sessions en parallèle (erreur 25).
     */
    private fun restoreClient(): Client? {
        PronoteSession.client?.let { return it }
        val sessions = SessionStores.get(applicationContext)
        // Le dépôt purge le cache si la session est MORTE : même chemin et même
        // store que le pont, sinon l'app servirait les données d'un compte mort.
        val restored = PairingRepository(sessions, cacheStore()).restoreBlocking()
        return if (restored is RestoreResult.Restored) PronoteSession.client else null
    }

    /**
     * Même dossier que l'app (`filesDir/offline`) : verrou partagé. Le store
     * englobe `cacheDir/` : une purge de compte efface aussi les pièces
     * jointes téléchargées.
     */
    private fun cacheStore(): CacheStore =
        LocalDataStore(FileCacheStore(File(applicationContext.filesDir, "offline")), applicationContext.cacheDir)

    /**
     * `false` = la session a changé pendant la lecture, rien n'a été écrit. Une
     * erreur d'écriture, elle, remonte (retry). La requête est écrite avec
     * l'entrée, sinon l'écriture serait invisible pour la relecture.
     */
    private fun saveIfCurrent(
        epoch: Long,
        store: CacheStore,
        resource: String,
        payload: String,
        now: Long,
        query: String,
    ): Boolean {
        val written = SessionEpoch.writeIfCurrent(epoch) { store.save(resource, payload, now, query) }
        return written != null
    }

    companion object {
        const val UNIQUE_WORK_NAME = "periodic-sync"
        const val INTERVAL_HOURS = 6L
        const val BACKOFF_MINUTES = 10L

        /**
         * Les trois ressources relues (requête vide = vue par défaut, fenêtre
         * courante : ce que demandent l'accueil et l'EDT).
         */
        private val JOB_RESOURCES =
            listOf(CachePolicy.GRADES, CachePolicy.ASSIGNMENTS, CachePolicy.TIMETABLE)

        /**
         * Délai d'attente d'une lecture dans la file : au-delà, le job
         * RÉESSAIE. 2 min < la limite de 10 min de WorkManager, pour ne pas se
         * faire tuer en attendant.
         */
        private const val READ_TIMEOUT_MS = 120_000L

        fun schedule(context: Context) {
            val constraints = Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .setRequiresBatteryNotLow(true)
                .build()
            val request = PeriodicWorkRequestBuilder<PeriodicSyncWorker>(INTERVAL_HOURS, TimeUnit.HOURS)
                .setConstraints(constraints)
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, BACKOFF_MINUTES, TimeUnit.MINUTES)
                .addTag(UNIQUE_WORK_NAME)
                .build()
            WorkManager.getInstance(context).enqueueUniquePeriodicWork(
                UNIQUE_WORK_NAME,
                ExistingPeriodicWorkPolicy.KEEP,
                request,
            )
        }
    }
}
