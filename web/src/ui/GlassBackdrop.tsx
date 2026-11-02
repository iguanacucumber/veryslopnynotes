/** Fond animé de « Liquid Glass » : quatre taches de couleur qui dérivent
 *  lentement derrière les surfaces floutées. Les transformations seules
 *  bougent (la garde globale de `tokens.css` coupe le mouvement). */
export function GlassBackdrop() {
  return (
    <div className="glass-backdrop" aria-hidden="true">
      <span className="glass-backdrop__blob glass-backdrop__blob--a" />
      <span className="glass-backdrop__blob glass-backdrop__blob--b" />
      <span className="glass-backdrop__blob glass-backdrop__blob--c" />
      <span className="glass-backdrop__blob glass-backdrop__blob--d" />
      <span className="glass-backdrop__blob glass-backdrop__blob--e" />
    </div>
  );
}
