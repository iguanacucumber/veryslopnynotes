// Top-level build — versions figées phase 4 (issue #13, ADR-001).
// Pas de code métier ici : déclarations de plugins seules.
plugins {
    id("com.android.application") version "8.5.2" apply false
    id("org.jetbrains.kotlin.android") version "1.9.24" apply false
    id("com.android.library") version "8.5.2" apply false
}
