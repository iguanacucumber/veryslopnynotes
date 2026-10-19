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
// #364 : les écritures portent la meme garde que les ecrans (epoch de session)
// : une deconnexion survenue pendant la lecture annule l'ecriture, le cache
// purge ne ressuscite pas. Le store est une AUTRE instance que celle de l'app,
// mais le verrou est partage par repertoire : les deux ne s'entrelacent pas.
// ponytail: Worker bloquant (pas de CoroutineWorker : le module n'a pas de
// coroutines, tout le reste est en Thread). Upgrade: une entrée de cache
// par requête quand SyncedRepository en aura une.
class PeriodicSyncWorker(
    context: Context,
    params: WorkerParameters,
) : Worker(context, params) {
    override fun doWork(): Result {
        val client = PronoteSession.client ?: return Result.success()
        val store = FileCacheStore(File(applicationContext.filesDir, "offline"))
        // #364 : epoque capturee AVANT les lectures locales (le client peut
        // mettre des secondes) : une deconnexion pendant la lecture annule
        // l'ecriture du cache.
        val epoch = SessionEpoch.current()
        return try {
            val now = System.currentTimeMillis()
            // Requête vide = la vue par défaut (fenêtre courante, aucun
            // algorithme) : c'est ce que demandent l'accueil et l'EDT (#365).
            if (!saveIfCurrent(epoch, store, CachePolicy.GRADES, gradesPayload(client, emptyMap()), now, "")) {
                return Result.success()
            }
            if (!saveIfCurrent(epoch, store, CachePolicy.ASSIGNMENTS, assignmentsPayload(client, emptyMap()), now, "")) {
                return Result.success()
            }
            if (!saveIfCurrent(epoch, store, CachePolicy.TIMETABLE, timetablePayload(client, emptyMap()), now, "")) {
                return Result.success()
            }
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

    /**
     * Ecriture gardee par l'epoch : `false` = la session a change (deconnexion
     * pendant la lecture), rien n'a ete ecrit et le travail n'a plus rien a
     * faire. Une erreur d'ecriture, elle, remonte (retry comme avant).
     *
     * #365 : la requete est ecrite avec l'entree (requete vide = vue par
     * defaut), sinon l'ecriture serait invisible pour la relecture.
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
