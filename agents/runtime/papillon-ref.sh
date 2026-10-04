#!/usr/bin/env bash
# papillon-ref.sh — frames de RÉFÉRENCE de l'application Papillon (#133).
#
#   agents/runtime/papillon-ref.sh [nom ...]   (défaut : les trois démos)
#   make papillonRef
#
# Sources : les ENREGISTREMENTS DE DÉMONSTRATION PUBLIÉS SUR papillon.bzh
# (vidéos de l'application de référence Papillon, 1180x2556). Matériel public
# de comparaison visuelle — ce n'est ni un serveur du projet, ni une adresse
# Pronote, ni une donnée d'un élève : aucune de ces URL n'est un hôte de la
# prod (invariant I1 : le téléphone ne parle qu'au serveur allowlist).
#
# Pourquoi ffmpeg ne suffit pas à une frame : les webm sont très courts et
# selon les encodages la frame à 6 s ou 20 s n'existe pas (« Output file is
# empty, nothing was encoded »). On essaie donc plusieurs positions et on
# garde la PREMIÈRE qui rend une image. Et le PNG n'est pas un encodeur de ce
# build ffmpeg (seul mjpeg l'est) : on sort du JPEG, ce qui suffit pour
# comparer des écrans à l'œil.
#
# Réseau : échec BRUYANT. Une référence non téléchargée doit se voir, sinon on
# compare l'interface overhaulée à rien. Rien ici n'est requis par `make check`.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT_DIR="$REPO_ROOT/ref-papillon"
CACHE_DIR="${XDG_CACHE_HOME:-$HOME/.cache}/veryslopnynotes/papillon-ref"
BASE_URL="https://papillon.bzh/video"

die() {
    printf '%s\n' "$@" >&2
    exit 1
}

# Positions testées par vidéo : la première qui encode gagne. Le court-métage
# évite de traverser un clip entier pour un écran.
SEEK_POSITIONS=(3 4 5 6 8 10 12 15 20 25)

fetch() {
    local name="$1"
    mkdir -p "$CACHE_DIR"
    local dest="$CACHE_DIR/$name.webm"
    if [ ! -s "$dest" ]; then
        printf 'papillon-ref : téléchargement %s …\n' "$name"
        curl --fail --silent --show-error --location --max-time 120 \
            -o "$dest.part" "$BASE_URL/$name.webm" \
            || die "papillon-ref : téléchargement ÉCHOUÉ ($BASE_URL/$name.webm).
  Aucune frame produite pour $name. Réseau ou site indisponible ?"
        mv "$dest.part" "$dest"
    fi
    printf 'papillon-ref : %s (%s octets)\n' "$name" "$(stat -c %s "$dest")"
}

# Une frame = sortie non vide ET lisible comme image. ffmpeg peut retourner 0 en
# n'écrivant rien d'utile : on vérifie le fichier, pas le code de sortie.
grab() {
    local src="$1" out="$2" pos
    for pos in "${SEEK_POSITIONS[@]}"; do
        rm -f "$out"
        ffmpeg -v error -y -ss "$pos" -i "$src" -frames:v 1 -c:v mjpeg -q:v 2 "$out" >/dev/null 2>&1 || true
        if [ -s "$out" ]; then
            printf 'papillon-ref :   frame à %ss\n' "$pos"
            return 0
        fi
    done
    return 1
}

main() {
    command -v ffmpeg >/dev/null 2>&1 || die "papillon-ref : ffmpeg absent — aucune frame extraite."
    command -v curl >/dev/null 2>&1 || die "papillon-ref : curl absent — aucune vidéo téléchargée."
    local videos=("$@")
    [ ${#videos[@]} -gt 0 ] || videos=(opti_edt opti_grades opti_custom)

    mkdir -p "$OUT_DIR"
    local name src out failed=0
    for name in "${videos[@]}"; do
        src="$CACHE_DIR/$name.webm"
        out="$OUT_DIR/$name.jpg"
        fetch "$name"
        if grab "$src" "$out"; then
            printf 'papillon-ref : %s\n' "$out"
        else
            printf 'papillon-ref : AUCUNE frame lisible dans %s.webm (positions %s).\n' \
                "$name" "${SEEK_POSITIONS[*]}" >&2
            failed=1
        fi
    done
    [ "$failed" -eq 0 ] || die "papillon-ref : une frame au moins manque — dossier $OUT_DIR INCOMPLET."
    printf 'papillon-ref : référence complète dans %s\n' "$OUT_DIR"
}

main "$@"