#!/usr/bin/env bash
# shot.sh — capture d'écran d'un écran de l'app, sans taper au doigt.
#
#   agents/runtime/shot.sh <route> [--wait <secondes>] [--theme <t>] [--no-build]
#   make shot ROUTE=grades SHOT_ARGS="--theme dark"
#
# Deep links `veryslopnynotes://<route>` (source set debug) au lieu de
# `input tap X Y` : des coordonnées dépendent de l'écran et échouent en silence
# (la capture montre l'onglet d'à côté).
# Contrat : échec BRUYANT, jamais de succès silencieux — une capture non
# contrôlée ne vaut rien, on ne la relit pas dans un diff.
# android-env.sh est SOURCÉ, jamais réécrit : il connaît la borne JDK 17-21.
set -euo pipefail

RUNTIME_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$RUNTIME_DIR/../.." && pwd)"
ANDROID_DIR="$REPO_ROOT/android"
APK="$ANDROID_DIR/app/build/outputs/apk/debug/app-debug.apk"

APP_PKG="fr.veryslopnynotes.app"
SCHEME="veryslopnynotes"
# uiautomator écrit son dump là, puis on le relit et on l'efface : un XML de
# l'app sur /sdcard serait du résidu de session.
REMOTE_UI_XML="/sdcard/vsn-shot-ui.xml"

ROUTE=""
WAIT_SEC=3
THEME=""
SERIAL=""
RAW=""
BUILD=1

die() {
    printf '%s\n' "$@" >&2
    exit 1
}

usage() {
    cat <<'USAGE'
usage : shot.sh <route> [--theme <t>] [--wait <secondes>] [--no-build]

  <route>               route de l'app : index, calendar, grades, tasks,
                        profile, settings, news, canteen, attendance,
                        messages, pairing, alerts, revision-sheets,
                        course-notes, prof, sanctions.
  --theme <dark|light|system>
                        force le thème de l'APPAREIL avant la capture (#179) :
                        le pas d'encre de matière est sensible au thème, donc
                        une capture en clair ne prouve rien du sombre. La
                        bascule passe par « cmd uimode night » (l'état du
                        système), donc rien n'entre dans les données de l'app.
                        Le nom du fichier porte le thème (tasks.dark.png).
  --wait <secondes>     délai après lancement avant la capture (défaut 3).
  --no-build            PAS de construction Gradle : recapture rapide du
                        MÊME APK, qui peut être plus vieux que les sources
                        (le script le dit, bruyamment). Réservé à la
                        re-capture d'une capture ratée, jamais au contrôle
                        d'une modification de l'interface.
USAGE
}

# Deux téléphones branchés : `-s` lève l'ambiguïté.
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

# Vide si absent/illisible.
apk_sha256() {
    [ -f "$APK" ] || return 0
    sha256sum "$APK" 2>/dev/null | cut -d' ' -f1
}

# Gradle est l'autorité de la fraîcheur (il incrémentalise : ~1 s à vide) :
# comparer des mtimes a déjà rendu un faux vert. `--no-build` est le SEUL
# renoncement, et il parle.
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
    # android-env.sh tolère les variables absentes, pas `set -u` : d'où les
    # défauts vides.
    export ANDROID_JDK_HOME="${ANDROID_JDK_HOME:-}" JAVA_HOME="${JAVA_HOME:-}"
    export ANDROID_HOME="${ANDROID_HOME:-}" ANDROID_SDK_ROOT="${ANDROID_SDK_ROOT:-}"
    # `export` et non préfixe `VAR=x . script` : le préfixe ne survit pas à un
    # appel d'`android_sdk` après le source (« unbound variable »).
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

# Contenu, jamais mtime : deux horloges se mentent. `base.apk` est le fichier
# même qu'`adb install` a écrit.
installed_apk_sha256() {
    local path hash
    path=$(a shell dumpsys package "$APP_PKG" | sed -n 's/.*codePath=\(.*\)/\1/p' | head -1 | tr -d '\r')
    [ -n "$path" ] || return 0
    hash=$(a shell sha256sum "$path/base.apk" 2>/dev/null | tr -d '\r' | awk 'NR==1 { print $1 }') || hash=""
    printf '%s' "$hash"
}

# Jamais `adb uninstall` : cela effacerait la session appairée (QR à rescaner).
# On échoue et on laisse l'utilisateur trancher.
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
    # Empreinte illisible ou différente = installation.
    printf "shot : installation de l'APK debug (local %s, appareil %s) …\n" \
        "$(printf '%s' "${local_sha:-?}" | cut -c1-12)" "$(printf '%s' "${remote_sha:-inconnu}" | cut -c1-12)"
    local out
    if ! out=$(a install -r "$APK" 2>&1); then
        printf '%s\n' "$out" >&2
        die "shot : installation refusée (signature différente ?). Je ne désinstalle PAS tout
  seul : « adb uninstall » effacerait la session appairée (QR à rescaner)."
    fi
    printf '%s\n' "$out" | sed 's/^/shot : /'
    # L'installation est un fait : on la relit sur l'appareil.
    remote_sha=$(installed_apk_sha256)
    if [ -n "$remote_sha" ] && [ "$remote_sha" != "$local_sha" ]; then
        die "shot : l'appareil fait tourner une AUTRE empreinte (${remote_sha:0:12} contre
  ${local_sha:0:12}). Capture NON faite : elle montrerait une autre interface."
    fi
    # Empreinte illisible = vérification impossible, pas fausse : on continue
    # en le disant.
    [ -n "$remote_sha" ] || printf "shot : empreinte de l'APK installed ILLISIBLE sur cet appareil (pas de sha256sum) : installation non vérifiée.\n" >&2
}

launch_app() {
    local out
    # Arrêt forcé AVANT le lancement : un deep link n'est traité qu'à la
    # CONSTRUCTION du NavController, donc sur une activité vivante le
    # `onNewIntent` serait ignoré (capture de l'écran précédent). Ne touche
    # aucune donnée de l'app.
    a shell am force-stop "$APP_PKG" >/dev/null 2>&1 || true
    sleep 1
    out=$(a shell am start -W -a android.intent.action.VIEW \
        -c android.intent.category.BROWSABLE -d "$SCHEME://$ROUTE" 2>&1 | tr -d '\r') || true
    if printf '%s' "$out" | grep -q "Error"; then
        printf '%s\n' "$out" >&2
        die "shot : lancement refusé — écran non atteint, rien capturé."
    fi
}

# Thème posé sur l'APPAREIL (`cmd uimode night`) : `AppTheme.SYSTEM` suit, et
# aucune donnée de l'app n'est touchée.
force_theme() {
    [ -n "$THEME" ] || return 0
    local mode
    case "$THEME" in
        dark) mode=yes ;;
        light) mode=no ;;
        system) mode=auto ;;
        *) usage >&2; die "--theme hors valeur : « $THEME » (dark, light ou system). Rien capturé." ;;
    esac
    a shell cmd uimode night "$mode" >/dev/null 2>&1 \
        || die "shot : « cmd uimode night $mode » refusé par l'appareil — thème NON
  forcé, donc capture NON faite : elle montrerait le thème courant."
    printf "shot : thème de l'appareil forcé sur « %s » (night %s).\n" "$THEME" "$mode"
}

screen_size() {
    a shell wm size | sed -n 's/.*size: \([0-9][0-9]*x[0-9][0-9]*\).*/\1/p' | tail -1
}

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

# Image uniformément noire/blanche = écran éteint : `screencap` ne rend rien de
# l'app et la capture passerait pour une capture. Aucun outil disponible =
# échec, jamais un « ça doit être bon ».
# Le chemin passe par l'ENVIRONNEMENT, pas par argv : selon le runtime, `-e`
# avale ou non l'argument suivant.
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
        # Ce build de ffmpeg ne décode pas le PNG : on analyse le tampon BRUT.
        raw_frame
        out=$(ffmpeg -v error -f rawvideo -pix_fmt rgba -s "$(screen_size)" -i "$RAW" \
            -vf "signalstats,metadata=mode=print:file=-" -f null - 2>/dev/null \
            | sed -n 's/^lavfi\.signalstats\.\(YMIN\|YMAX\|YAVG\)=\(.*\)$/\1 \2/p') || true
        if [ -n "$out" ]; then
            local ymin ymax yavg
            ymin=$(printf '%s' "$out" | sed -n 's/^YMIN //p')
            ymax=$(printf '%s' "$out" | sed -n 's/^YMAX //p')
            yavg=$(printf '%s' "$out" | sed -n 's/^YAVG //p')
            # Sans les deux bornes : « YMIN=YMAX= » ferait croire à une image
            # uniforme (faux écran noir).
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

# Libellés réellement à l'écran (`uiautomator dump` voit l'arbre WebView). Le
# premier dump après démarrage ne contient souvent que le nœud `WebView` : on
# retente. Arbre illisible après les essais = ÉCHEC (code ≠ 0), jamais un succès
# muet : un dump non lu ne prouve aucune route.
screen_texts() {
    local attempt xml texts
    for attempt in 1 2 3 4 5 6; do
        a shell uiautomator dump "$REMOTE_UI_XML" >/dev/null 2>&1 || {
            sleep 1
            continue
        }
        xml=$(a shell cat "$REMOTE_UI_XML" 2>/dev/null | tr -d '\r') || xml=""
        a shell rm -f "$REMOTE_UI_XML" >/dev/null 2>&1 || true
        texts=$(printf '%s' "$xml" | tr '>' '\n' | sed -n 's/.*text="\([^"]*\)".*/\1/p' | sed '/^$/d')
        if [ -n "$texts" ]; then
            printf '%s\n' "$texts"
            return 0
        fi
        sleep 1
    done
    printf "shot : ÉCHEC — arborescence d'interface ILLISIBLE (6 tentatives de « uiautomator dump » sans texte).\n" >&2
    printf "  L'écran n'a pas pu être lu (écran éteint, instrumentation active, uiautomator cassé).\n" >&2
    return 1
}

# Écran d'appairage : une seule page (QR + PIN). Ces deux libellés sont stables.
is_pairing() {
    printf '%s' "$1" | grep -qiE "qr de l'application|code pin du qr"
}

# Appareil verrouillé : la capture ne montre que le clavier du code. « Code PIN »
# est EXCLU du motif — l'appairage affiche « Code PIN du QR ».
is_locked() {
    # Insensible à la casse : le verrouillage suit la LANGUE du téléphone.
    printf '%s' "$1" | grep -qiE 'enter pin|enter password|enter pattern|swipe up to unlock|déverrouill|vérification biométrique'
}

# Textes à l'écran, écrits UN SEUL endroit.
# Format : `route|titre|fragment`, `;` entre fragments alternatifs. Le titre seul
# ne prouve rien (les onglets le répètent sur toutes les routes) : `verify_route`
# cherche AUSSI un fragment propre à l'écran, un par ÉTAT — plein et sans donnée
# (cache vide, échec réseau). Règle vérifiée par
# `tests/unit/shot-harness.test.ts` ; un écran sans ligne fixe dans sa branche
# d'erreur n'est pas prouvable.
# Libellés sans apostrophe : la table est une chaîne entre apostrophes simples.
# Correspondance par FRAGMENT (`grep -F`) : un nœud porte la phrase entière.
ROUTE_WITNESSES='
index|Accueil|DEVOIRS;Accès rapides;Bonsoir;Bonjour;Bonne nuit
calendar|Cours|Semaine du;PROCHAIN COURS;Aucun cours
grades|Notes|Matières;Aucune note sur cette période;Aucune moyenne sur cette période
tasks|Tâches|Devoirs;Aucun devoir
profile|Profil|Se déconnecter;Compte;Ressources
settings|Réglages|Apparence;Serveur;Sécurité
news|Actualités|Dernières actualités en cache;Autres actualités;Aucune actualité;Aucune donnée en cache
canteen|Cantine|Menus de la semaine;Aucun menu publié cette semaine
attendance|Vie scolaire|Absences et retards;Heures manquées;Aucune absence ni retard;Aucune donnée en cache
sanctions|Sanctions|Sanctions déclarées;Aucune sanction publiée
messages|Messagerie|Rechercher une discussion;discussion;Aucune discussion
pairing|Connecte ton établissement|Retour;Code PIN du QR
alerts|Alertes|Contenus hostiles;Aucune alerte de sécurité
revision-sheets|Fiches de révision|Fiches disponibles;Aucune fiche
fiches|Fiches de révision|Fiches disponibles;Aucune fiche
course-notes|Cahier de cours|Cahier de cours;Ajouter un cours;Aucun cours enregistré
cahier|Cahier de cours|Cahier de cours;Ajouter un cours;Aucun cours enregistré
prof|Prof|Ton professeur IA;Pose ta première question;Conversation
'

# Ligne de la table d'une route. Vide = route inconnue.
# Route comparée LITTÉRALEMENT au premier champ, jamais en regex : `.*` en
# `grep -E` acceptait une route inconnue et « vérifiait » l'accueil.
witness_row() {
    local route="$1" line
    while IFS= read -r line; do
        [ "${line%%|*}" = "$route" ] || continue
        printf '%s\n' "$line"
        break
    done <<< "$ROUTE_WITNESSES"
    return 0
}

# "" si route inconnue.
route_title() {
    witness_row "$1" | cut -d'|' -f2
}

route_fragments() {
    local row
    row=$(witness_row "$1")
    [ -n "$row" ] || return 0
    printf '%s' "$row" | cut -d'|' -f3- | tr ';' '\n' | sed '/^$/d'
}

# Aussi la LISTE BLANCHE : une route inconnue est refusée avant toute écriture.
route_known() {
    [ -n "$(route_title "$1")" ]
}

# Ligne de ce fichier, citée dans le message d'échec : on ne laisse pas deviner.
witness_line() {
    local route="$1" n=0 line
    while IFS= read -r line; do
        n=$((n + 1))
        [ "${line%%|*}" = "$route" ] || continue
        printf '%s\n' "$n"
        break
    done < "$RUNTIME_DIR/shot.sh"
    return 0
}

# Tiré de la table, pas réécrit : garde-fou de dérive, pas une deuxième source.
PROFILE_MARKER=$(route_fragments profile | head -1 || true)

cleanup() {
    [ -n "$RAW" ] && rm -f "$RAW"
    return 0
}
trap cleanup EXIT

verify_route() {
    local texts title fragments fragment title_seen candidate
    local dump=0
    # `|| dump=$?` : sinon `set -e` tuerait le script sans nommer la lecture
    # ratée — c'est ici qu'elle est nommée, puis rendue fatale.
    texts=$(screen_texts) || dump=$?
    if [ "$dump" -ne 0 ] || [ -z "$texts" ]; then
        printf 'shot : ÉCHEC — arborescence illisible (uiautomator a échoué) :\n' >&2
        printf "  route %s NON VÉRIFIÉE. Aucun témoin n'a pu être lu : la capture ne PROUVE rien.\n" "$ROUTE" >&2
        printf '  Capture conservée (preuve partielle) : %s\n' "$OUT_PNG" >&2
        exit 1
    fi
    if is_locked "$texts"; then
        printf "shot : téléphone VERROUILLÉ — la capture montre l'écran de déverrouillage,\n" >&2
        printf "  pas la route « %s ». Saisissez le code sur l'appareil, puis relancez.\n" "$ROUTE" >&2
        printf '  Capture conservée (preuve) : %s\n' "$OUT_PNG" >&2
        exit 1
    fi
    # Dérives nommées par leur nom : l'appairage (credential refusée ou session
    # absente) et le profil (destination de repli), pas une absence de témoin.
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
    # Le titre : le libellé du contrat de navigation. Le fragment : seulement
    # quand le titre ne suffit pas.
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
    # L'écran peut être PARFAIT et le témoin mort : dire ce qui manque et où le
    # changer, sinon on envoie chercher une panne de navigation inexistante.
    printf "shot : route « %s » NON PROUVÉE — le témoin de l'écran a changé.\n" "$ROUTE" >&2
    printf "  Titre attendu « %s » : %s.\n" "$title" "$title_seen" >&2
    if [ -n "$fragments" ]; then
        printf "  Fragment(s) attendu(s) « %s » : %s.\n" \
            "$(printf '%s' "$fragments" | tr '\n' '|')" \
            "$([ -n "$fragment" ] && echo présent || echo ABSENT)" >&2
        # Titre présent + aucun fragment = état SANS DONNÉE, presque toujours,
        # pas un écran refait.
        if [ "$title_seen" = présent ]; then
            printf "  Le titre est là, le fragment non : l'écran est sans DONNÉE (cache\n" >&2
            printf "  vide, échec réseau, établissement qui ne publie rien) — donc soit son\n" >&2
            printf "  texte a été refait, soit la liste n'a plus de variante pour cet\n" >&2
            printf "  état. Cf. ROUTE_WITNESSES, où chaque état a sa variante.\n" >&2
        fi
    fi
    printf "  L'écran est peut-être CORRECT : son texte a été refait.\n" >&2
    printf "  Marqueur : agents/runtime/shot.sh:%s (table ROUTE_WITNESSES) ;\n" "$(witness_line "$ROUTE")" >&2
    printf "  le titre se change dans web/src/ui/AppShell.tsx (ROUTE_META), le fragment dans l'écran.\n" >&2
    printf '  Libellés vus : %s\n' "$(printf '%s' "$texts" | head -8 | tr '\n' ' ')" >&2
    printf '  Capture conservée (preuve) : %s\n' "$OUT_PNG" >&2
    exit 1
}

main() {
    local arg
    while [ $# -gt 0 ]; do
        arg="$1"
        case "$arg" in
            --theme) [ $# -ge 2 ] || die "--theme sans valeur."; THEME="$2"; shift 2 ;;
            --theme=*) THEME="${arg#*=}"; shift ;;
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
    # Route inconnue = échec AVANT toute écriture ; le message sort la liste.
    if ! route_known "$ROUTE"; then
        usage >&2
        die "route inconnue : « $ROUTE ». Rien capturé."
    fi

    need_device

    ensure_installed

    # Avant le dossier de capture : un thème refusé ne laisse pas un
    # `shots/<date>/` vide.
    force_theme

    local name
    name="$ROUTE.png"
    # Sans le thème dans le nom, une capture sombre écraserait la claire du même
    # jour : la comparaison des deux deviendrait impossible.
    [ -z "$THEME" ] || name="${name%.png}.$THEME.png"
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
        # rendort entre deux captures).
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
    # est faux sortirait en 1 alors que la capture est bonne.
    verify_route

    printf '%s\n' "$OUT_PNG"
}

OUT_PNG=""
main "$@"
