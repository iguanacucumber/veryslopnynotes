# VOLONTAIREMENT sans `-keep` : AGP agrège déjà les règles consommateur des AAR,
# et un `-keep` en trop annule le gain de démarrage. Un `-keep` ne s'ajoute
# qu'avec la raison mesurée (build ou smoke test qui échoue), jamais « au cas où ».

# R8 refuse de compiler sans : Tink référence les annotations Error Prone,
# présentes à la compilation seulement. `-dontwarn` garde le rétrécissement entier.
-dontwarn com.google.errorprone.annotations.**

# La plateforme appelle `call` par réflexion (nom exposé au JS) : sans cette
# règle, R8 renomme la méthode et l'UI web ne joint plus le natif.
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
