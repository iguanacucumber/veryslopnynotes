package fr.veryslopnynotes.pronote

import java.time.LocalDateTime

// Cantine : menu, plats et labels alimentaires (`dataClasses.js`).

/**
 * Menu (`isLunch` = `G == 0`, `isDinner` = `G == 1` ; `ListePlats` réindexé par
 * `String(G)`, ordre `dessert = 4` / `fromage = 5` conservé tel quel).
 */
class Menu(private val client: PronoteClientLike, json: JVal?) : PronoteObject(json) {
    /** Label alimentaire (le `client` est ignoré, signature conservée). */
    class FoodLabel(_client: PronoteClientLike, json: JVal?) : PronoteObject(json) {
        val id: String = r(::strOf, listOf("N"))
        val name: String = r(::strOf, listOf("L"))
        val color: String? = r(::optStr, listOf("couleur"), ResolveOpts.lenient())
    }

    /** Plat (labels requis, même si vides côté serveur). */
    class Food(private val client: PronoteClientLike, json: JVal?) : PronoteObject(json) {
        val id: String = r(::strOf, listOf("N"))
        val name: String = r(::strOf, listOf("L"))
        val labels: List<FoodLabel> =
            r({ v ->
                val items = (v as? JVal.Arr)?.items ?: throw IllegalStateException("labels attendus")
                items.map { FoodLabel(client, it) }
            }, listOf("listeLabelsAlimentaires", "V"))
    }

    val id: String = r(::strOf, listOf("N"))
    val name: String? = r(::optStr, listOf("L"), ResolveOpts.lenient())
    val date: LocalDateTime = r(::dateParse, listOf("Date", "V"))
    val isLunch: Boolean = r(::numOf, listOf("G")) == 0.0
    val isDinner: Boolean = r(::numOf, listOf("G")) == 1.0

    private val mealResolver: Resolver = run {
        // `json.ListePlats.V` : l'objet porte `V`, le tableau est dedans.
        val plats = r({ v -> v }, listOf("ListePlats")) as? JVal.Obj
            ?: throw ParsingError("ListePlats manquantes", listOf("ListePlats"))
        val platsArr = plats.fields["V"] as? JVal.Arr
            ?: throw ParsingError("ListePlats.V manquante", listOf("ListePlats", "V"))
        val dict = LinkedHashMap<String, JVal>()
        for (meal in platsArr.items) {
            val g = (meal as? JVal.Obj)?.fields?.get("G")
            dict[if (g == null) "undefined" else strOf(g)] = meal
        }
        Resolver(JVal.Obj(dict))
    }

    private fun mealAt(key: String): List<Food>? =
        mealResolver.call({ v ->
            val arr = (((v as? JVal.Obj)?.fields?.get("ListeAliments") as? JVal.Obj)?.fields?.get("V") as? JVal.Arr)
                ?: throw IllegalStateException("ListeAliments attendue")
            arr.items.map { Food(client, it) }
        }, listOf(key), ResolveOpts.lenient())

    val firstMeal: List<Food>? = mealAt("0")
    val mainMeal: List<Food>? = mealAt("1")
    val sideMeal: List<Food>? = mealAt("2")
    val otherMeal: List<Food>? = mealAt("3")
    val cheese: List<Food>? = mealAt("5")
    val dessert: List<Food>? = mealAt("4")
}
