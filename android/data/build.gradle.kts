// Module data : un seul OkHttp allowlist serveur.
// Cache offline Room phase 4 (#14), SSE client + pairing #15.
plugins {
    id("com.android.library")
}

android {
    namespace = "fr.veryslopnynotes.data"
    compileSdk = 37

    defaultConfig {
        minSdk = 26
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
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
    // (app/VsnBridge.kt), qui doit le voir sur sa classe de chemin.
    api(libs.okhttp)
    // #15 : stockage token sécurisé (EncryptedSharedPreferences, Apache-2.0).
    // Version épinglée au catalogue, licence MIT-compatible, justifiée en PR.
    implementation(libs.security.crypto)
    // #208 : sync périodique de fond SANS serveur (ni SSE, ni push, ni cron).
    // Version épinglée au catalogue (libs.versions.toml), Apache-2.0
    // MIT-compatible, justification en PR. Manifest : aucun composant exporté.
    implementation(libs.work.runtime.ktx)
}
