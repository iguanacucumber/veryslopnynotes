// Module pronote : protocole PRONOTE (port Kotlin #200, zéro dépendance).
//
// Parle au serveur de l'établissement EN DIRECT (handshake RSA-1024 +
// AES-128-CBC, POST chiffrés/compressés, cookies, redirects manuelles) : c'est
// le SEUL module Android autorisé à le faire (I1 repointé, cf. ADR-003 quand
// elle existera). Aucune dépendance : stdlib Kotlin + plateforme Java
// (`javax.crypto`, `java.util.zip`, `java.net`) déjà sur API 26.
//
// Les appels réseau sont BLOQUANTS (pas de coroutines sans dépendance) : ne
// jamais appeler sur le thread UI, le client (#201) s'en charge.
plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "fr.veryslopnynotes.pronote"
    compileSdk = 34

    defaultConfig {
        minSdk = 26
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}
