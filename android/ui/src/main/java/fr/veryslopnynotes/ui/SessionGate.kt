package fr.veryslopnynotes.ui

import android.os.Handler
import android.os.Looper
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.navigation.NavHostController
import androidx.navigation.NavGraph.Companion.findStartDestination
import fr.veryslopnynotes.data.AccountStore
import fr.veryslopnynotes.data.DeviceAuth
import fr.veryslopnynotes.data.PairingRepository
import fr.veryslopnynotes.data.RestoreResult
import fr.veryslopnynotes.data.SessionStore

// Portier de session (#113 + #206, extrait d'AppNav en #206 : le graphe reste
// sous ~450 lignes, critère de #135). Deux effets, aucun écran :
//
// 1. restauration au démarrage — le jeton persisté rouvre la session SANS
//    rescanner (l'app lit le téléphone, sinon ses caches). Session morte =
//    store vidé (cap sur l'appairage, sans purger les caches : l'utilisateur
//    n'a rien demandé) ; réseau KO = on garde tout (la session n'est pas
//    morte, juste injoignable).
// 2. session morte en cours d'usage — le signal unique des dépôts locaux se
//    répare par le chemin EXISTANT `accounts.logout()` (session effacée +
//    caches purgés, aucune purge parallèle) puis ramène à l'appairage.
//    Anti-boucle : après logout() il n'y a plus de session, donc plus de signal.
//
// `onNotice` porte la phrase factuelle vers l'écran d'appairage (#147 : elle
// survit à la rotation, sinon un écran de connexion ressemble à une panne).
// ponytail: pas de ViewModel — deux effets Compose, pas d'état propre.
@Composable
fun SessionGate(
    sessions: SessionStore,
    accounts: AccountStore,
    nav: NavHostController,
    onNotice: (String?) -> Unit,
) {
    val main = remember { Handler(Looper.getMainLooper()) }
    LaunchedEffect(sessions) {
        Thread {
            val pairing = PairingRepository(sessions)
            val outcome = try {
                pairing.restoreBlocking()
            } catch (_: Exception) {
                RestoreResult.Offline
            }
            if (outcome is RestoreResult.Dead) {
                main.post {
                    onNotice(outcome.message)
                    if (nav.currentDestination?.route != ROUTE_PAIRING) {
                        nav.navigate(ROUTE_PAIRING) {
                            popUpTo(nav.graph.findStartDestination().id) { inclusive = true }
                            launchSingleTop = true
                        }
                    }
                }
            }
        }.start()
    }
    DisposableEffect(accounts) {
        DeviceAuth.setOnRejected {
            main.post {
                onNotice(DeviceAuth.REJECTED_MESSAGE)
                accounts.logout()
                if (nav.currentDestination?.route != ROUTE_PAIRING) {
                    nav.navigate(ROUTE_PAIRING) {
                        popUpTo(nav.graph.findStartDestination().id) { inclusive = true }
                        launchSingleTop = true
                    }
                }
            }
        }
        onDispose { DeviceAuth.setOnRejected(null) }
    }
}
