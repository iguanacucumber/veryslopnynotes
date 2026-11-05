import { Link } from "react-router-dom";
import { AI_VISION_RETENTION_NOTE } from "../assistant/consent";
import { Card, Page, Section } from "../../ui/components";

/** Aide statique et hors ligne : aucune lecture du pont, aucun appel réseau. */
export default function HelpScreen() {
  return (
    <Page className="help">
      <Card className="card--flat">
        <p className="help-lead">
          Cette aide est intégrée à l’app et fonctionne hors ligne. Elle décrit
          l’appairage, le réseau, la caméra, l’assistant et les gestes de dépannage.
        </p>
        <nav className="help-actions" aria-label="Raccourcis de l’aide">
          <Link className="btn btn--ghost btn--small" to="/settings">
            Ouvrir les réglages
          </Link>
          <Link className="btn btn--ghost btn--small" to="/tasks">
            Voir les tâches
          </Link>
        </nav>
      </Card>

      <Section id="aide-qr" title="Trouver le QR de l’établissement">
        <Card className="card--flat">
          <p className="help-paragraph">
            Le QR n’est pas créé par VerySlopyNyNotes. Il est affiché par
            l’application de ton établissement, sur l’écran de connexion ou dans
            les réglages du compte. Si tu ne le trouves pas, demande à la vie
            scolaire ou à la personne qui gère l’accès à l’espace scolaire.
          </p>
          <ul className="help-list">
            <li>Ouvre l’application de ton établissement, sur ce téléphone ou sur un autre appareil.</li>
            <li>Cherche l’option « Connexion par QR code » ou « Associer un appareil ».</li>
            <li>Garde cet écran affiché pendant le scan : le code peut expirer.</li>
            <li>Un QR sans adresse d’établissement est refusé : régénère-le depuis l’application.</li>
          </ul>
          <p className="help-note">
            L’app ne demande jamais de mot de passe ni d’identifiant : le QR et son
            PIN sont la seule preuve de connexion.
          </p>
        </Card>
      </Section>

      <Section id="aide-pin" title="Saisir le PIN">
        <Card className="card--flat">
          <p className="help-paragraph">
            Le PIN est celui défini dans ton compte établissement. Il déchiffre le
            QR sur place et n’est jamais enregistré.
          </p>
          <ul className="help-list">
            <li>Scanne d’abord le QR, puis saisis le PIN demandé par l’établissement.</li>
            <li>Un nouveau QR peut changer le PIN : rescane et saisis le PIN qui l’accompagne.</li>
            <li>Le PIN n’est pas enregistré : il est utilisé sur cet appareil, ni journalisé ni envoyé à un serveur du projet.</li>
            <li>La double authentification (MFA) n’est pas prise en charge : l’app le dit au lieu de bloquer sans explication.</li>
          </ul>
        </Card>
      </Section>

      <Section id="aide-reseau" title="Réseau et mode hors-ligne">
        <Card className="card--flat">
          <p className="help-paragraph">
            La première connexion et l’appairage demandent un accès réseau : le
            téléphone parle directement à l’établissement, sans serveur
            intermédiaire.
          </p>
          <ul className="help-list">
            <li>Sans réseau, les écrans déjà ouverts affichent le cache et signalent qu’il est périmé.</li>
            <li>Le bouton « Actualiser » en haut relance la lecture quand la connexion revient.</li>
            <li>Les notes, cours, devoirs et messages ne se mettent pas à jour hors-ligne.</li>
            <li>Le serveur de manuels est facultatif : son adresse se règle dans Réglages → Avancé.</li>
            <li>Aucune donnée scolaire ne passe par un serveur du projet ; la clé OpenRouter part directement chez OpenRouter.</li>
          </ul>
        </Card>
      </Section>

      <Section id="aide-rappels" title="Rappels, notifications et compte parent">
        <Card className="card--flat">
          <p className="help-paragraph">
            L’app n’envoie aucun rappel : ni notification push, ni notification
            locale pour un devoir, une note ou un cours. La synchronisation de
            fond met seulement le cache à jour ; ouvre l’écran pour voir l’état.
          </p>
          <ul className="help-list">
            <li>Un rappel demanderait une nouvelle décision et la permission Android correspondante.</li>
            <li>L’app sert un compte élève à la fois, celui du QR appairé.</li>
            <li>Les comptes parent sont hors périmètre : aucun accès parent, aucune bascule d’un enfant à l’autre.</li>
            <li>Les comptes liés publiés par l’établissement restent une lecture seule dans Profil.</li>
          </ul>
        </Card>
      </Section>

      <Section id="aide-camera" title="Caméra et scan">
        <Card className="card--flat">
          <p className="help-paragraph">
            Le scan ouvre la caméra et lit uniquement un QR de connexion. La
            permission est demandée au premier scan.
          </p>
          <ul className="help-list">
            <li>Permission refusée : Réglages Android → Applications → VerySlopyNyNotes → Autorisations → Caméra, puis rescane.</li>
            <li>QR illisible : éclaire le code, évite les reflets, tiens le téléphone droit et rapproche-toi.</li>
            <li>Annuler le scan ne garde aucun QR : tu peux recommencer quand tu veux.</li>
            <li>Pour l’aide sur une photo, tu peux aussi choisir une image de la galerie au lieu de la caméra.</li>
          </ul>
        </Card>
      </Section>

      <Section id="aide-compatibilite" title="Configuration minimale">
        <Card className="card--flat">
          <p className="help-paragraph">
            VerySlopyNyNotes demande Android 8.0 (API 26) ou plus et une WebView
            système Chromium 100 ou plus récente. La WebView est le moteur fourni
            par Android System WebView ou Chrome : elle se met à jour dans le
            Play Store.
          </p>
          <ul className="help-list">
            <li>Android 7 ou plus ancien : l’app ne s’installe pas.</li>
            <li>WebView plus ancienne que Chromium 100 : l’app affiche un écran de mise à jour au lieu de planter.</li>
            <li>Après la mise à jour, relance l’app.</li>
          </ul>
        </Card>
      </Section>

      <Section id="aide-accessibilite" title="Accessibilité">
        <Card className="card--flat">
          <p className="help-paragraph">
            La cible est WCAG 2.2 AA. Les limites connues, les versions testées
            et le contact sont décrits dans cette aide.
          </p>
          <ul className="help-list">
            <li>TalkBack n’a pas encore été vérifié sur un appareil réel.</li>
            <li>La police système à 200 % n’a pas été validée visuellement : 100 %, 125 % et 150 % restent les choix sûrs dans Réglages → Apparence.</li>
            <li>Le rendu n’est scanné que sur Chromium 156 : le minimum WebView Chromium 100 reste une exigence, pas une preuve.</li>
            <li>Pour signaler un problème, ouvre une issue GitHub : version de l’app, version d’Android et de la WebView, écran et étape, sans aucune donnée scolaire.</li>
          </ul>
        </Card>
      </Section>

      <Section id="aide-sans-ia" title="Utiliser l’app sans assistant IA">
        <Card className="card--flat">
          <p className="help-paragraph">
            L’assistant est facultatif. Sans clé OpenRouter, aucun appel n’est
            fait et le reste de l’app continue de fonctionner.
          </p>
          <ul className="help-list">
            <li>Notes, emploi du temps, devoirs, vie scolaire, messages, actualités et cantine restent disponibles.</li>
            <li>L’aide devoirs, les fiches de révision et les corrections à partir d’une photo demandent une clé.</li>
            <li>Le manuel et le serveur de manuels sont eux aussi facultatifs : ils servent seulement à citer un ouvrage.</li>
            <li>La clé peut être oubliée à tout moment dans Réglages → Assistant.</li>
          </ul>
        </Card>
      </Section>

      <Section id="aide-openrouter" title="Clé OpenRouter, coût et âge">
        <Card className="card--flat">
          <p className="help-paragraph">
            L’assistant utilise ton propre compte OpenRouter. La clé se colle dans
            Réglages → Assistant. Elle est chiffrée sur cet appareil et envoyée
            directement à OpenRouter avec chaque demande.
          </p>
          <ul className="help-list">
            <li>La clé n’est jamais envoyée à l’établissement ni à un serveur du projet.</li>
            <li>OpenRouter facture à l’usage, avec des crédits prépayés (achat minimum de 5 $ au moment de la rédaction) ; le prix dépend du modèle et des jetons envoyés. Une photo est un appel facturé comme un autre.</li>
            <li>{AI_VISION_RETENTION_NOTE}</li>
            <li>Les demandes texte suivent la politique de ton compte OpenRouter : elles peuvent être conservées ou servir à l’entraînement. L’app ne peut pas garantir leur suppression chez le fournisseur.</li>
            <li>L’app ne connaît pas ton solde et ne peut pas recharger ton compte : gère les crédits sur OpenRouter.</li>
            <li>OpenRouter exige d’avoir au moins 18 ans. Si tu es mineur, un adulte responsable doit ouvrir le compte et gérer la clé ; ne lui emprunte pas sa clé sans son accord.</li>
            <li>Garde la clé secrète : toute personne qui l’a peut consommer tes crédits. En cas de fuite, révoque-la sur OpenRouter et enregistre-en une nouvelle.</li>
          </ul>
        </Card>
      </Section>

      <Section id="aide-depannage" title="Dépannage">
        <Card className="card--flat">
          <h3 className="help-question">La session est expirée ou l’app redemande le QR</h3>
          <p className="help-paragraph">
            Rescane le QR affiché par l’établissement, puis saisis son PIN. Une
            session morte ne se répare pas avec un mot de passe.
          </p>

          <h3 className="help-question">Le QR ou le PIN est refusé</h3>
          <p className="help-paragraph">
            Régénère le QR dans l’application de l’établissement et rescane-le avec le bon PIN.
            Si le compte exige une vérification supplémentaire, l’app ne peut pas
            la contourner.
          </p>

          <h3 className="help-question">La caméra ne s’ouvre pas</h3>
          <p className="help-paragraph">
            Vérifie la permission caméra dans les réglages Android, puis relance le
            scan. Un QR illisible se règle avec plus de lumière et moins de reflets.
          </p>

          <h3 className="help-question">Les écrans ne se mettent pas à jour</h3>
          <p className="help-paragraph">
            Vérifie la connexion et touche « Actualiser ». Si le badge
            « hors-ligne », « réseau indisponible » ou « erreur de lecture »
            reste affiché, l’app montre le dernier cache connu, avec son âge,
            pas une donnée fraîche.
          </p>

          <h3 className="help-question">L’assistant reste inactif</h3>
          <p className="help-paragraph">
            Vérifie qu’une clé OpenRouter est enregistrée et qu’il reste des
            crédits sur le compte. Sans clé, l’app n’appelle aucun modèle.
          </p>

          <h3 className="help-question">Une fiche, un manuel ou une photo manque</h3>
          <p className="help-paragraph">
            Ces fonctions dépendent de l’assistant ou du serveur de manuels. Le
            reste de l’app fonctionne sans eux.
          </p>

          <h3 className="help-question">L’écran affiche une erreur</h3>
          <p className="help-paragraph">
            Recharge l’app. Si le stockage chiffré est indisponible, la session et
            la clé ne seront pas conservées : l’app l’affiche clairement.
          </p>

          <h3 className="help-question">Signaler un problème</h3>
          <p className="help-paragraph">
            Indique la version de l’app, la version d’Android, le message exact et
            ce que tu faisais. N’envoie aucune donnée scolaire : ni nom, ni URL
            d’établissement, ni note, ni capture non caviardée.
          </p>
        </Card>
      </Section>

      <Section id="aide-support" title="Support et problèmes connus">
        <Card className="card--flat">
          <p className="help-paragraph">
            GitHub Issues est le seul canal de support : aucune adresse de
            courriel n’est publiée. Les délais et les données à ne jamais
            joindre sont rappelés ci-dessous.
          </p>
          <ul className="help-list">
            <li>Avant d’ouvrir un bug, lis l’issue épinglée <code>[known-issues] vX.Y.Z</code>.</li>
            <li>Indique la version de l’app, Android, la WebView, l’écran, les étapes et le message exact, sans aucune donnée scolaire.</li>
            <li>Réglages → Aide → Exporter un diagnostic prépare un fichier local : l’aperçu montre les champs exacts, rien n’est envoyé automatiquement et tu choisis l’application dans le sélecteur Android.</li>
            <li>Une faille exploitable ou un secret exposé passe par GitHub Security Advisories, jamais par une issue publique.</li>
          </ul>
        </Card>
      </Section>
    </Page>
  );
}
