package fr.veryslopnynotes.data

import fr.veryslopnynotes.pronote.Client
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import java.time.Clock

private fun mealOf(isDinner: Boolean, name: String?): String {
    if (isDinner) return "dinner"
    if (name != null && Regex("\\b(petit[\\s-]?d[eé]jeuner|breakfast)\\b", RegexOption.IGNORE_CASE).containsMatchIn(boundedCp(name, 100))) {
        return "breakfast"
    }
    return "lunch"
}

@Serializable
private data class MenuEntry(
    val id: String,
    val date: String,
    val meal: String,
    val dishes: List<String>,
    val allergens: List<String>? = null,
)

@Serializable
private data class MenusPayload(
    val menus: List<MenuEntry>,
    val partial: Boolean = false,
)

internal fun menusPayload(client: Client, clock: Clock = schoolClock()): String {
    val (from, to) = currentWeekLocal(clock)
    val fromMs = from.atZone(SCHOOL_ZONE).toInstant().toEpochMilli()
    // `to` finit déjà le dimanche 23:59:59 : +999 garde la borne milliseconde
    // inclusive sans déborder sur le lundi suivant.
    val toMs = to.atZone(SCHOOL_ZONE).toInstant().toEpochMilli() + 999
    var seq = 0
    val read = client.menusPartial(from, to)
    val menus = read.value.mapNotNull { m ->
        val dateMs = m.date.atZone(SCHOOL_ZONE).toInstant().toEpochMilli()
        if (dateMs < fromMs || dateMs > toMs) return@mapNotNull null
        val dishes = mutableListOf<String>()
        val allergens = mutableListOf<String>()
        for (group in listOf(m.firstMeal, m.mainMeal, m.sideMeal, m.otherMeal, m.cheese, m.dessert)) {
            if (group == null) continue
            for (f in group) {
                val label = boundedCp(f.name, 120)
                if (label.isNotEmpty() && label !in dishes && dishes.size < 20) dishes.add(label)
                for (lb in f.labels) {
                    val a = boundedCp(lb.name, 40)
                    if (a.isNotEmpty() && a !in allergens && allergens.size < 14) allergens.add(a)
                }
            }
        }
        if (dishes.isEmpty()) return@mapNotNull null
        MenuEntry(
            id = m.id.ifBlank { "menu-${seq++}" },
            date = m.date.parisIso(),
            meal = mealOf(m.isDinner, m.name),
            dishes = dishes,
            allergens = allergens.ifEmpty { null },
        )
    }
    return payloadJson.encodeToString(MenusPayload(menus, read.partial))
}
