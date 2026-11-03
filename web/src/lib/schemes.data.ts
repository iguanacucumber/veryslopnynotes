// Palettes pures ; la logique est dans `schemes.ts`.

export interface Palette {
  page: string;
  surface: string;
  surfaceVariant: string;
  surfaceContainer: string;
  ink: string;
  brand: string;
  brandLight: string;
  brandDeep: string;
  brandPale: string;
  brandSolid: string;
  onBrand: string;
  danger: string;
  dangerSolid: string;
  onDanger: string;
  dangerInk: string;
}

export interface Scheme {
  id: string;
  label: string;
  light: Palette;
  dark: Palette;
}

export const DEFAULT_SCHEME_ID = "slop";

export const SCHEMES: ReadonlyArray<Scheme> = [
  {
    id: DEFAULT_SCHEME_ID,
    label: "Slop (défaut)",
    light: {
      page: "#FFFFFF",
      surface: "#FFFFFF",
      surfaceVariant: "#F3F6F7",
      surfaceContainer: "#F1F1F1",
      ink: "#000000",
      brand: "#29947A",
      brandLight: "#5AB09B",
      brandDeep: "#217663",
      brandPale: "#E9F5F1",
      brandSolid: "#1C6653",
      onBrand: "#FFFFFF",
      danger: "#DC1400",
      dangerSolid: "#C11200",
      onDanger: "#FFFFFF",
      dangerInk: "#C11200",
    },
    dark: {
      page: "#000000",
      surface: "#121212",
      surfaceVariant: "#121212",
      surfaceContainer: "#121212",
      ink: "#FFFFFF",
      brand: "#29947A",
      brandLight: "#5AB09B",
      brandDeep: "#5AB09B",
      brandPale: "#12362C",
      brandSolid: "#6CC4A8",
      onBrand: "#08201A",
      danger: "#F4B9B3",
      dangerSolid: "#E0776F",
      onDanger: "#240806",
      dangerInk: "#F4B9B3",
    },
  },
  {
    id: "material",
    label: "Material You",
    light: {
      page: "#FEF7FF",
      surface: "#FFFBFE",
      surfaceVariant: "#EFE6F5",
      surfaceContainer: "#E8DEF8",
      ink: "#1D1B20",
      brand: "#6750A4",
      brandLight: "#7F67BE",
      brandDeep: "#4F378B",
      brandPale: "#EADDFF",
      brandSolid: "#6750A4",
      onBrand: "#FFFFFF",
      danger: "#B3261E",
      dangerSolid: "#8C1D18",
      onDanger: "#FFFFFF",
      dangerInk: "#B3261E",
    },
    dark: {
      page: "#141218",
      surface: "#1D1B20",
      surfaceVariant: "#2B2930",
      surfaceContainer: "#36343B",
      ink: "#E6E0E9",
      brand: "#D0BCFF",
      brandLight: "#EADDFF",
      brandDeep: "#D0BCFF",
      brandPale: "#4F378B",
      brandSolid: "#D0BCFF",
      onBrand: "#381E72",
      danger: "#F2B8B5",
      dangerSolid: "#F2B8B5",
      onDanger: "#601410",
      dangerInk: "#F2B8B5",
    },
  },
  // Le skin vit dans `styles/liquid-glass.css` : surfaces translucides, barres
  // floutées et police système, activés seulement par `data-scheme`.
  {
    id: "liquid-glass",
    label: "Liquid Glass",
    light: {
      page: "#F2F2F7",
      surface: "#FFFFFF",
      surfaceVariant: "#E9E9EE",
      surfaceContainer: "#E3E3E8",
      ink: "#000000",
      brand: "#007AFF",
      brandLight: "#5AC8FA",
      brandDeep: "#0057B8",
      brandPale: "#E5F1FF",
      brandSolid: "#0066D6",
      onBrand: "#FFFFFF",
      danger: "#FF3B30",
      dangerSolid: "#C81E1E",
      onDanger: "#FFFFFF",
      dangerInk: "#B31212",
    },
    dark: {
      page: "#000000",
      surface: "#1C1C1E",
      surfaceVariant: "#2C2C2E",
      surfaceContainer: "#2C2C2E",
      ink: "#F2F2F7",
      brand: "#0A84FF",
      brandLight: "#64D2FF",
      brandDeep: "#64B5FF",
      brandPale: "#0A2540",
      brandSolid: "#0A84FF",
      onBrand: "#04101F",
      danger: "#FF6B6B",
      dangerSolid: "#C62E2E",
      onDanger: "#FFFFFF",
      dangerInk: "#FF8A8A",
    },
  },
];
