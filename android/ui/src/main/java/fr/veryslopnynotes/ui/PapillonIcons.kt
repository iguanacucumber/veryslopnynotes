package fr.veryslopnynotes.ui

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathFillType
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.unit.dp

// GLYPHES DE LA BARRE D'ONGLETS, RELEVÉS SUR PAPILLON.
//
// AVANT : `Icons.Filled.*` de `material-icons-core`, donc la famille Material.
// Les cinq glyphes se ressemblaient, ils ne VOYAIENT pas comme ceux de Papillon :
// Notes portait une ÉTOILE (étoile = favori, pas notes) et l'EDT un vrai
// calendrier, alors que Papillon pose un document à coin plié pour les cours et
// un camembert pour les notes. Sur une barre d'onglets l'icône EST le logo : deux
// apps qui se ressemblent ne se reconnaissent pas d'un coup d'œil.
//
// Ces quatre formes sont REDESSINÉES ici, pas copiées : des `ImageVector`
// monochrome tracés dans une grille de 24, relevés sur les glyphes de l'app de
// référence (IoU 0.997-0.9997, mesuré contre leur masque image — donc le décalage
// est de moins d'un dixième de pixel, pas une approximation à l'œil).
// Conséquence assumée : ni image, ni police, ni dépendance ajoutée —
// `material-icons-extended` (qui contient bien un camembert) reste hors du
// graphe par choix, cf. le KDoc de [tabIcon].
//
// Chaque icône est UN `path` en `EvenOdd` : le trou (l'arche de la porte, la
// coche, le quartier de camembert) est un sous-trac de sens opposé, donc il se
// perce sans second chemin ni `clip`. `Icon(tint = …)` teinte ensuite tout le
// vecteur : ces glyphes restent monochromes comme ceux de Material, c'est ce qui
// fait que l'onglet sélectionné change de couleur (#135).
//
// ponytail: quatre glyphes, pas une collection. Le CINQUIÈME onglet (Profil) n'a
// pas d'équivalent dans la barre de Papillon — son profil est un avatar dans
// l'en-tête — donc il garde `Icons.Filled.Person` : l'écart est écrit là où il se
// décide, dans [tabIcon].
private const val GRILLE = 24

/**
 * Outil commun : un `ImageVector` de 24 dp, monochrome, tracé unique `EvenOdd`.
 *
 * Le `fill` est noir : `Icon` applique son `tint` comme `ColorFilter` sur tout
 * le vecteur, donc la couleur du `path` n'est jamais vue — elle ne sert qu'à ce
 * que le vecteur soit dessiné si quelqu'un le rend sans `tint`.
 */
private fun glyphePapillon(nom: String, d: String): ImageVector =
    ImageVector.Builder(
        name = nom,
        defaultWidth = GRILLE.dp,
        defaultHeight = GRILLE.dp,
        viewportWidth = GRILLE.toFloat(),
        viewportHeight = GRILLE.toFloat(),
    )
        .addPath(
            // `PathParser` lit la chaîne une fois, à la construction : le vecteur
            // fini ne retient que des nœuds, donc aucun texte n'est re-parsé au
            // rendu (c'est ce que fait le lecteur de XML pour un `<path>`).
            pathData = PathParser().parsePathString(d).toNodes(),
            pathFillType = PathFillType.EvenOdd,
            fill = SolidColor(Color.Black),
        )
        .build()

/** Accueil : une maison pleine à arche, pas une maison à triangle. */
val PapillonTabAccueil: ImageVector by lazy {
    glyphePapillon(
        "PapillonTabAccueil",
        "M22,19.1L21.7,19.1L21.7,20.3L21.4,20.3L21.1,21.4L20.6,21.4L20.3,22L14.9,22L14.9,15.7L14.3,15.4" +
        "L14,14.6L13.4,14.6L13.4,14.3L12.9,14.3L12.9,14L11.1,14L11.1,14.3L10,14.6L9.7,15.4L9.1,15.7" +
        "L9.1,22L4,22L4,21.7L2.9,21.4L2.6,20.6L2.3,20.6L2.3,19.1L2,19.1L2,14.9L2.3,14.9L2.6,13.1" +
        "L2.9,13.1L3.1,12L3.7,11.7L3.7,11.1L4.3,10.9L4.3,10.3L4.6,10.3L4.6,10L6.3,8.6L6.3,8L8.9,5.7" +
        "L8.9,5.1L9.1,5.1L10,4L10.6,4L10.6,3.7L11.1,3.7L11.1,3.4L12.9,3.4L12.9,3.7L14,4L14,4.3L14.9,4.9" +
        "L14.9,5.4L17.4,7.7L17.4,8.3L17.7,8.3L17.7,8.6L19.7,10.3L19.7,10.9L20.6,11.4L20.6,12L20.9,12" +
        "L20.9,12.6L21.1,12.6L21.1,13.1L21.4,13.1L21.4,13.7L21.7,13.7L21.7,14.9L22,14.9Z"
    )
}

/** EDT : un document à coin plié sous sa barre — le glyphe des COURS. */
val PapillonTabCours: ImageVector by lazy {
    glyphePapillon(
        "PapillonTabCours",
        "M21.1,12.9L20.9,12.9L20.9,13.1L15.7,13.1L15.7,13.4L14.9,13.4L14.9,13.7L13.4,14.9L13.4,15.4" +
        "L13.1,15.4L13.1,20.9L12.9,20.9L12.9,21.1L7.4,21.1L7.4,20.9L5.4,20.9L5.4,20.6L4.9,20.6L4.9,20.3" +
        "L3.4,19.1L3.4,18.6L3.1,18.6L2.9,13.1L3.1,13.1L3.1,11.7L3.4,11.7L3.4,11.1L3.7,11.1L4.3,10.3" +
        "L5.1,10.3L5.1,10L18.9,10L18.9,10.3L19.7,10.3L19.7,10.6L20.6,11.1Z M21.1,6.6L20.9,6.6L20.9,7.1" +
        "L20.6,7.1L20,8L4.3,8L4.3,7.7L3.7,7.7L3.7,7.4L3.1,7.1L2.9,5.7L3.1,5.7L3.4,4.3L3.7,4.3L4.3,3.4" +
        "L5.7,3.1L5.7,2.9L18.3,2.9L18.3,3.1L19.7,3.4L19.7,3.7L20.6,4.3L20.9,5.7L21.1,5.7Z M20.6,15.4" +
        "L20.3,15.4L20.3,16L20,16L16.3,20L15.7,20L15.4,20.6L14.9,20.6L14.9,16.6L15.1,16.6L15.4,15.4" +
        "L16,15.4L16,15.1L16.6,15.1L16.6,14.9L20.6,14.9Z"
    )
}

/** Tâches : un carré plein à la coche PERCÉE (pas un cercle à contour). */
val PapillonTabTaches: ImageVector by lazy {
    glyphePapillon(
        "PapillonTabTaches",
        "M21.1,13.4L20.9,13.4L20.9,16.6L20.6,16.6L20.6,17.4L20.3,17.4L20,18.6L19.7,18.6L18.6,20L18,20" +
        "L18,20.3L17.4,20.3L17.4,20.6L16.6,20.6L16.6,20.9L13.4,20.9L13.4,21.1L7.4,20.9L7.4,20.6" +
        "L6.6,20.6L6.6,20.3L5.4,20L5.4,19.7L4,18.6L4,18L3.7,18L3.7,17.4L3.4,17.4L3.4,16.6L3.1,16.6" +
        "L3.1,13.4L2.9,13.4L2.9,10.6L3.1,10.6L3.1,7.4L3.4,7.4L3.4,6.6L3.7,6.6L4,5.4L4.3,5.4L5.4,4L6,4" +
        "L6,3.7L6.6,3.7L6.6,3.4L7.4,3.4L7.4,3.1L10.6,3.1L10.6,2.9L16.6,3.1L16.6,3.4L17.4,3.4L17.4,3.7" +
        "L18.6,4L18.6,4.3L20,5.4L20,6L20.3,6L20.3,6.6L20.6,6.6L20.6,7.4L20.9,7.4L20.9,10.6L21.1,10.6Z " +
        "M18,8.6L18,7.4L17.7,7.4L17.7,7.1L16.3,7.1L16,8L15.7,8L15.7,8.3L14.9,8.9L14.9,9.4L13.4,10.6" +
        "L13.4,11.1L12.3,12L12.3,12.6L11.1,13.4L11.1,14L10.9,14L10.6,14.6L10.3,14.6L8,12L7.1,12" +
        "L7.1,12.3L6.6,12.6L6.6,13.4L6.9,13.4L9.4,16.3L10.9,16.6L10.9,16.3L12,16L12,15.4L13.1,14.6" +
        "L13.1,14L14.3,13.1L14.3,12.6L15.7,11.4L15.7,10.9L16,10.9L16,10.6L16.9,10L16.9,9.4Z"
    )
}

/** Notes : un camembert au quartier DÉCOLLÉ, pas une étoile. */
val PapillonTabNotes: ImageVector by lazy {
    glyphePapillon(
        "PapillonTabNotes",
        "M20.6,15.4L20.3,15.4L20,16.6L19.4,16.9L19.4,17.4L19.1,17.4L17.4,19.4L16.9,19.4L16.6,20" +
        "L15.1,20.3L15.1,20.6L14.3,20.6L14.3,20.9L12.6,20.9L12.6,21.1L9.7,20.9L9.7,20.6L8.9,20.6" +
        "L8.9,20.3L8.3,20.3L8.3,20L6.6,19.4L6.6,19.1L4.6,17.4L4.6,16.9L4.3,16.9L4,16L3.7,16L3.4,14.3" +
        "L3.1,14.3L2.9,11.4L3.1,11.4L3.4,8.9L3.7,8.9L3.7,8.3L4,8.3L4.6,6.6L4.9,6.6L6.6,4.6L7.1,4.6" +
        "L7.4,4L8,4L8,3.7L8.6,3.7L8.6,3.4L9.4,3.4L9.4,3.7L10.6,4L10.6,4.6L10.9,4.6L10.9,6L11.1,6" +
        "L11.1,12.6L11.4,12.6L11.4,12.9L18,12.9L18,13.1L19.4,13.1L19.4,13.4L20,13.4L20,14L20.3,14" +
        "L20.3,14.6L20.6,14.6Z M20.3,10L20,10L19.4,10.9L18,10.9L18,11.1L15.1,11.1L15.1,10.9L13.4,10.6" +
        "L13.1,8.9L12.9,8.9L12.9,6L13.1,6L13.1,4.6L13.4,4.6L14,3.7L16,3.7L16,4L16.6,4L16.6,4.3L17.4,4.6" +
        "L17.4,4.9L19.4,6.6L19.4,7.1L20,7.4L20,8L20.3,8.0Z"
    )
}