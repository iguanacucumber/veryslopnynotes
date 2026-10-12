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
import java.io.File
import java.util.concurrent.TimeUnit

// Sync périodique de fond (#208) : SANS serveur, donc ni SSE (flux du
// serveur vers l'app), ni push (jamais câblé), ni cron serveur (jamais
// câblé). WorkManager est la seule solution de sync périodique sans serveur.
// Relit notes/devoirs/EDT sur le client local du téléphone (mêmes payloads
// et bornes que SyncedRepository : gradesPayload, assignmentsPayload,
// timetablePayload) et réécrit le cache fichier partagé avec les écrans
// (même répertoire "offline" que AppNav, mêmes clés CachePolicy).
//
// Pas de drain batterie : contraintes réseau connecté + batterie non faible,
// intervalle 6 h (les données scolaires changent quelques fois par jour ; le
// TTL court reste l'affaire du premier plan), backoff exponentiel 10 min sur
// échec, travail unique (KEEP : jamais deux planifications).
//
// Session : pas de client local (jamais appairé) = succès sans rien faire
// (relancer en boucle ne servirait à rien) ; session locale morte = signal
// d'appairage + succès (un retry ne ressusciterait pas la session, et un
// échec permanent userait la batterie). Autre échec = retry (backoff).
// ponytail: Worker bloquant (pas de CoroutineWorker : le module n'a pas de
// coroutines, tout le reste est en Thread). Upgrade: clé de cache par
// fenêtre quand SyncedRepository en aura une.
class PeriodicSyncWorker(
    context: Context,
    params: WorkerParameters,
) : Worker(context, params) {
    override fun doWork(): Result {
        val client = PronoteSession.client ?: return Result.success()
        val store = FileCacheStore(File(applicationContext.filesDir, "offline"))
        return try {
            val now = System.currentTimeMillis()
            store.save(CachePolicy.GRADES, gradesPayload(client, emptyMap()), now)
            store.save(CachePolicy.ASSIGNMENTS, assignmentsPayload(client, emptyMap()), now)
            store.save(CachePolicy.TIMETABLE, timetablePayload(client, emptyMap()), now)
            Result.success()
        } catch (e: Exception) {
            if (isSessionFailure(e)) {
                DeviceAuth.reject()
                Result.success()
            } else {
                Result.retry()
            }
        }
    }

    companion object {
        const val UNIQUE_WORK_NAME = "periodic-sync"
        const val INTERVAL_HOURS = 6L
        const val BACKOFF_MINUTES = 10L

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
