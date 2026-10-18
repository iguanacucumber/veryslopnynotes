plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// Graine serveur : défaut de l'app quand l'utilisateur n'a pas choisi
// d'adresse à l'exécution (écran d'appairage -> data/ServerStore). Valeur
// depuis local.properties `server.host` ou env SERVER_HOST ; aucun hôte tiers
// ici (voir README + INVARIANTS I1). Règle HTTPS-only sauf
// http://10.0.2.2 / localhost (émulateur), identique à
// core/ServerConfig.validateBaseUrl qui borne et normalise toute saisie.
// Médias via proxy serveur, pas de WebView distante.
//
// Interface React locale (#333) : `-Pweb.ui=true` ou `WEB_UI=true` fait
// dépendre `preBuild` du build Bun et active `BuildConfig.WEB_UI`. Défaut
// false = Compose, donc CI hors ligne et APK actuels inchangés.
val webUiEnabled = ((project.findProperty("web.ui") as String?)
    ?: System.getenv("WEB_UI"))
    ?.trim()?.lowercase()
    ?.let { it == "true" || it == "1" || it == "yes" } ?: false

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
        // Interrupteur d'interface : Compose reste le défaut.
        buildConfigField("boolean", "WEB_UI", webUiEnabled.toString())
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
            // #313 : R8 sur la release (l'APK distribué, donc celui qui doit
            // démarrer vite) — minification du code + rétrécissement des
            // ressources. Les règles propres au module sont dans
            // `android/app/proguard-rules.pro` (minimal : AGP agrège déjà les
            // règles consommateur des AAR). `proguard-android-optimize.txt` et
            // non `proguard-android.txt` : la release est l'artefact public, pas
            // le variant de débogage.
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
            // Release signée (issue #32) : clé TOUJOURS hors repo.
            // Vars : gradle.properties `release.storeFile/storePassword/keyAlias/
            // keyPassword` ou env STORE_FILE/STORE_PASSWORD/KEY_ALIAS/KEY_PASSWORD.
            // Présentes = signature release custom. Absentes = repli debug
            // (#297 : APK public sideload installable sans cert custom, aucun
            // secret en repo — clé debug auto Gradle). Ne pas publier ce repli
            // comme mise à jour d'un APK signé custom (signature différente).
            val storeFileProp = (project.findProperty("release.storeFile") as String?)
                ?: System.getenv("STORE_FILE")
            if (!storeFileProp.isNullOrBlank()) {
                signingConfig = signingConfigs.getByName("release")
            } else {
                signingConfig = signingConfigs.getByName("debug")
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

// Build de l'UI React dans les assets de l'APK. Tâche enregistrée toujours
// (config stable) mais rattachée à `preBuild` SEULEMENT si WEB_UI : sans le
// drapeau, aucun appel à Bun, donc build hors ligne inchangé.
// Sortie : android/app/src/main/assets/web/ (gitignorée).
val buildWebUi = tasks.register<Exec>("buildWebUi") {
    workingDir = rootProject.projectDir.parentFile
    commandLine("bun", "run", "build:web")
    inputs.dir(rootProject.projectDir.parentFile.resolve("web/src"))
    inputs.file(rootProject.projectDir.parentFile.resolve("web/vite.config.ts"))
    inputs.file(rootProject.projectDir.parentFile.resolve("package.json"))
    outputs.dir(projectDir.resolve("src/main/assets/web"))
}
if (webUiEnabled) {
    tasks.named("preBuild") { dependsOn(buildWebUi) }
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
    // #333 : le pont natif lance le scan du QR (ScanContract). Même artefact
    // déjà présent dans `:ui` (#127), même version épinglée : ce n'est pas une
    // dépendance nouvelle, seulement l'accès depuis le module hôte.
    implementation("com.journeyapps:zxing-android-embedded:4.3.0")
    // ponytail: un seul client HTTP (OkHttp allowlist serveur).
    // Upgrade: cache offline Room phase 4 (#14), SSE client #15.
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    debugImplementation("androidx.compose.ui:ui-tooling:1.6.8")
}
