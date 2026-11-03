plugins {
    id("com.android.library")
}

android {
    namespace = "fr.veryslopnynotes.data"
    compileSdk = 37

    defaultConfig {
        minSdk = 26
    }
    buildFeatures {
        buildConfig = true
    }
    buildTypes {
        // DAT-06 : même drapeau que l'app — une session de démo ne se
        // restaure jamais en release, même si le disque en portait une.
        debug {
            buildConfigField("Boolean", "DEMO_MODE", "true")
        }
        release {
            buildConfigField("Boolean", "DEMO_MODE", "false")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    implementation(project(":core"))
    // Les dépôts lisent le client local (:pronote), pas le serveur métier.
    implementation(project(":pronote"))
    // ponytail: OkHttp seul client HTTP (allowlist serveur).
    // Upgrade: cache offline Room.
    // `api` et non `implementation` : le constructeur public expose OkHttpClient.
    api(libs.okhttp)
    implementation(libs.security.crypto)
    implementation(libs.work.runtime.ktx)
}
