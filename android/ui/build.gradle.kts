// Module ui : navigation Compose Material3 + écrans offline #14,
// appairage local #206, alertes #21 via core+data.
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
    // #205 : l'UI passe le client local aux dépôts (même motif qu'OkHttp
    // ci-dessous : type manipulé directement, `data` en `implementation`).
    implementation(project(":pronote"))
    val composeBom = platform("androidx.compose:compose-bom:2024.06.00")
    implementation(composeBom)
    implementation("androidx.compose.material3:material3:1.2.1")
    implementation("androidx.compose.ui:ui:1.6.8")
    // #127 : `rememberLauncherForActivityResult` (lance-caméra du scan) habite
    // dans activity-compose, que `app` déclare mais pas `ui`.
    implementation("androidx.activity:activity-compose:1.9.2")
    implementation("androidx.navigation:navigation-compose:2.7.7")
    // #206 : plus de client HTTP dans l'UI (appairage et lectures device-only,
    // `ApiClient` supprimé) — OkHttp ne vit plus que dans `data` (fournisseur
    // LLM direct), qui l'expose en `implementation`.
    // #127 : scan du QR affiché par l'application de l'établissement. Le
    // décodeur est dans l'APK et l'activité de scan demande elle-même la
    // permission CAMERA : aucune dépendance à Google Play Services, donc le
    // bouton marche aussi sur l'émulateur et sur un téléphone sans GMS.
    implementation("com.journeyapps:zxing-android-embedded:4.3.0")
}
