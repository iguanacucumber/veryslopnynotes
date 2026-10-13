// Module data : un seul OkHttp allowlist serveur.
// Cache offline Room phase 4 (#14), SSE client + pairing #15.
plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "fr.veryslopnynotes.data"
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

dependencies {
    implementation(project(":core"))
    // #205 : les dépôts lisent le client local (port #200/#201), plus le
    // serveur métier. Dépendance inter-modules, pas une dépendance ajoutée.
    implementation(project(":pronote"))
    // ponytail: OkHttp seul client HTTP (allowlist serveur).
    // #212 : `api` et non `implementation` — le constructeur public
    // OpenRouterLlm(..., client: OkHttpClient) expose le type à l'appelant
    // (ui/Assignments.kt), qui doit le voir sur sa classe de chemin.
    api("com.squareup.okhttp3:okhttp:4.12.0")
    // #15 : stockage token sécurisé (EncryptedSharedPreferences, Apache-2.0).
    // Version épinglée, licence MIT-compatible, justifiée en PR.
    implementation("androidx.security:security-crypto:1.1.0")
    // #208 : sync périodique de fond SANS serveur (ni SSE, ni push, ni cron).
    // Version épinglée au catalogue (libs.versions.toml), Apache-2.0
    // MIT-compatible, justification en PR. Manifest : aucun composant exporté.
    implementation(libs.work.runtime.ktx)
}
