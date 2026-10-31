// Module pronote : SEUL module autorisé à parler au serveur de l'établissement
// (I1). Zéro dépendance : stdlib Kotlin + plateforme Java sur API 26.
// Les appels réseau sont BLOQUANTS : jamais sur le thread UI.
plugins {
    id("com.android.library")
}

android {
    namespace = "fr.veryslopnynotes.pronote"
    compileSdk = 37

    defaultConfig {
        minSdk = 26
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}
