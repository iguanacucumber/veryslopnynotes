plugins {
    id("com.android.application")
}

// Graine serveur : HTTPS-only sauf émulateur/localhost, comme
// core/ServerConfig.validateBaseUrl ; aucun hôte tiers (I1).
android {
    namespace = "fr.veryslopnynotes.app"
    compileSdk = 37

    defaultConfig {
        applicationId = "fr.veryslopnynotes.app"
        minSdk = 26
        targetSdk = 37
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
        // Clé release hors repo (jamais commitée, docs/RELEASE.md) : config
        // incomplète = bloc inutilisé, aucun secret en dur.
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
            // R8 sur la release (artefact public) : code minifié, ressources rétrécies.
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
            // Clé TOUJOURS hors repo ; absente = repli debug, à ne pas publier
            // comme mise à jour d'un APK signé custom.
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
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

// Build de l'UI React dans les assets de l'APK, branché sur `preBuild` : l'APK
// ne peut pas être construit sans `web/index.html`. Sortie gitignorée.
val buildWebUi = tasks.register<Exec>("buildWebUi") {
    workingDir = rootProject.projectDir.parentFile
    commandLine("bun", "run", "build:web")
    inputs.dir(rootProject.projectDir.parentFile.resolve("web/src"))
    inputs.file(rootProject.projectDir.parentFile.resolve("web/vite.config.ts"))
    inputs.file(rootProject.projectDir.parentFile.resolve("package.json"))
    // Le lockfile décide des versions RÉSOLUES : sans cette entrée, Gradle dit
    // UP-TO-DATE et l'APK embarque un bundle périmé.
    inputs.file(rootProject.projectDir.parentFile.resolve("bun.lock"))
    outputs.dir(projectDir.resolve("src/main/assets/web"))
}
tasks.named("preBuild") { dependsOn(buildWebUi) }

dependencies {
    implementation(project(":core"))
    implementation(project(":data"))
    implementation(libs.core.ktx)
    implementation(libs.activity.ktx)
    implementation(libs.zxing.android.embedded)
    // ponytail: un seul client HTTP (OkHttp allowlist serveur).
    // Upgrade: cache offline Room.
    implementation(libs.okhttp)
}
