// Top-level build — versions figées phase 4 (issue #13, ADR-001).
// Pas de code métier ici : déclarations de plugins seules.
//
// #624 : toutes les versions vivent dans `gradle/libs.versions.toml`. Le
// classpath Kotlin est la seule déclaration sans alias de plugin (AGP 9 fournit
// Kotlin en interne, on ne fait que forcer sa version) : il lit donc l'entrée
// `kotlin` du catalogue. La CI compare son propre littéral à cette entrée
// (tests/architecture/gradle-versions.test.ts).
buildscript {
    repositories {
        google()
        mavenCentral()
    }
    dependencies {
        // AGP 9.x embarque Kotlin 2.2.10 ; le classpath force la version stable
        // courante sans appliquer le plugin kotlin-android (built-in Kotlin).
        classpath("org.jetbrains.kotlin:kotlin-gradle-plugin:${libs.versions.kotlin.get()}")
    }
}
plugins {
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.android.library) apply false
}
