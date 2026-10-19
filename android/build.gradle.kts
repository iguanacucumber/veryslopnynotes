// Top-level build — versions figées phase 4 (issue #13, ADR-001).
// Pas de code métier ici : déclarations de plugins seules.
buildscript {
    repositories {
        google()
        mavenCentral()
    }
    dependencies {
        // AGP 9.x embarque Kotlin 2.2.10 ; le classpath force la version stable
        // courante sans appliquer le plugin kotlin-android (built-in Kotlin).
        classpath("org.jetbrains.kotlin:kotlin-gradle-plugin:2.4.21")
    }
}
plugins {
    id("com.android.application") version "9.4.1" apply false
    id("com.android.library") version "9.4.1" apply false
}
