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
    // ponytail: OkHttp seul client HTTP (allowlist serveur).
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    // #15 : stockage token sécurisé (EncryptedSharedPreferences, Apache-2.0).
    // Version épinglée, licence MIT-compatible, justifiée en PR.
    implementation("androidx.security:security-crypto:1.1.0")
}
