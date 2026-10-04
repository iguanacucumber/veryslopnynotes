package fr.veryslopnynotes.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.List
import androidx.compose.material.icons.filled.ShoppingCart
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import fr.veryslopnynotes.core.dayLabelFr
import fr.veryslopnynotes.core.enumFr
import fr.veryslopnynotes.data.CachePolicy
import fr.veryslopnynotes.data.RefreshOutcome
import fr.veryslopnynotes.data.SyncedRepository
import org.json.JSONArray
import org.json.JSONObject
import java.time.ZoneId

// #81 parité Papillon onglet Menus : écrans "cantine semaine", liste par jour.
// org.json = plateforme Android (aucune dépendance ajoutée). Le payload est une
// donnée structurée du contrat : on lit des champs, jamais de texte libre
// interprété (I6). Plats/allergènes bornés comme le contrat (20/120, 14/40).
// ponytail: pas de ViewModel, état local comme les autres onglets (UiState) ;
//   upgrade: ViewModel + Flow quand #82/#83 câbleront la navigation complète.
// ponytail: solde (balance) affiché s'il est présent, absent sinon (Turboself/
//   ARD hors serveur de notes). Upgrade: écran compte cantine dédié.
//
// #144 — les défauts de cet écran :
//   - `menu.status` était INTERPOLÉ BRUT dans une phrase française : l'utilisateur
//     lisait « Déjeuner (served) ». Les jetons du contrat sont des valeurs
//     anglaises (`served` / `planned`) : ils sont maintenant traduits ET colorés
//     ([canteenStatusLabel] + pastille), et un jeton inconnu ne sort jamais en
//     clair ;
//   - #147 : la table des jours et la tranche ISO de `canteenDayLabel` ont rejoint
//     `core/DateFr.kt`, les libellés de repas et de statut `core/EnumFr.kt` ;
//   - les ALLERGÈNES, eux, étaient un ajout de gris en fin de ligne — or c'est un
//     champ de SÉCURITÉ alimentaire. Ils passent maintenant dans un bloc dédié,
//     titré, avant les plats ;
//   - `CanteenBalance.updatedAt` était parsé puis jeté : le solde n'affichait ni
//     son âge. Il est maintenant daté (« mis à jour il y a 4 min »).

/** Opacité du fond du bloc allergènes (lime de marque). */
private const val ALERGEN_BLOCK_ALPHA = 0.25f

private const val MAX_DISHES = 20
private const val MAX_DISH_CHARS = 120
private const val MAX_ALLERGENS = 14
private const val MAX_ALLERGEN_CHARS = 40
// Les repas du contrat : la liste des jetons ACCEPTÉS reste ici (elle filtre le
// payload), les libellés français viennent de `core/EnumFr.kt`.
private val MEALS = listOf("breakfast", "lunch", "dinner")

/** Repas hors contrat : on dit ce qu'on sait, pas un menu inventé. */
private const val CANTEEN_MEAL_FALLBACK = "Repas"

/** Statut publié mais inconnu : jamais le jeton brut en clair. */
private const val CANTEEN_STATUS_UNKNOWN = "Statut inconnu"

/**
 * LIGNE FIXE de l'écran « Cantine », rendue dans les TROIS états (données, vide,
 * erreur) — comme `ATTENDANCE_HEADING` / `SANCTIONS_HEADING` (#172).
 *
 * #178 : elle était dans la SEULE branche qui a des menus, donc hors ligne ou à
 * froid la capture échouait sur un écran parfaitement correct (« le témoin de
 * l'écran a changé ») alors que la faute était celle du témoin. Un témoin qui
 * dépend de la donnée ne prouve rien hors ligne.
 */
private const val CANTEEN_HEADING = "Menus de la semaine"

// Jetons ACCEPÉS du contrat (`CANTEEN_MENU_STATUSES`) : la couleur et le filtre
// comparent des jetons, les libellés viennent de `core/EnumFr.kt`.
private const val STATUS_SERVED = "served"
private const val STATUS_PLANNED = "planned"

data class CanteenMenuUi(
    val date: String,
    val meal: String,
    val dishes: List<String>,
    val allergens: List<String> = emptyList(),
    val status: String? = null,
)

data class CanteenDayUi(val date: String, val meals: List<CanteenMenuUi>)

data class CanteenWeekUi(
    val days: List<CanteenDayUi>,
    /** Solde + son âge (« 12,50 € (solde) · mis à jour il y a 4 min »), vide sinon. */
    val balanceLabel: String? = null,
)

private fun bound(s: String, max: Int): String = s.trim().take(max)

private fun stringsOf(array: JSONArray?, maxItems: Int, maxChars: Int): List<String> {
    if (array == null) return emptyList()
    val out = mutableListOf<String>()
    for (i in 0 until array.length()) {
        if (out.size >= maxItems) break
        if (array.isNull(i)) continue
        val item = array.optString(i, "")
        val v = bound(item, maxChars)
        if (v.isNotEmpty() && !out.contains(v)) out.add(v)
    }
    return out
}

private fun dishesOf(obj: JSONObject): List<String> = stringsOf(obj.optJSONArray("dishes"), MAX_DISHES, MAX_DISH_CHARS)

// Payload /v1/menus -> semaine. Contrat non conforme (JSON invalide, repas
// inconnu, aucun plat) = ligne ignorée, jamais de valeur inventée.
//
// `now`/`zone` sont INJECTÉS : l'âge du solde dépend de l'horloge et du fuseau,
// donc sans eux la fonction serait impossible à tester (même choix que
// `relativeTimeFr`).
fun canteenWeekFrom(
    payload: String,
    now: Long = System.currentTimeMillis(),
    zone: ZoneId = ZoneId.systemDefault(),
): CanteenWeekUi {
    return try {
        val root = JSONObject(payload)
        val menus = root.optJSONArray("menus") ?: JSONArray()
        val byDate = linkedMapOf<String, MutableList<CanteenMenuUi>>()
        for (i in 0 until menus.length()) {
            val obj = menus.optJSONObject(i) ?: continue
            val date = obj.optString("date", "")
            val meal = obj.optString("meal", "")
            if (!MEALS.contains(meal)) continue
            val dishes = dishesOf(obj)
            if (dishes.isEmpty()) continue
            val status = obj.optString("status", "")
            byDate.getOrPut(date) { mutableListOf() }.add(
                CanteenMenuUi(
                    date = date,
                    meal = meal,
                    dishes = dishes,
                    allergens = stringsOf(obj.optJSONArray("allergens"), MAX_ALLERGENS, MAX_ALLERGEN_CHARS),
                    status = status.ifEmpty { null },
                ),
            )
        }
        CanteenWeekUi(
            days = byDate.entries.sortedBy { it.key }.map { CanteenDayUi(it.key, it.value) },
            balanceLabel = canteenBalanceLine(root.optJSONObject("balance"), now, zone),
        )
    } catch (_: Exception) {
        CanteenWeekUi(emptyList())
    }
}

/** "12,50 € (solde)" ou null si l'établissement ne publie pas de solde. */
fun canteenBalanceLabel(balance: JSONObject?): String? {
    if (balance == null || balance.isNull("balance")) return null
    val value = balance.optDouble("balance", Double.NaN)
    if (value.isNaN()) return null
    val currency = balance.optString("currency", "").trim().ifEmpty { "€" }
    return String.format(java.util.Locale.FRANCE, "%.2f %s (solde)", value, currency)
}

/**
 * Ligne de solde AVEC son âge : « 12,50 € (solde) · mis à jour il y a 4 min ».
 *
 * #144 : `updatedAt` était lu puis jeté — un solde sans âge est un chiffre que
 * personne ne sait dater. Établissement qui ne publie pas de solde = `null`
 * (rien n'est inventé) ; date illisible = le montant seul, jamais une date
 * devinée.
 */
fun canteenBalanceLine(
    balance: JSONObject?,
    now: Long = System.currentTimeMillis(),
    zone: ZoneId = ZoneId.systemDefault(),
): String? {
    val label = canteenBalanceLabel(balance) ?: return null
    val updatedAt = balance?.optString("updatedAt", "")?.trim().orEmpty()
    val epoch = homeMillisOf(updatedAt) ?: return label
    return "$label · mis à jour ${relativeTimeFr(epoch, now, zone)}"
}

/**
 * "lundi 05/10" depuis l'ISO du contrat (2026-10-05T00:00:00.000Z).
 *
 * #147 : la quatrième copie du tableau des jours français ET la tranche ISO
 * des dix premiers caractères disparaissent au profit de `dayLabelFr`
 * (`core/DateFr.kt`).
 * Date illisible = libellé VIDE : une tranche brute ne vaut pas un titre de
 * carte.
 */
fun canteenDayLabel(date: String): String = dayLabelFr(date)

/**
 * Type de repas en français. Repli « Repas » : un repas HORS CONTRAT n'est pas
 * un déjeuner, et l'écrire « Déjeuner » serait inventer un menu (#147).
 */
fun canteenMealLabel(meal: String): String = enumFr(meal, CANTEEN_MEAL_FALLBACK)

/**
 * Statut du repas, en français : « Servi », « Prévu », ou `null` si
 * l'établissement ne publie pas de statut.
 *
 * AVANT #144, `status` était concaténé tel quel — l'écran affichait le jeton
 * anglais du contrat. Un statut INCONNU ne sort pas non plus en clair : il
 * devient « Statut inconnu », jamais `something_else`. #147 : la table est
 * celle du contrat (`core/EnumFr.kt`), plus aucun `when` par écran.
 */
fun canteenStatusLabel(status: String?): String? =
    if (status.isNullOrBlank()) null else enumFr(status, CANTEEN_STATUS_UNKNOWN)

/**
 * Repas servi ou prévu : le vert de marque pour le passé, le lime pour l'à venir.
 *
 * La couleur décide sur le JETON du contrat, jamais sur le libellé français :
 * une pastille choisie en comparant des chaînes cassait dès qu'un libellé
 * changeait de casse (#147).
 */
@Composable
private fun canteenStatusColor(status: String?): Color? = when (status?.trim()) {
    STATUS_SERVED -> MaterialTheme.colorScheme.primary
    STATUS_PLANNED -> MaterialTheme.colorScheme.tertiary
    // Statut inconnu ou absent = pas de pastille : une pastille « Statut
    // inconnu » repeindrait le repas d'une couleur qui ne veut rien dire.
    else -> null
}

/**
 * Bloc ALLERGÈNES : un encart titré, avant les plats.
 *
 * C'est un champ de sécurité alimentaire : l'ajout de gris en fin de ligne
 * (` — allergènes : gluten, lactose`) le faisait passer pour une remarque de
 * typographie. Ici il a son titre, son fond, et il est la PREMIÈRE chose lue du
 * repas. Établissement qui ne publie rien = aucun bloc (pas de « aucun
 * allergène » inventé : on ne sait pas, c'est tout).
 */
@Composable
private fun CanteenAllergenBlock(allergens: List<String>) {
    if (allergens.isEmpty()) return
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(MaterialTheme.shapes.small)
            // Lime de marque à 25 % : un aplat d'alerte sans rouge (le repas n'est
            // pas interdit) — et surtout un aplat, plus une liste en gris qui se
            // perdait en fin de ligne.
            .background(MaterialTheme.colorScheme.tertiary.copy(alpha = ALERGEN_BLOCK_ALPHA))
            .padding(horizontal = 12.dp, vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Text(
            text = "ALLERGÈNES",
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.semantics { heading() },
        )
        // Données de l'établissement : une étiquette par allergène, donc aucune
        // liste à déchiffrer dans une phrase.
        for (allergen in allergens) {
            Text(
                text = "• $allergen",
                style = MaterialTheme.typography.bodyMedium,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

/** Un repas : en-tête (type + statut), bloc allergènes, puis les plats. */
@Composable
private fun CanteenMealCard(menu: CanteenMenuUi, modifier: Modifier = Modifier) {
    val statusColor = canteenStatusColor(menu.status)
    PapCard(modifier = modifier.fillMaxWidth()) {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Text(
                    text = canteenMealLabel(menu.meal),
                    style = MaterialTheme.typography.titleSmall,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
                val label = canteenStatusLabel(menu.status)
                if (label != null && statusColor != null) {
                    PapPill(text = label, color = statusColor)
                }
            }
            CanteenAllergenBlock(menu.allergens)
            // Donnée externe ci-dessous : texte affiché, jamais interprété (I6).
            for (dish in menu.dishes) {
                Text(
                    text = "• $dish",
                    style = MaterialTheme.typography.bodyMedium,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
    }
}

/** Carte de solde : montant + âge du relevé. */
@Composable
private fun CanteenBalanceCard(line: String, modifier: Modifier = Modifier) {
    PapCard(modifier = modifier.fillMaxWidth()) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Icon(
                imageVector = Icons.Filled.ShoppingCart,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.size(20.dp),
            )
            Text(
                text = line,
                style = MaterialTheme.typography.titleSmall,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

/** Carte d'un jour : en-tête « lundi 05/10 » puis un carte par repas. */
@Composable
private fun CanteenDayCard(day: CanteenDayUi, modifier: Modifier = Modifier) {
    PapCard(modifier = modifier.fillMaxWidth()) {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(
                text = canteenDayLabel(day.date),
                style = MaterialTheme.typography.titleMedium,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.semantics { heading() },
            )
            for (menu in day.meals) {
                CanteenMealCard(menu)
            }
        }
    }
}

/**
 * Écran cantine : le CONTENU (semaine + solde) seul, sans état — le même découpage
 * que `CanteenRoute`, qui décide de l'état à afficher.
 */
@Composable
private fun CanteenContent(week: CanteenWeekUi, modifier: Modifier = Modifier) {
    Column(modifier = modifier, verticalArrangement = Arrangement.spacedBy(12.dp)) {
        val balance = week.balanceLabel
        if (balance != null) CanteenBalanceCard(balance)
        for (day in week.days) {
            CanteenDayCard(day)
        }
    }
}

// ponytail: pas de registre global de capacités (autre issue) — l'écran décide
//   sur le payload vide : aucun menu sur la fenêtre => état vide propre, et le
//   shell pourra masquer l'onglet quand /v1/menus répondra [] au sync.
@Composable
fun CanteenRoute(repo: SyncedRepository, baseUrl: String) {
    // Etat initial = cache synchrone (affichage sans reseau immediat).
    var payload by remember {
        val c = try {
            repo.cached(CachePolicy.MENUS)
        } catch (_: Exception) {
            null
        }
        mutableStateOf(c?.payload)
    }
    var fetchedAt by remember { mutableStateOf<Long?>(null) }
    var stale by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    // La relecture part au montage : l'écran commence donc en chargement plutôt
    // qu'en « aucun menu en cache » pendant une frame.
    var loading by remember { mutableStateOf(true) }
    fun refresh() {
        // Serveur non configuré : pas d'appel (I1).
        if (baseUrl.isBlank()) {
            error = "Serveur non configuré."
            return
        }
        loading = true
        try {
            repo.refreshAsync(CachePolicy.MENUS, baseUrl) { o ->
                when (o) {
                    is RefreshOutcome.Updated -> {
                        payload = o.payload
                        fetchedAt = o.fetchedAt
                        stale = false
                        error = null
                    }
                    is RefreshOutcome.OfflineFallback -> {
                        payload = o.payload
                        fetchedAt = o.fetchedAt
                        stale = o.stale
                        error = null
                    }
                    is RefreshOutcome.Failed -> {
                        payload = o.cachedPayload
                        stale = true
                        error = o.message
                    }
                }
                loading = false
            }
        } catch (_: Exception) {
            error = "Erreur inattendue."
            loading = false
        }
    }
    // Cache d'abord, relecture ensuite (offline-first #14). Le rechargement se
    // déclenche au PullToRefresh de l'écran : cette route n'a pas d'action
    // « Actualiser » dans la barre (cf. `TOP_BAR_ACTIONS`), donc pas de compteur
    // à câbler ici.
    LaunchedEffect(Unit) { refresh() }

    val week = payload?.let { canteenWeekFrom(it) }
    val days = week?.days ?: emptyList()

    // La colonne paddée englobe TOUS les états : sans elle, le squelette était
    // collé au bord de l'écran.
    Column(
        modifier = Modifier.fillMaxSize().padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        HomePullToRefresh(refreshing = loading, onRefresh = { refresh() }) {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                // #178 : hors du `when`, donc présent même sans un seul menu —
                // c'est ce qui rend la route prouvable dans ses trois états.
                Text(
                    text = CANTEEN_HEADING,
                    style = MaterialTheme.typography.titleMedium,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.semantics { heading() },
                )
                when {
                    // Le VRAI message d'échec : l'écran ne se débrouille pas d'un « réseau ».
                    error != null && days.isEmpty() -> PapErrorState(message = error, onRetry = { refresh() })
                    days.isNotEmpty() -> Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        if (stale) PapStaleBanner(fetchedAt = fetchedAt, onRefresh = { refresh() })
                        // Relecture échouée alors que les menus sont là : la cause passe
                        // en une ligne, les cartes restent affichées.
                        val failure = error
                        if (failure != null) {
                            Text(
                                text = failure,
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                maxLines = 3,
                                overflow = TextOverflow.Ellipsis,
                            )
                        }
                        CanteenContent(week ?: CanteenWeekUi(emptyList()))
                    }
                    loading -> PapLoading()
                    // Capacite dynamique : aucun menu publie = onglet masque cote shell,
                    // ici etat vide propre (pas d'erreur, pas de contenu invente).
                    payload == null -> PapEmptyState(
                        icon = Icons.AutoMirrored.Filled.List,
                        title = "Aucun menu en cache",
                        description = "Actualisez pour charger les menus de la semaine.",
                        action = { Button(onClick = { refresh() }) { Text("Actualiser") } },
                    )
                    else -> PapEmptyState(
                        icon = Icons.AutoMirrored.Filled.List,
                        title = "Aucun menu publié cette semaine",
                        description = "L'établissement n'a pas publié de menu sur cette période.",
                        action = { Button(onClick = { refresh() }) { Text("Actualiser") } },
                    )
                }
            }
        }
    }
}
