package fr.veryslopnynotes.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import fr.veryslopnynotes.data.CachePolicy
import fr.veryslopnynotes.data.SyncedRepository
import org.json.JSONArray
import org.json.JSONObject

// #81 parité Papillon onglet Menus : écrans "cantine semaine", liste par jour.
// org.json = plateforme Android (aucune dépendance ajoutée). Le payload est une
// donnée structurée du contrat : on lit des champs, jamais de texte libre
// interprété (I6). Plats/allergènes bornés comme le contrat (20/120, 14/40).
// ponytail: pas de ViewModel, état local comme les autres onglets (UiState) ;
//   upgrade: ViewModel + Flow quand #82/#83 câbleront la navigation complète.
// ponytail: solde (balance) affiché s'il est présent, absent sinon (Turboself/
//   ARD hors serveur de notes). Upgrade: écran compte cantine dédié.

private const val MAX_DISHES = 20
private const val MAX_DISH_CHARS = 120
private const val MAX_ALLERGENS = 14
private const val MAX_ALLERGEN_CHARS = 40
private val MEALS = listOf("breakfast", "lunch", "dinner")

data class CanteenMenuUi(
    val date: String,
    val meal: String,
    val dishes: List<String>,
    val allergens: List<String> = emptyList(),
    val status: String? = null,
)

data class CanteenDayUi(val date: String, val meals: List<CanteenMenuUi>)

data class CanteenWeekUi(val days: List<CanteenDayUi>, val balanceLabel: String? = null)

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
fun canteenWeekFrom(payload: String): CanteenWeekUi {
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
        val balance = root.optJSONObject("balance")
        CanteenWeekUi(
            days = byDate.entries.sortedBy { it.key }.map { CanteenDayUi(it.key, it.value) },
            balanceLabel = canteenBalanceLabel(balance),
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

/** "lundi 05/10" depuis l'ISO du contrat (2026-10-05T00:00:00.000Z). */
fun canteenDayLabel(date: String): String {
    val day = date.take(10)
    if (day.length < 10) return day
    val days = listOf("dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi")
    val index = runCatching { java.time.LocalDate.parse(day).dayOfWeek.value % 7 }.getOrDefault(-1)
    val name = if (index < 0) "" else "${days[index]} "
    return "$name${day.substring(8, 10)}/${day.substring(5, 7)}"
}

fun canteenMealLabel(meal: String): String = when (meal) {
    "breakfast" -> "Petit-déjeuner"
    "dinner" -> "Dîner"
    else -> "Déjeuner"
}

// ponytail: pas de registre global de capacités (autre issue) — l'écran décide
//   sur le payload vide : aucun menu sur la fenêtre => état vide propre, et le
//   shell pourra masquer l'onglet quand /v1/menus répondra [] au sync.
@Composable
fun CanteenRoute(repo: SyncedRepository, baseUrl: String) {
    // Etat initial = cache synchrone (affichage sans reseau immediat).
    var state by remember {
        val c = try {
            repo.cached(CachePolicy.MENUS)
        } catch (_: Exception) {
            null
        }
        mutableStateOf(uiStateFromCache(c, c != null && repo.isStale(CachePolicy.MENUS, c)))
    }
    fun refresh() {
        // Serveur non configuré : pas d'appel (I1).
        if (baseUrl.isBlank()) {
            state = UiState.Error("Serveur non configuré.", (state as? UiState.Data)?.payload)
            return
        }
        state = when (val s = state) {
            is UiState.Data -> s
            else -> UiState.Loading
        }
        try {
            repo.refreshAsync(CachePolicy.MENUS, baseUrl) { o -> state = uiStateFromOutcome(o) }
        } catch (_: Exception) {
            state = UiState.Error("Erreur inattendue.", (state as? UiState.Data)?.payload)
        }
    }
    val cachedPayload = (state as? UiState.Data)?.payload ?: (state as? UiState.Error)?.cached
    val week = cachedPayload?.let { canteenWeekFrom(it) }
    Column(
        modifier = Modifier.fillMaxSize().padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text("Menus de la semaine", style = MaterialTheme.typography.titleMedium)
        if (week != null && week.balanceLabel != null) Text(week.balanceLabel)
        if ((state as? UiState.Data)?.isStale == true) Text("Données hors-ligne (périmé).")
        val days = week?.days ?: emptyList()
        if (days.isEmpty()) {
            // Capacite dynamique : aucun menu publie = onglet masque cote shell,
            // ici etat vide propre (pas d'erreur, pas de contenu invente).
            when (state) {
                UiState.Empty -> Text("Aucun menu en cache. Actualisez pour charger la semaine.")
                UiState.Loading -> Text("Chargement…")
                is UiState.Error -> Text("Erreur réseau. Réessayer.")
                else -> Text("Aucun menu publié cette semaine.")
            }
        } else {
            for (day in days) {
                Text(canteenDayLabel(day.date))
                for (menu in day.meals) {
                    val suffix = if (menu.status == null) "" else " (${menu.status})"
                    val all = if (menu.allergens.isEmpty()) "" else " — allergènes : ${menu.allergens.joinToString(", ")}"
                    Text(canteenMealLabel(menu.meal) + suffix + all)
                    for (dish in menu.dishes) Text("• $dish")
                }
            }
        }
        Button(onClick = { refresh() }) { Text("Actualiser") }
    }
}
