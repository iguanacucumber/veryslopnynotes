package fr.veryslopnynotes.app

/**
 * Le DOM storage de la coquille, sauf l'apparence (I16).
 * Le script est du Kotlin PUR pour que le harnais l'EXÉCUTE : toute clé de
 * compte part, `vsn:theme` et `vsn:scheme` restent. Une liste noire de clés
 * laisserait survivre la prochaine clé ajoutée au web ; la liste blanche est
 * l'inverse : un oubli est visible ici.
 */
object WebViewAccountStorage {
    /** Réglages d'apparence : la seule chose qui survit à une purge de compte. */
    val APPEARANCE_KEYS = listOf("vsn:theme", "vsn:scheme")

    fun clearScript(keep: List<String> = APPEARANCE_KEYS): String {
        val kept = keep.joinToString(",") { "\"${it.replace("\\", "\\\\").replace("\"", "\\\"")}\":1" }
        return "(function(){try{" +
            "var keep={$kept};" +
            "var keys=[];" +
            "for(var i=0;i<localStorage.length;i++){keys.push(localStorage.key(i));}" +
            "for(var j=0;j<keys.length;j++){" +
            "var k=keys[j];" +
            "if(k!==null&&!keep[k]){localStorage.removeItem(k);}" +
            "}" +
            "try{sessionStorage.clear();}catch(e){}" +
            "return 'ok';" +
            "}catch(e){return 'ko';}})()"
    }
}
