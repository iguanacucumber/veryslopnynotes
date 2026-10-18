# Règles R8 du module `app` (#313 : release minifiée + ressources rétrécies).
#
# Fichier VOLONTAIREMENT vide de `-keep` : AGP agrège déjà les règles
# CONSOMMATEUR apportées par les AAR, et un `-keep` en trop annule le gain de
# démarrage que #313 cherche. Ce qui couvre déjà l'app, vérifié :
#
# - WorkManager : `proguard.txt` de work-runtime 2.9.0 garde
#   `* extends androidx.work.Worker` (+ constructeurs) — c'est exactement la
#   super-classe de `PeriodicSyncWorker`, dont le NOM de classe est l'identifiant
#   persisté du travail planifié. Rien à ajouter.
# - Chiffrement : security-crypto 1.1.0 livre un `proguard.txt` vide, commenté
#   « intentionally empty » (la bibliothèque est sûre à rétrécir).
# - Composants déclarés au manifest (MainActivity) : AGP génère le keep depuis
#   le manifest fusionné.
# - Compose, navigation, OkHttp : références statiques, aucune réflexion sur un
#   nom de classe (aucun `Class.forName`/`getIdentifier` dans android/), donc
#   rien à garder par leur nom.
#
# Si un `-keep` devient nécessaire, l'ajouter ICI avec la raison mesurée (build
# ou smoke test qui échoue) — jamais « au cas où ».
#
# Règle exigée par le BUILD (R8 refuse de compiler sans elle) : le chiffrement
# (androidx.security:security-crypto → Tink) référence les annotations Error
# Prone, présentes à la compilation seulement, jamais sur le classpath
# d'exécution. `-dontwarn` et non `-keep` : aucune classe n'est gardée, le
# rétrécissement reste entier (règles listées par AGP dans
# `build/outputs/mapping/release/missing_rules.txt`).
-dontwarn com.google.errorprone.annotations.**
