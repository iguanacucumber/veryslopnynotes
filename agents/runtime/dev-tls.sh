# dev-tls.sh — source depuis le Makefile, ne JAMAIS exécuté directement.
#
# UN seul endroit qui sait fournir un certificat pour `make runServer`. L'app
# Android refuse le clairtext hors émulateur
# (android/app/src/main/res/xml/network_security_config.xml), donc le serveur
# doit être en HTTPS pour qu'un téléphone puisse s'y connecter.
#
# Le matériel est écrit HORS du dépôt (~/.cache/veryslopnynotes/tls) : une clé
# privée dans l'arbre de travail finit un jour commitée, et c'est exactement ce
# que `make lint` (check-secrets) interdit. Reutilise le certificat s'il existe,
# donc la confiance accordée au téléphone survit aux redémarrages.
#
# Fonction (aucun effet de bord à part définir) :
#   dev_tls -> exporte TLS_CERT_FILE + TLS_KEY_FILE, ou échoue (exit 1)
#
# ponytail: certificat feuille auto-signé, pas d'AC locale, pas de renouvellement.
# Upgrade: mkcert (racine de confiance installable en un geste sur le téléphone),
# puis il suffira de remplacer la génération ci-dessous par `mkcert -install`.
DEV_TLS_DIR="${DEV_TLS_DIR:-${XDG_CACHE_HOME:-$HOME/.cache}/veryslopnynotes/tls}"

# Noms couverts par le SAN : ce que l'app saisit réellement — `localhost`, l'alias
# émulateur 10.0.2.2, et l'IP LAN de la machine (le téléphone voit le LAN, pas
# 127.0.0.1). Sans l'IP LAN, le certificat est rejété pour « nom inconnu ».
dev_tls_san() {
    san="DNS:localhost,DNS:veryslopnynotes.local,IP:127.0.0.1,IP:10.0.2.2"
    lan=$(ip -4 route get 1.1.1.1 2>/dev/null | sed -n 's/.* src \([0-9.]*\).*/\1/p' | head -1)
    [ -n "$lan" ] && san="$san,IP:$lan"
    printf '%s' "$san"
}

dev_tls() {
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
        # `CA:TRUE` : Android n'installe que comme CA un certificat qui le
        # declare. Sans caextension, l'ecran « Installer un certificat » le
        # refuse et l'app echoue en "Trust anchor for certification path not
        # found" — le serveur etant pourtant bien en HTTPS.
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