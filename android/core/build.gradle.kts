// Module core : config hôte unique + garde allowlist (I1), sans réseau.
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
