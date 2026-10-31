# android-env.sh — source depuis le Makefile, jamais exécuté directement.
#
# UN seul endroit qui sait trouver un JDK (17-21, plage testée avec AGP 9.4.1 /
# Gradle 9.8.1) et un SDK : sinon chaque cible réinvente la logique et l'une
# oublie la borne.
# Fonctions sans effet de bord : android_jdk / android_sdk -> chemin ou rien.
# ponytail: pas de `sdkmanager --install` automatique (android/README.md).
# Upgrade: `org.gradle.java.installations.auto-download`.

# Relatif à la racine du repo (les recipes tournent de là) ; surchargé par les
# tests, qui pointent sur un projet temporaire.
ANDROID_PROJECT_DIR="${ANDROID_PROJECT_DIR:-android}"

# Version majeure du java de $1, ou vide si absent/illisible.
_android_java_major() {
    [ -x "$1/bin/java" ] || return 0
    "$1/bin/java" -version 2>&1 |
        sed -n 's/.*version "\([0-9][0-9]*\).*/\1/p' |
        head -1
}

android_jdk() {
    for cand in "${ANDROID_JDK_HOME}" "${JAVA_HOME}" "${HOME}/.cache/jdk17"; do
        [ -n "$cand" ] || continue
        major=$(_android_java_major "$cand")
        case "$major" in
            ''|*[!0-9]*) continue ;;
        esac
        if [ "$major" -ge 17 ] && [ "$major" -le 21 ]; then
            printf '%s' "$cand"
            return 0
        fi
    done
    return 0
}

android_sdk() {
    for cand in "${ANDROID_HOME}" "${ANDROID_SDK_ROOT}"; do
        if [ -n "$cand" ] && [ -d "$cand" ]; then
            printf '%s' "$cand"
            return 0
        fi
    done
    # Repli sur local.properties (gitignoré), posé par une installation manuelle.
    if [ -f "$ANDROID_PROJECT_DIR/local.properties" ]; then
        cand=$(sed -n 's/^sdk\.dir=//p' "$ANDROID_PROJECT_DIR/local.properties" | head -1)
        if [ -n "$cand" ] && [ -d "$cand" ]; then
            printf '%s' "$cand"
            return 0
        fi
    fi
    return 0
}

# Une seule formulation pour les deux commandes APK.
android_toolchain_hint() {
    cat <<'HINT'
  JDK 17-21 : Adoptium 17 suffit (AGP 9.4.1).
              Pointez ANDROID_JDK_HOME ou JAVA_HOME dessus.
  SDK Android : sdkmanager "platforms;android-37.0" "build-tools;36.0.0" platform-tools
              puis ANDROID_HOME=<sdk> ou sdk.dir dans android/local.properties.
HINT
}