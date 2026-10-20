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

// Sync périodique de fond (#208) : SANS serveur, donc ni SSE (flux du
// serveur vers l'app), ni push (jamais câblé), ni cron serveur (jamais
// câblé). WorkManager est la seule solution de sync périodique sans serveur.
// Relit notes/devoirs/EDT sur le client local du téléphone (MÊME porte
// d'entrée et MÊMES bornes que les écrans : `cachedRead` sur les ressources
// `CachePolicy`) et réécrit le cache fichier partagé avec les écrans (même
// répertoire "offline" que AppNav, mêmes clés CachePolicy).
//
// Pas de drain batterie : contraintes réseau connecté + batterie non faible,
// intervalle 6 h (les données scolaires changent quelques fois par jour ; le
// TTL court reste l'affaire du premier plan), backoff exponentiel 10 min sur
// échec, travail unique (KEEP : jamais deux planifications).
//
// #406 : la session vit en RAM (`PronoteSession`) et le job démarre un process
// NEUF (pas d'interface) : la session n'y est donc pas. Le worker la
// RESTAURE avant toute lecture, par le MÊME chemin que le pont
// (`PairingRepository.restoreBlocking`). Sans session lisible, le job
// RÉESSAIE (`Result.retry()`) : un `Result.success()` déclarait un succès qui
// n'avait rien fait, donc le sync de fond devenait un no-op sans réessai.
// ponytail: « jamais appairé » retente aussi (backoff WorkManager) — le job
// n'a pas d'autre signal, et le store vide ne se distingue pas d'une
// restauration impossible sans regarder le store. Upgrade: distinguer « store
// vide » (succès) de « session non restaurable » (réessai) si le bruit des
// retries gêne.
// La session locale MORTE (jeton tourné) pendant la LECTURE reste un succès
// (signal d'appairage ; un retry ne ressusciterait pas la session, et un échec
// permanent userait la batterie) ; autre échec = retry (backoff).
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
        // Restauration AVANT toute lecture : sans session, le job réessaie.
        return when (val outcome = syncJobOutcome(restoreClient())) {
            is SyncJobOutcome.Retry -> Result.retry()
            is SyncJobOutcome.Refresh -> refresh(outcome.session)
        }
    }

    /**
     * Lecture des trois ressources + réécriture du cache (session disponible).
     *
     * #403 : les lectures passent par la file PARTAGÉE (`ClientQueue`), la
     * MÊME que celle des écrans. Le `Client` est MUTABLE (`refresh()`
     * réassigne `communication`, `attributes` et la clé AES) : une lecture de
     * l'écran et une du job en parallèle = deux authentifications sur le même
     * compte = « Exceeded max authorization requests » (erreur 25) →
     * l'établissement LIMITE le compte. La file sérialise : UN appel client
     * à la fois dans le process. Avant, le job lisait le client EN DIRECT.
     *
     * Le job est BLOQUANT (`Worker.doWork`) : il pose sa lecture dans la file
     * et ATTEND (délai BORNÉ par `READ_TIMEOUT_MS` : au-delà, le job
     * réessaiera — il ne bloque jamais WorkManager indéfiniment).
     */
    private fun refresh(client: Client): Result {
        val store = cacheStore()
        // #364 : epoque capturee AVANT les lectures locales (le client peut
        // mettre des secondes) : une deconnexion pendant la lecture annule
        // l'ecriture du cache.
        val epoch = SessionEpoch.current()
        val now = System.currentTimeMillis()
        return try {
            for (resource in JOB_RESOURCES) {
                // La lecture passe par la file partagée (clé namespacée `job|` :
                // jamais celle d'un écran, donc jamais un résultat étranger).
                val read = ClientQueue.submitAndAwait("job|$resource|", READ_TIMEOUT_MS) {
                    safeRead { cachedRead(client, resource, "") }
                } ?: return Result.retry()
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
     * Session MORTE = l'app doit se ré-appairer : le job « réussit » (un
     * réessai ne ressusciterait pas la session). Autre échec = RÉESSAI
     * (backoff WorkManager).
     */
    private fun failure(e: Exception): Result =
        if (isSessionFailure(e)) {
            DeviceAuth.reject()
            Result.success()
        } else {
            Result.retry()
        }

    /**
     * Session locale du process, restaurée si elle n'y est pas (#406).
     *
     * Même chemin que le pont (`PairingRepository.restoreBlocking`) : store
     * chiffré -> `Client.tokenLogin` -> `PronoteSession`. `null` = aucune
     * session lisible (jamais appairé, jeton mort, réseau KO) : le job
     * réessaiera au lieu de déclarer un succès sans rien avoir fait.
     *
     * La session DÉJÀ en RAM est réutilisée telle quelle (l'app tourne) : le
     * job ne refait pas de `tokenLogin`. Et quand il restaure vraiment, il
     * passe par le verrou partagé de `PairingRepository` : le pont et le job
     * n'ouvrent jamais deux sessions en parallèle (erreur 25).
     */
    private fun restoreClient(): Client? {
        PronoteSession.client?.let { return it }
        val sessions = SessionStores.get(applicationContext)
        // #407 : le dépôt de restauration purge le cache si la session est
        // MORTE — MÊME chemin que le pont, MÊME store (le dossier de cache
        // est partagé : une session morte en fond laisse le cache de l'app
        // intact, donc l'app servirait les données d'un compte mort).
        val restored = PairingRepository(sessions, cacheStore()).restoreBlocking()
        return if (restored is RestoreResult.Restored) PronoteSession.client else null
    }

    /**
     * Store de cache du téléphone : MÊME dossier que l'app (`filesDir/offline`),
     * donc le verrou est partagé (une écriture du job et une de l'app ne
     * s'entrelacent pas).
     */
    private fun cacheStore(): CacheStore = FileCacheStore(File(applicationContext.filesDir, "offline"))

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

        /**
         * Les trois ressources que le job relit (mêmes bornes que
         * l'interface : requête vide = vue par défaut, fenêtre courante —
         * c'est ce que demandent l'accueil et l'EDT, #365).
         */
        private val JOB_RESOURCES =
            listOf(CachePolicy.GRADES, CachePolicy.ASSIGNMENTS, CachePolicy.TIMETABLE)

        /**
         * Délai d'attente d'une lecture dans la file partagée : au-delà, le job
         * RÉESSAIE (la file est occupée par une longue lecture). 2 min < la
         * limite de 10 min de WorkManager : le job ne peut pas se le faire
         * tuer en attendant.
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
