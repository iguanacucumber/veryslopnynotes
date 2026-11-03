# Compatibilité

Ce que l'app prend en charge, et ce qu'elle refuse explicitement. Une limite
non listée ici n'est pas une promesse : ouvre une issue avec la version de
l'établissement et le message affiché (sans donnée scolaire).

## Matrice

| Élément | Pris en charge | Non pris en charge |
|---|---|---|
| Appareil | Android 8.0+ (API 26), cible API 37 | iOS, desktop, navigateur seul |
| Interface | WebView système Chromium 100 ou plus récente, bundle React embarqué | moteur embarqué, WebView Chromium 99 ou plus ancienne, WebView distante |
| Connexion | QR de l'application Pronote + PIN, session ouverte en direct | identifiant / mot de passe, SSO d'ENT, double authentification (MFA) |
| Établissement | Pronote qui expose un QR de connexion et le protocole direct | portail sans QR, compte qui exige une vérification supplémentaire |
| Version Pronote | aucune version n'est épinglée : le contrat est le QR | une version qui change le QR ou impose la MFA |
| Hors-ligne | cache des ressources après une première session | appairage sans réseau |
| Scraper de manuels | facultatif, HTTPS, boucle locale ou proxy authentifié | exposition publique sans authentification |
| Assistant IA | facultatif, clé OpenRouter stockée sur l'appareil | appel sans clé, envoi de la clé à un serveur du dépôt |
| Notifications | synchronisation de fond WorkManager (environ 6 h) | push, notification temps réel |

## WebView : Chromium 100 minimum

Le minimum est **Android 8.0 (API 26)** avec une **WebView système Chromium
100** (mars 2022). Le seuil reste atteignable sur Android 8 par le Play Store et
couvre le bundle React (ES2018 et CSS utilisés). Une WebView plus ancienne n'est
pas une promesse de rendu dégradé : elle est refusée explicitement.

Au démarrage, l'app lit la version du paquet WebView installé. Si la majeure est
absente, illisible ou inférieure à 100, elle affiche un écran natif qui nomme le
minimum, la version détectée et l'action (mettre à jour Android System WebView
ou Chrome, puis relancer) : aucune WebView n'est chargée et l'app ne plante pas.
La même phrase est visible dans **Aide → Configuration minimale**. La décision
vit dans un fichier Kotlin pur (`android/app/WebViewSupport.kt`), testé par
`tests/unit/android-webview-support.test.ts` et par la compilation Android.

## Connexion : QR uniquement

Le QR affiché par l'application de l'établissement porte l'adresse, le login
et le jeton ; le PIN le déchiffre en mémoire. L'app ne demande **jamais** de
mot de passe et ne propose aucun repli par identifiant. Un compte protégé par
une double authentification échoue avec le message « vérification
supplémentaire que l'app ne prend pas en charge » : ce n'est pas un bug de
saisie, il n'existe pas de contournement dans l'app.

## Versions de Pronote

Aucune plage de versions n'est certifiée. Le client suit le protocole
[`pronotets`](https://www.npmjs.com/package/pronotets) (MIT) et s'appuie sur le
QR comme contrat stable ; une mise à jour côté établissement peut donc casser
l'appairage ou une ressource. La démonstration publique et les établissements
appairés par QR servent de référence ; les versions réellement testées ne sont
pas publiées pour éviter d'exposer une configuration d'établissement.

## Facultatif

Le serveur du dépôt ne sert qu'au scraper de manuels : ni Pronote, ni
l'assistant n'en dépendent. Sans clé OpenRouter, l'assistant reste inactif et
aucun appel n'est fait. Le reste de l'app fonctionne avec le seul accès direct
à l'établissement.

## Accessibilité : taille du texte

Réglages → Apparence → « Taille du texte » propose 100 %, 125 % et 150 % ;
« Système » (défaut) suit le réglage Android. Le choix est enregistré dans les
préférences de l'appareil et appliqué par la WebView (`textZoom`) au chargement
et au changement.

Vérification appareil (obligatoire avant de livrer un changement d'interface) :

1. Android → Paramètres → Affichage → Taille de la police : **200 %**, puis
   relancer l'app.
2. Parcourir l'accueil, les notes, les devoirs, les messages, le profil et les
   réglages : aucun libellé coupé, aucun chevauchement, pas de défilement
   horizontal ; le dock et la barre du haut restent lisibles.
3. Choisir successivement 100 %, 125 %, 150 %, puis « Système » : le texte
   change sans redémarrage et le choix survit à une fermeture/réouverture.
4. Revenir à la taille Android normale.

## Signaler une incompatibilité

Ouvre une issue « bug » avec : version de l'app, version d'Android et de la
WebView, version de Pronote si l'écran l'affiche, et message exact. **Aucune**
donnée scolaire : pas de nom, d'URL d'établissement, de note, de message ni de
capture non caviardée.
