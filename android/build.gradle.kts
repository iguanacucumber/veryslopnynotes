// Le classpath Kotlin est la seule déclaration sans alias de plugin (AGP fournit
// Kotlin en interne) : il lit l'entrée `kotlin` du catalogue, comme la CI.
buildscript {
    repositories {
        google()
        mavenCentral()
    }
    dependencies {
        // Force la version stable sans appliquer le plugin kotlin-android.
        classpath("org.jetbrains.kotlin:kotlin-gradle-plugin:${libs.versions.kotlin.get()}")
    }
}
plugins {
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.android.library) apply false
}
