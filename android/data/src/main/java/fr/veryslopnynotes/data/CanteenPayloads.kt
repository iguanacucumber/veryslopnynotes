package fr.veryslopnynotes.data

import fr.veryslopnynotes.pronote.Client
import org.json.JSONArray
import org.json.JSONObject

// Cantine : payload `menus`.

private fun mealOf(isDinner: Boolean, name: String?): String {
    if (isDinner) return "dinner"
    if (name != null && Regex("\\b(petit[\\s-]?d[eé]jeuner|breakfast)\\b", RegexOption.IGNORE_CASE).containsMatchIn(boundedCp(name, 100))) {
        return "breakfast"
    }
    return "lunch"
}

internal fun menusPayload(client: Client): String {
    val (from, to) = currentWeekLocal()
    val fromMs = from.atZone(PARIS).toInstant().toEpochMilli()
    val toMs = to.plusDays(1).atZone(PARIS).toInstant().toEpochMilli() - 1
    val arr = JSONArray()
    var seq = 0
    for (m in client.menus(from, to)) {
        val dateMs = m.date.atZone(PARIS).toInstant().toEpochMilli()
        if (dateMs < fromMs || dateMs > toMs) continue
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
        if (dishes.isEmpty()) continue
        val mealId = m.id.ifBlank { "menu-${seq++}" }
        val mealDate = m.date.parisIso()
        val mealKind = mealOf(m.isDinner, m.name)
        arr.put(JSONObject().apply {
            put("id", mealId)
            put("date", mealDate)
            put("meal", mealKind)
            put("dishes", JSONArray(dishes))
            if (allergens.isNotEmpty()) put("allergens", JSONArray(allergens))
        })
    }
    return JSONObject().put("menus", arr).toString()
}

