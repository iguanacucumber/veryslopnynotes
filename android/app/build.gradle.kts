plugins {
    id("com.android.application")
}

// Le tag `vX.Y.Z` posé sur HEAD fixe la version ; sans tag, repli 0.1.0/1.
// Le calcul pur vit dans agents/runtime/android-version.ts (testé par
// tests/unit/version-from-tags.test.ts) : une seule lecture git, pas une
// formule recopiée dans chaque script de build.
val tagVersion = providers.exec {
    workingDir = rootProject.projectDir.parentFile
    commandLine("bun", "run", "agents/runtime/android-version.ts")
}.standardOutput.asText.get().trim().split(Regex("\\s+"))
require(tagVersion.size == 2) {
    "android-version.ts : sortie inattendue « ${tagVersion.joinToString(" ")} »"
}
val tagVersionName = tagVersion[0]
val tagVersionCode = tagVersion[1].toIntOrNull()
    ?: error("android-version.ts : versionCode non entier « ${tagVersion[1]} »")

// Graine serveur : HTTPS-only, et AUCUN défaut en release (SEC-01). Le défaut
// émulateur `10.0.2.2:3000` vit uniquement dans le variant debug, avec son
// network_security_config dédié.
val configuredHost = (project.findProperty("server.host") as String?)
    ?: System.getenv("SERVER_HOST")

android {
    namespace = "fr.veryslopnynotes.app"
    compileSdk = 37

    defaultConfig {
        applicationId = "fr.veryslopnynotes.app"
        minSdk = 26
        targetSdk = 37
        versionCode = tagVersionCode
        versionName = tagVersionName
        // Tests instrumentés (#887) : même APK debug que le smoke émulateur.
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    testOptions {
        // Une fenêtre animée rend les assertions d'état non déterministes.
        animationsDisabled = true
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
        // Défaut émulateur (http local) réservé au debug ; la release ne part
        // jamais sur `10.0.2.2` ni en clair, même sans configuration.
        debug {
            val host = configuredHost ?: "10.0.2.2:3000"
            // ponytail: logique dupliquée de core/ServerConfig.schemeFor
            // (Gradle ne dépend pas du module core). Upgrade: settings partagés.
            val emulator = host.startsWith("10.0.2.2") || host.startsWith("localhost")
            val scheme = if (emulator) "http" else "https"
            buildConfigField("String", "SERVER_SCHEME", "\"$scheme\"")
            buildConfigField("String", "SERVER_HOST", "\"$host\"")
            // DAT-06 : la démo de l'éditeur est une porte de développement.
            buildConfigField("Boolean", "DEMO_MODE", "true")
        }
        release {
            // Graine VIDE par défaut : l'utilisateur saisit son serveur.
            buildConfigField("String", "SERVER_SCHEME", "\"https\"")
            buildConfigField("String", "SERVER_HOST", "\"${configuredHost.orEmpty()}\"")
            // DAT-06 : aucune connexion de démonstration dans l'APK publiable.
            buildConfigField("Boolean", "DEMO_MODE", "false")
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
    inputs.file(rootProject.projectDir.parentFile.resolve("web/index.html"))
    inputs.dir(rootProject.projectDir.parentFile.resolve("web/public"))
    inputs.dir(rootProject.projectDir.parentFile.resolve("shared"))
    inputs.file(rootProject.projectDir.parentFile.resolve("web/vite.config.ts"))
    // Vite lit ce tsconfig pour la transformation : `jsx`, `target` changent
    // le bundle sans toucher au code source.
    inputs.file(rootProject.projectDir.parentFile.resolve("web/tsconfig.json"))
    inputs.file(rootProject.projectDir.parentFile.resolve("package.json"))
    // Le lockfile décide des versions RÉSOLUES : sans cette entrée, Gradle dit
    // UP-TO-DATE et l'APK embarque un bundle périmé.
    inputs.file(rootProject.projectDir.parentFile.resolve("bun.lock"))
    // Copié dans les assets par build-web.ts : une notice modifiée doit
    // refaire le bundle, sinon l'APK garde l'ancien inventaire.
    inputs.file(rootProject.projectDir.parentFile.resolve("THIRD_PARTY_NOTICES.md"))
    outputs.dir(projectDir.resolve("src/main/assets/web"))
}
tasks.named("preBuild") { dependsOn(buildWebUi) }

dependencies {
    implementation(project(":core"))
    implementation(project(":data"))
    implementation(libs.core.ktx)
    implementation(libs.activity.ktx)
    implementation(libs.exifinterface)
    implementation(libs.zxing.android.embedded)
    // ponytail: un seul client HTTP (OkHttp allowlist serveur).
    // Upgrade: cache offline Room.
    implementation(libs.okhttp)

    // Instrumenté uniquement : aucune dépendance de test n'entre dans l'APK.
    androidTestImplementation(libs.androidx.test.ext.junit)
    androidTestImplementation(libs.androidx.test.runner)
}
