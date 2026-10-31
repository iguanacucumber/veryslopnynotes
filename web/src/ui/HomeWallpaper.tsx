import { useId } from "react";

/** Papier peint généré de l'accueil, comme le mesh de Papillon : aucune image
 *  réseau ni fichier, une grappe de taches floutées qui suit la palette.
 *  Les accents restent fixes ; seule la marque vient des variables. */
export function HomeWallpaper() {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const blur = `blur-${uid}`;
  const base = `base-${uid}`;
  const dim = `dim-${uid}`;
  return (
    <svg
      className="wallpaper"
      viewBox="0 0 412 400"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id={base} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--wallpaper-deep)" />
          <stop offset="0.52" stopColor="var(--wallpaper-mid)" />
          <stop offset="1" stopColor="var(--wallpaper-warm)" />
        </linearGradient>
        <linearGradient id={dim} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="black" stopOpacity="0.62" />
          <stop offset="0.58" stopColor="black" stopOpacity="0.18" />
          <stop offset="1" stopColor="black" stopOpacity="0" />
        </linearGradient>
        <filter id={blur} x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="46" />
        </filter>
      </defs>
      <rect width="412" height="400" fill={`url(#${base})`} />
      <g filter={`url(#${blur})`} opacity="0.9">
        <ellipse cx="72" cy="48" rx="190" ry="150" fill="var(--brand)" />
        <ellipse cx="356" cy="36" rx="170" ry="130" fill="var(--wallpaper-pink)" opacity="0.72" />
        <ellipse cx="330" cy="236" rx="170" ry="120" fill="var(--wallpaper-blue)" opacity="0.58" />
        <ellipse cx="58" cy="260" rx="140" ry="105" fill="var(--wallpaper-amber)" opacity="0.5" />
        <ellipse cx="204" cy="146" rx="150" ry="110" fill="var(--brand-light)" opacity="0.62" />
        <ellipse cx="142" cy="330" rx="150" ry="90" fill="var(--wallpaper-violet)" opacity="0.34" />
      </g>
      <rect width="412" height="250" fill={`url(#${dim})`} />
    </svg>
  );
}
