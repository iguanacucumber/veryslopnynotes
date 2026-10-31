# dev-tls.sh — source depuis le Makefile, jamais exécuté directement.
#
# Fournit un certificat pour `make runServer` : l'app Android refuse le clairtext
# hors émulateur, donc le serveur doit être en HTTPS.
#
# Matériel écrit HORS du dépôt (~/.cache/veryslopnynotes/tls) : une clé privée
# dans l'arbre finit un jour commitée, ce que `make lint` interdit. Réutilisée,
# donc la confiance accordée au téléphone survit aux redémarrages.
#
# dev_tls -> exporte TLS_CERT_FILE + TLS_KEY_FILE, ou échoue (exit 1).
# ponytail: certificat feuille auto-signé, pas d'AC locale, pas de renouvellement.
# Upgrade: mkcert (racine de confiance installable en un geste sur le téléphone).
DEV_TLS_DIR="${DEV_TLS_DIR:-${XDG_CACHE_HOME:-$HOME/.cache}/veryslopnynotes/tls}"

# SAN = ce que l'app saisit : `localhost`, l'alias émulateur 10.0.2.2 et l'IP LAN
# (le téléphone voit le LAN, pas 127.0.0.1). Sans l'IP LAN : « nom inconnu ».
dev_tls_san() {
    san="DNS:localhost,DNS:veryslopnynotes.local,IP:127.0.0.1,IP:10.0.2.2"
    lan=$(ip -4 route get 1.1.1.1 2>/dev/null | sed -n 's/.* src \([0-9.]*\).*/\1/p' | head -1)
    [ -n "$lan" ] && san="$san,IP:$lan"
    printf '%s' "$san"
}

dev_tls() {
    # Un couple fourni par l'opérateur est RESPECTÉ TEL QUEL : écraser
    # TLS_CERT_FILE/TLS_KEY_FILE avec notre auto-signé donnerait « Trust anchor
    # not found » côté téléphone.
    if [ -n "${TLS_CERT_FILE:-}" ] || [ -n "${TLS_KEY_FILE:-}" ]; then
        if [ -z "${TLS_CERT_FILE:-}" ] || [ -z "${TLS_KEY_FILE:-}" ]; then
            echo "runServer : TLS_CERT_FILE et TLS_KEY_FILE doivent etre definis ensemble." >&2
            exit 1
        fi
        for f in "$TLS_CERT_FILE" "$TLS_KEY_FILE"; do
            if [ ! -f "$f" ] || [ ! -r "$f" ]; then
                echo "runServer : $f absent ou illisible — couple TLS fourni REFUSE (pas de repli auto-signe)." >&2
                exit 1
            fi
        done
        export TLS_CERT_FILE TLS_KEY_FILE
        return 0
    fi
    if ! command -v openssl >/dev/null 2>&1; then
        cat >&2 <<'HINT'
runServer : openssl absent, donc PAS de HTTPS.

  L'app Android refuse le clairtext hors emulateur : sans openssl le serveur ne
  sera pas joignable depuis un telephone.
  Installez openssl, ou fournissez TLS_CERT_FILE + TLS_KEY_FILE vous-meme.
HINT
        exit 1
    fi
    if [ ! -s "$DEV_TLS_DIR/key.pem" ] || [ ! -s "$DEV_TLS_DIR/cert.pem" ]; then
        mkdir -p "$DEV_TLS_DIR" || exit 1
        chmod 700 "$DEV_TLS_DIR"
        # `CA:TRUE` : Android n'installe comme CA qu'un certificat qui le
        # déclare, sinon « Trust anchor for certification path not found ».
        openssl req -x509 -newkey rsa:2048 -nodes \
            -keyout "$DEV_TLS_DIR/key.pem" -out "$DEV_TLS_DIR/cert.pem" \
            -days 365 -subj "/CN=veryslopnynotes.local" \
            -addext "basicConstraints=critical,CA:TRUE,pathlen:0" \
            -addext "keyUsage=critical,digitalSignature,keyCertSign" \
            -addext "subjectAltName=$(dev_tls_san)" >/dev/null 2>&1 || {
            echo "runServer : generation du certificat impossible (openssl a echoue)." >&2
            exit 1
        }
        chmod 600 "$DEV_TLS_DIR/key.pem"
        cat <<EOF
runServer : certificat auto-signe cree -> $DEV_TLS_DIR/cert.pem

  L'app debug n'a PAS encore la chaine de confiance (« Trust anchor for
  certification path not found »). Installez ce certificat sur l'appareil :
    - emulateur : adb push $DEV_TLS_DIR/cert.pem /sdcard/vsn.crt
                  adb shell am start -a android.credentials.INSTALL -t application/x-x509-ca-cert -d file:///sdcard/vsn.crt
    - telephone  : Parametres > Securite > Chiffrement et identifiants >
                   Installer un certificat > Certificat CA, choisir ce .crt
  Seul l'APK DEBUG fait confiance aux CA installees par l'utilisateur ; en
  release, fournissez un certificat emis (TLS_CERT_FILE/TLS_KEY_FILE).
EOF
    fi
    export TLS_CERT_FILE="$DEV_TLS_DIR/cert.pem"
    export TLS_KEY_FILE="$DEV_TLS_DIR/key.pem"
}