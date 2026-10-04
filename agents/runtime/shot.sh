#!/usr/bin/env bash
# shot.sh — capture d'écran d'un écran de l'app, SANS taper au doigt (#133).
#
#   agents/runtime/shot.sh <route> [--package <pkg>] [--wait <secondes>] [--no-build]
#   make shot ROUTE=grades [SHOT_ARGS=--no-build]
#
# Pourquoi ce script existe : vérifier une refonte d'interface écran par écran
# supposait `adb shell input tap X Y`. Des coordonnées qui dépendent de la taille
# d'écran, de la barre système et du thème, et qui échouent en SILENCE — la
# capture montre l'onglet d'à côté, la vérification « passe », personne ne le
# voit. Les deep links `veryslopnynotes://<route>` (déclarés UNIQUEMENT dans le
# source set debug, cf. android/app/src/debug/AndroidManifest.xml) ouvrent
# l'écran visé : la capture devient déterministe.
#
# Contrat : échec BRUYANT, jamais de succès silencieux. Pas d'appareil, APK
# introuvable, capture noire, arrivée sur l'appairage au lieu de la route : on
# sort en erreur en disant ce qui N'A PAS été fait. Une capture non contrôlée ne
# vaut rien — c'est une image, on ne la relit pas dans un diff.
#
# Ce que la capture PROUVE, c'est l'arbre de travail AU MOMENT de la capture :
# Gradle construit l'APK debug systématiquement (il incrementalise, donc quasi
# gratuit quand rien n'a changé) et l'appareil est comparé par empreinte, pas
# par date (#151 : une source plus récente que l'APK = APK périmé, donc
# reconstruction ; un APK périmé sur l'appareil = réinstallation).
#
# Outillage (android-env.sh) : on SOURCE ce fichier de fonctions, jamais on ne
# le réécrit — c'est lui qui connaît la borne JDK 17-21 de Gradle.
set -euo pipefail

RUNTIME_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$RUNTIME_DIR/../.." && pwd)"
ANDROID_DIR="$REPO_ROOT/android"
APK="$ANDROID_DIR/app/build/outputs/apk/debug/app-debug.apk"

APP_PKG="fr.veryslopnynotes.app"
SCHEME="veryslopnynotes"
# uiautomator écrit son dump où on le dit, puis on le relit et on l'efface :
# laisser un XML de l'app (avec les libellés de ses écrans) sur le téléphone,
# c'est du résidu de session dans /sdcard.
REMOTE_UI_XML="/sdcard/vsn-shot-ui.xml"

ROUTE=""
PKG="$APP_PKG"
WAIT_SEC=3
SERIAL=""
RAW=""
BUILD=1

die() {
    printf '%s\n' "$@" >&2
    exit 1
}

usage() {
    cat <<'USAGE'
usage : shot.sh <route> [--package <pkg>] [--wait <secondes>] [--no-build]

  <route>               route de l'app : index, calendar, grades, tasks,
                        profile, settings, news, canteen, attendance,
                        messages, pairing, alerts, fiches, competences,
                        sanctions. Avec --package, simple nom de capture.
  --package <pkg>       autre application (référence Papillon) : pas
                        d'installation, simple lancement + capture.
  --wait <secondes>     délai après lancement avant la capture (défaut 3).
  --no-build            PAS de construction Gradle : recapture rapide du
                        MÊME APK, qui peut être plus vieux que les sources
                        (le script le dit, bruyamment). Réservé à la
                        re-capture d'une capture ratée, jamais au contrôle
                        d'une modification de l'interface.
USAGE
}

# adb -s : un seul numéro de série = une seule commande, sans lever une
# ambiguïté quand deux téléphones sont branchés (le secondmute).
a() {
    if [ -n "$SERIAL" ]; then
        adb -s "$SERIAL" "$@"
    else
        adb "$@"
    fi
}

need_device() {
    command -v adb >/dev/null 2>&1 || die "« adb » absent du PATH : aucune capture possible."
    local ready
    ready=$(adb devices | sed -n 's/^\([^\t]*\)\tdevice$/\1/p' || true)
    [ -n "$ready" ] || die "adb : aucun appareil prêt (écran USB débogage ?). rien capturé."
    SERIAL=$(printf '%s\n' "$ready" | head -1)
    local n
    n=$(printf '%s\n' "$ready" | grep -c . || true)
    [ "$n" -eq 1 ] || die "adb : $n appareils connectés ($(printf '%s' "$ready" | tr '\n' ' ')). rien capturé — brancher un seul téléphone."
}

# Empreinte de l'APK local, vide si absent/illisible.
apk_sha256() {
    [ -f "$APK" ] || return 0
    sha256sum "$APK" 2>/dev/null | cut -d' ' -f1
}

# L'APK doit contenir EXACTEMENT l'arbre de travail courant : c'est Gradle qui
# en est l'autorité, donc on le lance TOUJOURS (il incrementalise : ~1 s quand
# rien n'a changé, quelques secondes sinon). #151 : une comparaison de mtimes ne
# prouve rien — son inverse renvoyait « à jour » sur un APK plus vieux que les
# sources (faux vert), et un motif oublié (`assets/`, `.pro`,
# `libs.versions.toml`) aurait réintroduit le même mensonge dans l'autre
# sens. `--no-build` est le SEUL renoncement, et il parle.
ensure_apk() {
    if [ "$BUILD" = 0 ]; then
        [ -f "$APK" ] || die "shot : --no-build et APK debug absent ($APK) — rien installé, rien capturé."
        printf "shot : --no-build : APK NON reconstruit (%s).\n" "$(apk_sha256 | cut -c1-12)" >&2
        printf '  Les sources peuvent être plus récentes : la capture peut montrer\n' >&2
        printf "  une interface périmée. Relancez SANS --no-build pour la prouver.\n" >&2
        return 0
    fi
    build_apk
    [ -f "$APK" ] || die "shot : construction Gradle terminée sans $APK — rien installé, rien capturé."
}

build_apk() {
    # android-env.sh est écrit pour un shell SANS `set -u` (il lit des variables
    # d'environnement éventuellement absentes). On leur donne un défaut vide :
    # sinon `set -u` fait échouer la capture sur ANDROID_JDK_HOME non défini,
    # pour une raison qui n'a rien à voir avec la capture.
    export ANDROID_JDK_HOME="${ANDROID_JDK_HOME:-}" JAVA_HOME="${JAVA_HOME:-}"
    export ANDROID_HOME="${ANDROID_HOME:-}" ANDROID_SDK_ROOT="${ANDROID_SDK_ROOT:-}"
    # `export` et non préfixe `VAR=x . script` : le préfixe n'est plus garanti
    # quand la fonction android_sdk est appelée APRÈS le source (donc avec le
    # `set -u` de ce script, on obtenait « unbound variable »).
    export ANDROID_PROJECT_DIR="$ANDROID_DIR"
    # shellcheck source=android-env.sh
    . "$RUNTIME_DIR/android-env.sh"
    local jdk sdk
    jdk=$(android_jdk)
    sdk=$(android_sdk)
    if [ -z "$jdk" ] || [ -z "$sdk" ]; then
        android_toolchain_hint
        die "shot : outillage absent (JDK=${jdk:-aucun}, SDK=${sdk:-aucun}) — APK debug NON construit."
    fi
    printf "shot : construction de l'APK debug (%s) …\n" "$(basename "$APK")"
    ( cd "$ANDROID_DIR" && JAVA_HOME="$jdk" ANDROID_HOME="$sdk" \
        ./gradlew --console=plain assembleDebug ) || die "shot : construction Gradle en échec — rien d'installé, rien capturé."
}

# Empreinte de l'APK RÉELLEMENT installé, vide si absent ou illisible. Contenu,
# jamais mtime : deux horloges (poste, téléphone) se mentent, un hash non.
# `base.apk` est le fichier même que `adb install` a écrit (vérifié : sha256
# identique au local), donc l'égalité est une preuve, pas une estimation.
installed_apk_sha256() {
    local path hash
    path=$(a shell dumpsys package "$PKG" | sed -n 's/.*codePath=\(.*\)/\1/p' | head -1 | tr -d '\r')
    [ -n "$path" ] || return 0
    hash=$(a shell sha256sum "$path/base.apk" 2>/dev/null | tr -d '\r' | awk 'NR==1 { print $1 }') || hash=""
    printf '%s' "$hash"
}

# Jamais de `adb uninstall` ici : cela effacerait les données de l'app, donc la
# session appairée, donc l'obligation de rescanner le QR de l'établissement. On
# échoue et on laisse l'utilisateur trancher.
ensure_installed() {
    ensure_apk
    local local_sha remote_sha
    local_sha=$(apk_sha256)
    remote_sha=$(installed_apk_sha256)
    if [ -n "$local_sha" ] && [ "$local_sha" = "$remote_sha" ]; then
        printf "shot : APK debug déjà installé sur l'appareil (empreinte %s… identique), installation évitée.\n" \
            "$(printf '%s' "$local_sha" | cut -c1-12)"
        return 0
    fi
    # Empreinte illisible ou différente = installation. Le seul sens raté serait
    # de se taire, donc on installe.
    printf "shot : installation de l'APK debug (local %s, appareil %s) …\n" \
        "$(printf '%s' "${local_sha:-?}" | cut -c1-12)" "$(printf '%s' "${remote_sha:-inconnu}" | cut -c1-12)"
    local out
    if ! out=$(a install -r "$APK" 2>&1); then
        printf '%s\n' "$out" >&2
        die "shot : installation refusée (signature différente ?). Je ne désinstalle PAS tout
  seul : « adb uninstall » effacerait la session appairée (QR à rescaner)."
    fi
    printf '%s\n' "$out" | sed 's/^/shot : /'
    # L'installation est un fait, pas une intention : on la relit sur l'appareil.
    remote_sha=$(installed_apk_sha256)
    if [ -n "$remote_sha" ] && [ "$remote_sha" != "$local_sha" ]; then
        die "shot : l'appareil fait tourner une AUTRE empreinte (${remote_sha:0:12} contre
  ${local_sha:0:12}). Capture NON faite : elle montrerait une autre interface."
    fi
    # Empreinte illisible (appareil sans sha256sum) = vérification IMPOSSIBLE, pas
    # fausse : on continue, mais on le dit — un « ça marche » sans preuve ne
    # vaut rien.
    [ -n "$remote_sha" ] || printf "shot : empreinte de l'APK installed ILLISIBLE sur cet appareil (pas de sha256sum) : installation non vérifiée.\n" >&2
}

launch_app() {
    local out
    # Arrêt forcé AVANT le lancement : un deep link n'est traité qu'à la
    # CONSTRUCTION du NavController (NavController.onGraphCreated), donc sur une
    # activité déjà vivante le `onNewIntent` serait ignoré et la capture
    # montrerait l'écran précédent — le faux vert qu'on veut supprimer. L'arrêt
    # forcé ne touche à AUCUNE donnée de l'app : ni session appairée, ni cache.
    a shell am force-stop "$PKG" >/dev/null 2>&1 || true
    sleep 1
    if [ "$PKG" = "$APP_PKG" ]; then
        out=$(a shell am start -W -a android.intent.action.VIEW \
            -c android.intent.category.BROWSABLE -d "$SCHEME://$ROUTE" 2>&1 | tr -d '\r') || true
    else
        # Application tierce (référence Papillon) : aucune route à ouvrir, on
        # lance son activité LAUNCHER résolue par le système lui-même.
        local act
        act=$(a shell cmd package resolve-activity --brief -c android.intent.category.LAUNCHER "$PKG" 2>/dev/null \
            | tr -d '\r' | grep -E '^[a-zA-Z0-9_.]+/' | head -1) || true
        [ -n "$act" ] || die "shot : $PKG n'a pas d'activité LAUNCHER résolue — application non lancée, rien capturé."
        out=$(a shell am start -W -n "$act" 2>&1 | tr -d '\r') || true
    fi
    if printf '%s' "$out" | grep -q "Error"; then
        printf '%s\n' "$out" >&2
        die "shot : lancement refusé — écran non atteint, rien capturé."
    fi
}

screen_size() {
    a shell wm size | sed -n 's/.*size: \([0-9][0-9]*x[0-9][0-9]*\).*/\1/p' | tail -1
}

# Une seule capture par tentative, en mémoire : le PNG affiché est la preuve.
capture() {
    local dest="$1"
    a exec-out screencap -p > "$dest" || die "shot : screencap a échoué — aucun fichier écrit."
    [ -s "$dest" ] || die "shot : screencap a renvoyé 0 octet — aucun fichier écrit."
}

raw_frame() {
    [ -n "$RAW" ] && return 0
    RAW=$(mktemp)
    local size
    size=$(screen_size)
    [ -n "$size" ] || die "shot : taille d'écran illisible (wm size) — capture non contrôlable."
    a exec-out screencap > "$RAW" || die "shot : screencap brut a échoué — capture non contrôlable."
}

# Une image uniformément noire/blanche = écran éteint ou en cours d'extinction :
# `screencap` ne rend alors RIEN de l'app, et la capture passerait pour une
# capture d'écran de l'app. Trois outils possibles, trois verdicts identiques ;
# aucun disponible = échec, jamais un « ça doit être bon ».
# Le chemin passe par l'ENVIRONNEMENT, pas par argv : selon le runtime (bun,
# node, un wrapper node fourni par bun), `-e` avale ou non l'argument suivant —
# un chemin perdu se lirait « fichier absent », jamais « image noire ».
DISTINCT_JS='const { readFile } = await import("node:fs/promises");
const buf = new Uint8Array(await readFile(process.env.SHOT_RAW));
const px = new Uint32Array(buf.buffer, buf.byteOffset, buf.byteLength >> 2);
const seen = new Set();
for (let i = 0; i < px.length; i++) {
  seen.add(px[i]);
  if (seen.size > 2) break;
}
console.log(seen.size);'

blank_verdict() {
    local png="$1" out k sd
    if command -v identify >/dev/null 2>&1; then
        out=$(identify -format "%k %[fx:standard_deviation]" "$png" 2>/dev/null | head -1) || true
    elif command -v magick >/dev/null 2>&1; then
        out=$(magick identify -format "%k %[fx:standard_deviation]" "$png" 2>/dev/null | head -1) || true
    else
        out=""
    fi
    if [ -n "$out" ]; then
        k=${out%% *}
        sd=${out##* }
        [ "$k" -le 2 ] 2>/dev/null && { echo "image uniforme ($k couleur(s)) : écran éteint"; return 0; }
        awk -v sd="$sd" 'BEGIN { exit (sd < 0.005) ? 0 : 1 }' && { echo "image sans aucun détail : écran éteint"; return 0; }
        echo "ok"
        return 0
    fi
    if command -v ffmpeg >/dev/null 2>&1; then
        # ffmpeg ne décode pas le PNG dans tous les builds (celui-ci non) :
        # on analyse donc le tampon BRUT, que tout le monde sait lire.
        raw_frame
        out=$(ffmpeg -v error -f rawvideo -pix_fmt rgba -s "$(screen_size)" -i "$RAW" \
            -vf "signalstats,metadata=mode=print:file=-" -f null - 2>/dev/null \
            | sed -n 's/^lavfi\.signalstats\.\(YMIN\|YMAX\|YAVG\)=\(.*\)$/\1 \2/p') || true
        if [ -n "$out" ]; then
            local ymin ymax yavg
            ymin=$(printf '%s' "$out" | sed -n 's/^YMIN //p')
            ymax=$(printf '%s' "$out" | sed -n 's/^YMAX //p')
            yavg=$(printf '%s' "$out" | sed -n 's/^YAVG //p')
            # Unité seulement si ffmpeg a vraiment sorti les deux bornes : sinon
            # « YMIN=YMAX= » ferait croire à une image uniforme (faux écran noir).
            if [ -n "$ymin" ] && [ -n "$ymax" ] && awk -v a="$ymin" -v b="$ymax" 'BEGIN { exit (b - a <= 1) ? 0 : 1 }'; then
                echo "image uniforme (YMIN=YMAX=$ymin) : écran éteint"
                return 0
            fi
            awk -v v="$yavg" 'BEGIN { exit (v < 5) ? 0 : 1 }' \
                && { echo "image quasi noire (YAVG=$yavg) : écran éteint"; return 0; }
            echo "ok"
            return 0
        fi
    fi
    local rt n
    for rt in bun node; do
        command -v "$rt" >/dev/null 2>&1 || continue
        raw_frame
        n=$(SHOT_RAW="$RAW" "$rt" -e "$DISTINCT_JS" 2>/dev/null | tail -1) || true
        if [ -n "$n" ] && [ "$n" -le 2 ] 2>/dev/null; then
            echo "image uniforme ($n couleur(s)) : écran éteint"
            return 0
        fi
        [ -n "$n" ] && { echo "ok"; return 0; }
    done
    die "shot : aucune image disponible pour vérifier la capture (identify, ffmpeg et
  bun/node absents). Capture NON contrôlée, donc refusée — installez ImageMagick."
}

# Libellés réellement à l'écran : `uiautomator dump` voit l'arbre de sémantique
# Compose, donc les `Text(...)` de nos écrans. Vide = dump impossible (écran
# éteint, autre instrumentation active) — on le dit, on ne devine pas.
screen_texts() {
    a shell uiautomator dump "$REMOTE_UI_XML" >/dev/null 2>&1 || return 0
    local xml
    xml=$(a shell cat "$REMOTE_UI_XML" 2>/dev/null | tr -d '\r') || xml=""
    a shell rm -f "$REMOTE_UI_XML" >/dev/null 2>&1 || true
    printf '%s' "$xml" | tr '>' '\n' | sed -n 's/.*text="\([^"]*\)".*/\1/p' | sed '/^$/d'
}

# Étapes de l'assistant : certaines seulement selon l'avancement (le parcours
# change selon le serveur saisi), donc on cherche plusieurs marqueurs.
is_pairing() {
    printf '%s' "$1" | grep -qiE 'adresse du serveur|code pin du qr|contenu du qr|ton établissement'
}

# Verrouillage de l'appareil : la capture ne montre alors QUE le clavier du
# code, ce qui n'est ni noir ni notre écran — d'où un contrôle à part, préalable
# à celui de la route. "Code PIN" est EXCLU du motif : l'appairage affiche
# "Code PIN du QR", et confondre les deux enverrait l'utilisateur chercher une
# session morte alors que le téléphone est simplement verrouillé.
is_locked() {
    # Insensible à la casse : le verrouillage suit la LANGUE du téléphone, pas
    # celle du script (vérifié : « Enter PIN » sur un appareil en anglais).
    printf '%s' "$1" | grep -qiE 'enter pin|enter password|enter pattern|swipe up to unlock|déverrouill|vérification biométrique'
}

# ---------------------------------------------------------------------------
# #160 — LE TEXTE À L'ÉCRAN, ÉCRIT UN SEUL ENDROIT.
#
# `verify_route` cherche deux choses dans le dump uiautomator : le TITRE de la
# barre du haut — le libellé du contrat de navigation, table `TOP_BARS` de
# `AppShell.kt` (#135), donc stable quand une refonte remplace le CORPS d'un
# écran — puis un FRAGMENT propre à cet écran.
#
# Pourquoi le fragment est partout : le titre seul ne prouve pas grand-chose.
# Sur les cinq routes d'ONGLET, c'est le libellé de l'onglet (« Accueil »,
# « Notes », « Profil »…) que la barre d'onglets affiche sur TOUTES les routes :
# il est donc toujours là. Ailleurs, un ÉCRAN CENTRAL le réimprime en bouton —
# l'onglet Notes propose « Réglages », « Appairage QR+PIN », « Alertes sécurité »
# et « Compétences », l'accueil des cartes « Actualités », « Cantine »,
# « Vie scolaire », « Messages », le profil les mêmes. Deux exceptions : `news`
# et `fiches`, dont le corps ne dépend que de la donnée, donc sans libellé fixe :
# leur titre EST le témoin.
#
# Format : `route|titre|fragment`, `;` entre fragments ALTERNATIFS (un seul
# suffit) — l'accueil est le seul écran dont TOUT le corps dépend des données :
# « Afficher plus » quand un widget est là, « Rien à afficher » quand la page
# est vide.
#
# #166 — UN FRAGMENT PAR ÉTAT, sinon le témoin est de la donnée. Règle lue et
# vérifiée dans `tests/unit/shot-harness.test.ts` : la liste doit contenir au
# moins un libellé lisible dans l'état PLEIN **et** dans l'état SANS DONNÉE
# (cache vide, échec réseau, établissement qui ne publie rien). Le défaut était
# l'onglet Notes : « Moyennes par matière » ne sort que dans la branche qui a
# des notes à montrer (`GradesScreen.kt`), donc hors ligne — sur un écran
# parfaitement correct — la capture échouait :
#
#     shot : la route « grades » NON PROUVÉE (« Moyennes par matière » absent).
#
# Le même critère a été repassé sur les quinze : `calendar` (« semaine du »),
# `tasks` (« Devoirs de la semaine »), `profile` (« Détecter les onglets »),
# `settings`, `canteen`, `attendance`, `sanctions`, `messages`, `pairing`,
# `alerts` et `competences` portent un titre de section ou un bouton rendu HORS
# de la branche de donnée, donc ils tiennent sans donnée. `news` et `fiches` ont
# un titre de barre du haut unique, ce qui suffit (cf. le test de condition).
#
# UN SEUL ÉTAT RESTE SANS TÉMOIN : la BRANCHE ERREUR de l'onglet Notes, où
# `GradesBlankState` rend `PapErrorState` — le message vient de la couche data et
# son seul libellé fixe est « Réessayer », que SEPT autres écrans rendent aussi
# (Actualités, Cantine, Vie scolaire, Sanctions, Messages, Alertes sécurité,
# Fiches révision). Le mettre ici transformerait une dérive de navigation vers
# l'un d'eux en faux vert : titre « Notes » vu dans la barre d'onglets +
# « Réessayer » vu dans le corps = succès trompeur. On préfère un témoin en
# moins à une capture qui prouve autre chose que ce qu'on demande. Le message
# d'échec nomme donc l'état sans donnée au lieu d'accuser la navigation.
#
# Correspondance par FRAGMENT (`grep -F`) : un nœud Compose porte la phrase
# entière (« Prochain cours · Maths · 08:00 »), pas le mot isolé.
#
# Une refonte ne peut plus casser la vérification en silence : quand le témoin
# manque, le message nomme CETTE table (fichier + ligne) et dit où changer le
# titre. Le libellé d'onglet reste EXCLU comme témoin : voir plus haut.
ROUTE_WITNESSES='
index|Accueil|Afficher plus;Rien à afficher
calendar|EDT|semaine du
grades|Notes|Moyennes par matière;Aucune note en cache;Aucune note sur cette période;Aucune note trouvée
tasks|Tâches|Devoirs de la semaine
profile|Profil|Détecter les onglets
settings|Réglages|Assistant devoirs
news|Actualités|
canteen|Cantine|Menus de la semaine
attendance|Vie scolaire|Absences et retards
sanctions|Sanctions|Punitions vie scolaire
messages|Messages|Discussions
pairing|Appairage|Retour
alerts|Alertes sécurité|Injections neutralisées
fiches|Fiches révision|
competences|Compétences|Évaluations par compétences
'

# Ligne de la table d'une route. Vide = route inconnue (donc absente des 15).
witness_row() {
    printf '%s\n' "$ROUTE_WITNESSES" | grep -E "^$1[|]" | head -1 || true
}

# Titre de barre du haut attendu pour la route, "" si elle est inconnue.
route_title() {
    witness_row "$1" | cut -d'|' -f2
}

# Fragments alternatifs propres à la route, un par ligne. Vide = le titre suffit.
route_fragments() {
    local row
    row=$(witness_row "$1")
    [ -n "$row" ] || return 0
    printf '%s' "$row" | cut -d'|' -f3- | tr ';' '\n' | sed '/^$/d'
}

# Une route est connue si elle a un titre : c'est aussi la LISTE BLANCHE (une
# route inconnue est refusée avant toute écriture, jamais capturée au hasard).
route_known() {
    [ -n "$(route_title "$1")" ]
}

# Ligne DU FICHIEL où vit le marqueur : le message d'échec la nomme, donc on ne
# laisse pas deviner où le changer.
witness_line() {
    grep -n -E "^$1[|]" "$RUNTIME_DIR/shot.sh" | head -1 | cut -d: -f1 || true
}

# Le bouton que seul l'écran Profil affiche (ProfileRoute). TIRÉ DE LA TABLE,
# pas réécrit : garde-fou de dérive, pas une deuxième source. Ce profil propose
# en BOUTON les mêmes libellés que les écrans Actualités / Cantine / Vie
# scolaire / Fiches, donc un deep link qui dériverait vers le profil ferait
# passer leurs titres pour rien.
PROFILE_MARKER=$(route_fragments profile | head -1 || true)

cleanup() {
    [ -n "$RAW" ] && rm -f "$RAW"
    return 0
}
trap cleanup EXIT

# Titre de barre du haut + fragment propre à l'écran : c'est ce qui distingue
# un écran d'un autre (voir `ROUTE_WITNESSES` plus haut). Les libellés d'onglets
# ("Notes", "Profil"…) sont EXCLUS comme témoins : la barre d'onglets les affiche
# sur TOUTES les routes, donc ils ne prouvent rien — d'où le fragment des cinq
# routes d'onglets.
verify_route() {
    local texts title fragments fragment title_seen candidate
    texts=$(screen_texts)
    if [ -z "$texts" ]; then
        printf 'shot : AVERTISSEMENT — arborescence illisible (uiautomator a échoué) :\n' >&2
        printf "  route %s NON VÉRIFIÉE. Vérifiez la capture à l'œil.\n" "$ROUTE" >&2
        return 0
    fi
    if is_locked "$texts"; then
        printf "shot : téléphone VERROUILLÉ — la capture montre l'écran de déverrouillage,\n" >&2
        printf "  pas la route « %s ». Saisissez le code sur l'appareil, puis relancez.\n" "$ROUTE" >&2
        printf '  Capture conservée (preuve) : %s\n' "$OUT_PNG" >&2
        exit 1
    fi
    # Deux dérives à énoncer PAR LEUR NOM, pas par une absence de marqueur :
    # l'appairage (credential refusée ou session absente : AppNav y renvoie,
    # #113) et le profil (destination de repli après un bouton « Appairage »).
    if [ "$ROUTE" != "pairing" ] && is_pairing "$texts"; then
        printf "shot : ARRIVÉ sur l'écran d'APPAIRAGE au lieu de « %s ».\n" "$ROUTE" >&2
        printf "  Le deep link « %s://%s » a bien été envoyé ; l'app a dévié\n" "$SCHEME" "$ROUTE" >&2
        printf "  (credential refusée → renvoi vers l'appairage, ou session absente :\n" >&2
        printf "  l'appareil n'est pas appairé, donc les onglets sont inaccessibles.\n" >&2
        printf '  Capture conservée (preuve) : %s\n' "$OUT_PNG" >&2
        exit 1
    fi
    if [ "$ROUTE" != "profile" ] && printf '%s' "$texts" | grep -qF "$PROFILE_MARKER"; then
        printf "shot : ARRIVÉ sur l'écran PROFIL au lieu de « %s ».\n" "$ROUTE" >&2
        printf '  Capture conservée (preuve) : %s\n' "$OUT_PNG" >&2
        exit 1
    fi
    title=$(route_title "$ROUTE")
    if [ -z "$title" ]; then
        printf "shot : route « %s » inconnue — capture prise SANS vérification d'écran.\n" "$ROUTE" >&2
        return 0
    fi
    # Le titre : le libellé du contrat de navigation, présent sur la route comme
    # sur aucune autre. Le fragment : seulement quand le titre ne suffit pas.
    title_seen=absent
    if printf '%s' "$texts" | grep -qF "$title"; then title_seen=présent; fi
    fragment=""
    fragments=$(route_fragments "$ROUTE")
    if [ -n "$fragments" ]; then
        while IFS= read -r candidate; do
            if printf '%s' "$texts" | grep -qF "$candidate"; then
                fragment="$candidate"
                break
            fi
        done <<EOF
$fragments
EOF
    fi
    if [ "$title_seen" = présent ] && { [ -z "$fragments" ] || [ -n "$fragment" ]; }; then
        if [ -n "$fragment" ]; then
            printf 'shot : route vérifiée (« %s » + « %s »).\n' "$title" "$fragment"
        else
            printf 'shot : route vérifiée (« %s »).\n' "$title"
        fi
        return 0
    fi
    # #160 : l'écran peut être PARFAIT, c'est le témoin qui a péri — l'annoncer
    # « pas atteinte » envoyait chercher une panne de navigation qui n'existait
    # pas. On dit ce qui manque, et OÙ le changer.
    printf "shot : route « %s » NON PROUVÉE — le témoin de l'écran a changé.\n" "$ROUTE" >&2
    printf "  Titre attendu « %s » : %s.\n" "$title" "$title_seen" >&2
    if [ -n "$fragments" ]; then
        printf "  Fragment(s) attendu(s) « %s » : %s.\n" \
            "$(printf '%s' "$fragments" | tr '\n' '|')" \
            "$([ -n "$fragment" ] && echo présent || echo ABSENT)" >&2
        # #166 : titre présent + aucun fragment = l'écran est presque toujours
        # dans un état SANS DONNÉE (cache vide, échec réseau), pas un écran
        # refait. On le dit, sinon on envoie chercher une panne de navigation
        # inexistante — et on rappelle que la liste doit porter une variante par
        # état.
        if [ "$title_seen" = présent ]; then
            printf "  Le titre est là, le fragment non : l'écran est sans DONNÉE (cache\n" >&2
            printf "  vide, échec réseau, établissement qui ne publie rien) — donc soit son\n" >&2
            printf "  texte a été refait, soit la liste n'a plus de variante pour cet\n" >&2
            printf "  état. Cf. ROUTE_WITNESSES, où chaque état a sa variante.\n" >&2
        fi
    fi
    printf "  L'écran est peut-être CORRECT : son texte a été refait.\n" >&2
    printf "  Marqueur : agents/runtime/shot.sh:%s (table ROUTE_WITNESSES) ;\n" "$(witness_line "$ROUTE")" >&2
    printf "  le titre se change dans AppShell.kt (TOP_BARS), le fragment dans l'écran.\n" >&2
    printf '  Libellés vus : %s\n' "$(printf '%s' "$texts" | head -8 | tr '\n' ' ')" >&2
    printf '  Capture conservée (preuve) : %s\n' "$OUT_PNG" >&2
    exit 1
}

main() {
    local arg
    while [ $# -gt 0 ]; do
        arg="$1"
        case "$arg" in
            --package) [ $# -ge 2 ] || die "--package sans valeur."; PKG="$2"; shift 2 ;;
            --package=*) PKG="${arg#*=}"; shift ;;
            --wait) [ $# -ge 2 ] || die "--wait sans valeur."; WAIT_SEC="$2"; shift 2 ;;
            --wait=*) WAIT_SEC="${arg#*=}"; shift ;;
            --no-build) BUILD=0; shift ;;
            -h|--help) usage; exit 0 ;;
            -*) usage >&2; die "option inconnue : $arg" ;;
            *)
                [ -z "$ROUTE" ] || { usage >&2; die "une seule route à la fois (reçu : $arg)."; }
                ROUTE="$arg"; shift ;;
        esac
    done
    [ -n "$ROUTE" ] || { usage >&2; die "route manquante (ex. : make shot ROUTE=grades)."; }
    # Route inconnue = échec AVANT toute écriture : sans témoin, une capture
    # ne prouve rien et l'app ouvrirait bêtement son écran de départ. Le message
    # sort la liste, donc le nom exact se lit sans ouvrir le script. Pour une
    # application tierce le premier argument n'est qu'un NOM DE CAPTURE.
    if [ "$PKG" = "$APP_PKG" ] && ! route_known "$ROUTE"; then
        usage >&2
        die "route inconnue : « $ROUTE ». Rien capturé."
    fi

    need_device

    # Notre app : on garantit que l'appareil fait tourner CE code, puis on
    # ouvre la route par deep link. Autre app : on ne touche à rien d'installé.
    if [ "$PKG" = "$APP_PKG" ]; then
        ensure_installed
    else
        a shell pm path "$PKG" >/dev/null 2>&1 \
            || die "shot : $PKG n'est pas installé sur l'appareil — rien capturé."
    fi

    local name
    name="$ROUTE.png"
    [ "$PKG" = "$APP_PKG" ] || name="$ROUTE.$PKG.png"
    # Le nom de capture d'une app tierce est libre (aucune liste blanche de
    # routes) : on n'accepte que des caractères de nom de fichier, sinon
    # `../../` écrireait la capture ailleurs que dans shots/.
    case "$name" in
        *[!A-Za-z0-9._-]*)
            name=$(printf '%s' "$name" | tr -c 'A-Za-z0-9._-' '_')
            printf 'shot : nom de capture simplifié en %s\n' "$name" ;;
    esac
    local out_dir="$REPO_ROOT/shots/$(date -u +%F)"
    OUT_PNG="$out_dir/$name"
    mkdir -p "$out_dir"

    launch_app
    sleep "$WAIT_SEC"

    local verdict
    capture "$OUT_PNG"
    verdict=$(blank_verdict "$OUT_PNG")
    if [ "$verdict" != "ok" ]; then
        # Écran éteint : on réveille et on réessaie UNE fois (le téléphone se
        # rendort entre deux captures, et un wakeup demande ~1 s).
        printf 'shot : %s — réveil de l''écran puis nouvelle tentative.\n' "$verdict" >&2
        a shell input keyevent KEYCODE_WAKEUP >/dev/null 2>&1 || true
        a shell wm dismiss-keyguard >/dev/null 2>&1 || true
        a shell svc power stayon true >/dev/null 2>&1 || true
        sleep 2
        capture "$OUT_PNG"
        verdict=$(blank_verdict "$OUT_PNG")
        if [ "$verdict" != "ok" ]; then
            die "shot : capture NOIRE ($verdict). l''écran est éteint, verrouillé sur un
  code, ou l'app n'a pas rendu. Aucune capture exploitable.
  Réveillez le téléphone (ou déverrouillez-le) et relancez. Fichier à supprimer :
  $OUT_PNG"
        fi
    fi

    # `if` et non `&&` : en dernière instruction de main, un `&&` dont le test
    # est faux ferait sortir le script en 1 alors que la capture est bonne.
    if [ "$PKG" = "$APP_PKG" ]; then
        verify_route
    fi

    printf '%s\n' "$OUT_PNG"
}

OUT_PNG=""
main "$@"