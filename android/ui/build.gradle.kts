// Module ui : navigation Compose Material3 + écrans offline #14,
// pairing/SSE #15, alertes #21 via core+data.
plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "fr.veryslopnynotes.ui"
    compileSdk = 34

    defaultConfig {
        minSdk = 26
    }
    buildFeatures {
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
    val composeBom = platform("androidx.compose:compose-bom:2024.06.00")
    implementation(composeBom)
    implementation("androidx.compose.material3:material3:1.2.1")
    implementation("androidx.compose.ui:ui:1.6.8")
    implementation("androidx.navigation:navigation-compose:2.7.7")
    // `ApiClient` expose `OkHttpClient` dans sa surface publique et l'écran
    // d'appairage construit un client : le module UI manipule donc le type
    // directement. `data` le déclare en `implementation` (donc absent de notre
    // classpath de compilation) : on le déclare ici aussi, version alignée.
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    // #122 : scan du QR affiché par l'application de l'établissement. Aucune
    // permission CAMERA (le scan est délégué à Play Services), et le champ de
    // collage reste le repli quand le module n'est pas disponible.
    implementation("com.google.android.gms:play-services-code-scanner:16.1.0")
}
