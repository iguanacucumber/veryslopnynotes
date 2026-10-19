// Module core : config hôte unique + garde allowlist (I1).
// Aucune dépendance réseau ici, aucun hôte tiers.
plugins {
    id("com.android.library")
}

android {
    namespace = "fr.veryslopnynotes.core"
    compileSdk = 37

    defaultConfig {
        minSdk = 26
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}
