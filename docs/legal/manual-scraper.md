# Scraper de manuels — attribution, robots et conditions d'utilisation

Statut : **revue juridique requise avant toute release publique**. Ce document
décrit le comportement constaté du scraper ; il ne vaut pas avis juridique.

## Ce que fait le scraper

- L'utilisateur saisit lui-même l'adresse du manuel. Aucune adresse d'éditeur
  n'est préremplie et le scraper ne découvre ni ne parcourt de site.
- Il charge la page demandée et ses sous-ressources pour en extraire le texte,
  sans authentification. Une page de connexion est refusée, jamais ingérée.
- Seuls les hôtes publics sont visités (garde SSRF). Une adresse privée, une
  chaîne de redirections douteuse ou un nom qui résout vers une IP interne est
  refusé.
- **robots.txt n'est pas consulté aujourd'hui.** C'est un écart connu : avant
  une release publique, la revue juridique doit confirmer les conditions du
  site cible ou imposer un contrôle `robots.txt` (et un User-Agent identifiable).
- Les conditions d'utilisation du site priment. La case d'attestation de l'app
  ne remplace ni une licence ni une autorisation de l'éditeur ; elle rappelle
  seulement à l'utilisateur qu'il répond de son droit d'usage.

## Attribution

- L'extrait récupéré est une donnée externe, marquée non fiable avant l'IA, et
  seulement cité comme source (« Manuel : <titre> »).
- L'URL du manuel n'est ni citée comme source ni envoyée au fournisseur LLM :
  seuls le titre et l'extrait borné sont joints au contexte.
- L'extrait reste une citation attribuée à l'ouvrage ; il ne remplace ni
  l'achat ni la licence du manuel.

## Avant une release publique

Revue juridique obligatoire, portant au minimum sur : les conditions du ou des
sites cibles, la lecture de `robots.txt`, l'identification du client HTTP, la
conservation locale des extraits et l'attribution affichée. Tant que cette
revue n'est pas faite, le scraper reste un outil local facultatif, sans adresse
par défaut et sans usage public annoncé.
