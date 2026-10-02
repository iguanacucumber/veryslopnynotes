plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// allowlist serveur unique. buildConfigField depuis
// local.properties `server.host` ou env SERVER_HOST ; aucun
// hôte tiers ici (voir README + INVARIANTS I1).
// Usage cibles : BuildConfig.SERVER_HOST (+ SERVER_SCHEME),
// validés HTTPS-only sauf http://10.0.2.2 / localhost (émulateur).
// Médias via proxy serveur, pas de WebView distante.
android {
    namespace = "fr.veryslopnynotes.app"
    compileSdk = 34

    defaultConfig {
        applicationId = "fr.veryslopnynotes.app"
        minSdk = 26
        targetSdk = 34
        versionCode = 1
        versionName = "0.1.0"

        val host = (project.findProperty("server.host") as String?)
            ?: System.getenv("SERVER_HOST")
            ?: "10.0.2.2:3000"
        // ponytail: logique dupliquée de core/ServerConfig.schemeFor
        // (Gradle ne dépend pas du module core). Upgrade: settings partagés.
        val emulator = host.startsWith("10.0.2.2") || host.startsWith("localhost")
        val scheme = if (emulator) "http" else "https"
        buildConfigField("String", "SERVER_SCHEME", "\"$scheme\"")
        buildConfigField("String", "SERVER_HOST", "\"$host\"")
    }

    signingConfigs {
        // Clé release hors repo (jamais commitée, voir docs/RELEASE.md).
        // Config incomplète = bloc inutilisé (buildTypes ne l'assigne que si
        // STORE_FILE présent), donc aucun secret en dur, aucun défaut.
        create("release") {
            val f = (project.findProperty("release.storeFile") as String?)
                ?: System.getenv("STORE_FILE")
            if (!f.isNullOrBlank()) {
                storeFile = file(f)
                storePassword = ((project.findProperty("release.storePassword") as String?)
                    ?: System.getenv("STORE_PASSWORD"))
                keyAlias = ((project.findProperty("release.keyAlias") as String?)
                    ?: System.getenv("KEY_ALIAS"))
                keyPassword = ((project.findProperty("release.keyPassword") as String?)
                    ?: System.getenv("KEY_PASSWORD"))
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            // Release signée (issue #32) : clé TOUJOURS hors repo.
            // Vars : gradle.properties `release.storeFile/storePassword/keyAlias/
            // keyPassword` ou env STORE_FILE/STORE_PASSWORD/KEY_ALIAS/KEY_PASSWORD.
            // Absentes = APK non signé (assembleRelease OK, à signer en local).
            val storeFileProp = (project.findProperty("release.storeFile") as String?)
                ?: System.getenv("STORE_FILE")
            if (!storeFileProp.isNullOrBlank()) {
                signingConfig = signingConfigs.getByName("release")
            }
        }
    }
    buildFeatures {
        buildConfig = true
        compose = true
    }
    composeOptions {
        kotlinCompilerExtensionVersion = "1.5.14"
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
    implementation(project(":data"))
    implementation(project(":ui"))
    val composeBom = platform("androidx.compose:compose-bom:2024.06.00")
    implementation(composeBom)
    androidTestImplementation(composeBom)
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.activity:activity-compose:1.9.2")
    implementation("androidx.compose.material3:material3:1.2.1")
    implementation("androidx.compose.ui:ui:1.6.8")
    implementation("androidx.compose.ui:ui-tooling-preview:1.6.8")
    implementation("androidx.navigation:navigation-compose:2.7.7")
    // ponytail: un seul client HTTP (OkHttp allowlist serveur).
    // Upgrade: cache offline Room phase 4 (#14), SSE client #15.
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    debugImplementation("androidx.compose.ui:ui-tooling:1.6.8")
}
