# android-env.sh — source depuis le Makefile, ne JAMAIS exécuté directement.
#
# UN seul endroit qui sait trouver un JDK et un SDK utilisables par Gradle. Les
# recipes s'en servent au lieu de dupliquer la découverte (3 cibles : compile,
# APK debug, APK release). Sans ce fichier, chaque cible réinvente la logique et
# l'une d'elles finit par oublier la borne de version du JDK.
#
# Fonctions (aucun effet de bord à part définir) :
#   android_jdk  -> chemin d'un JDK 17-21, ou rien
#   android_sdk  -> chemin d'un SDK Android existant, ou rien
#
# Pourquoi 17-21 : Gradle 8.7 (android/gradle/wrapper) REFUSE un JDK plus récent
# avec un échec illisible («Unsupported class file major version… »). On choisit
# donc un JDK compatible plutôt que de laisser l'utilisateur le découvrir.
# ponytail: pas de `sdkmanager --install` automatique ni de téléchargement ;
# on lit ce qui est là, l'installation est documentée (android/README.md).
# Upgrade: `org.gradle.java.installations.auto-download` une fois Gradle ≥ 8.8.

# Repertoire du projet Android (celui qui contient local.properties), relatif a la
# racine du repo : les recipes Make tournent de la racine. Surchargeable pour les
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
    # Repli sur la config locale (gitignorée) : c'est là que `local.properties`
    # pointe après une installation manuelle du SDK.
    if [ -f "$ANDROID_PROJECT_DIR/local.properties" ]; then
        cand=$(sed -n 's/^sdk\.dir=//p' "$ANDROID_PROJECT_DIR/local.properties" | head -1)
        if [ -n "$cand" ] && [ -d "$cand" ]; then
            printf '%s' "$cand"
            return 0
        fi
    fi
    return 0
}

# Message d'installation, une seule formulation pour les deux commandes APK.
android_toolchain_hint() {
    cat <<'HINT'
  JDK 17-21 : Adoptium 17 suffit (Gradle 8.7 refuse > 21).
              Pointez ANDROID_JDK_HOME ou JAVA_HOME dessus.
  SDK Android : sdkmanager "platforms;android-34" "build-tools;34.0.0" platform-tools
              puis ANDROID_HOME=<sdk> ou sdk.dir dans android/local.properties.
HINT
}