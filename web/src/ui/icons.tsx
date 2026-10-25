import type { ReactNode, SVGProps } from "react";

type Props = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 22, children, ...rest }: Props & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const IconHome = (p: Props) => (
  <Svg {...p}><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V21h14V9.5" /><path d="M9.5 21v-6h5v6" /></Svg>
);
export const IconCalendar = (p: Props) => (
  <Svg {...p}><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M8 3v4M16 3v4M3 10h18" /></Svg>
);
export const IconTasks = (p: Props) => (
  <Svg {...p}><rect x="4" y="3" width="16" height="18" rx="3" /><path d="m8 9 1.8 1.8L13 7.5" /><path d="M8 16h8" /></Svg>
);
export const IconGrades = (p: Props) => (
  <Svg {...p}><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></Svg>
);
export const IconUser = (p: Props) => (
  <Svg {...p}><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 3.6-6.5 8-6.5S20 17 20 21" /></Svg>
);
export const IconBell = (p: Props) => (
  <Svg {...p}><path d="M18 8a6 6 0 1 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" /><path d="M10 21h4" /></Svg>
);
export const IconSettings = (p: Props) => (
  <Svg {...p}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6V21h-4v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H3v-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3V3h4v.1a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.1v4H21a1.7 1.7 0 0 0-1.6 1Z" /></Svg>
);
export const IconRefresh = (p: Props) => (
  <Svg {...p}><path d="M20 11a8 8 0 1 0-2.3 6.7" /><path d="M20 4v7h-7" /></Svg>
);
export const IconBack = (p: Props) => (
  <Svg {...p}><path d="M15 18l-6-6 6-6" /></Svg>
);
export const IconChevronLeft = (p: Props) => (
  <Svg {...p}><path d="M15 18l-6-6 6-6" /></Svg>
);
export const IconChevronRight = (p: Props) => (
  <Svg {...p}><path d="M9 18l6-6-6-6" /></Svg>
);
export const IconAttach = (p: Props) => (
  <Svg {...p}><path d="M21 11.5 12.5 20a5 5 0 0 1-7-7l8.5-8.5a3.5 3.5 0 1 1 5 5L10.5 18a2 2 0 0 1-3-3L15 7.5" /></Svg>
);
export const IconSend = (p: Props) => (
  <Svg {...p}><path d="m3 11 18-8-8 18-2.5-7.5L3 11Z" /></Svg>
);
export const IconPlus = (p: Props) => (
  <Svg {...p}><path d="M12 5v14M5 12h14" /></Svg>
);
export const IconLock = (p: Props) => (
  <Svg {...p}><rect x="4" y="10" width="16" height="11" rx="3" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></Svg>
);
export const IconWarning = (p: Props) => (
  <Svg {...p}><path d="M12 3 2 21h20L12 3Z" /><path d="M12 9v5M12 18h.01" /></Svg>
);
export const IconSun = (p: Props) => (
  <Svg {...p}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></Svg>
);
export const IconMoon = (p: Props) => (
  <Svg {...p}><path d="M21 12.8A8.5 8.5 0 1 1 11.2 3 7 7 0 0 0 21 12.8Z" /></Svg>
);
export const IconTrash = (p: Props) => (
  <Svg {...p}><path d="M3 6h18M8 6V4h8v2M6 6l1 15h10l1-15M10 11v6M14 11v6" /></Svg>
);
export const IconBook = (p: Props) => (
  <Svg {...p}><path d="M4 4h7a3 3 0 0 1 3 3v13a3 3 0 0 0-3-3H4V4Z" /><path d="M20 4h-3a3 3 0 0 0-3 3v13a3 3 0 0 1 3-3h3V4Z" /></Svg>
);
export const IconFood = (p: Props) => (
  <Svg {...p}><path d="M4 3v6a3 3 0 0 0 6 0V3M7 9v12" /><path d="M19 3v10h-4v-3c0-3 1.4-5.4 4-7Z" /><path d="M17 13v8" /></Svg>
);
export const IconMessage = (p: Props) => (
  <Svg {...p}><path d="M21 12a8 8 0 0 1-11.6 7.1L4 21l1.9-5.4A8 8 0 1 1 21 12Z" /></Svg>
);
export const IconShield = (p: Props) => (
  <Svg {...p}><path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6l-8-3Z" /><path d="m9 12 2 2 4-4" /></Svg>
);
export const IconDownload = (p: Props) => (
  <Svg {...p}><path d="M12 3v12M7 10l5 5 5-5M4 21h16" /></Svg>
);
export const IconSparkles = (p: Props) => (
  <Svg {...p}><path d="m12 3 1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3Z" /><path d="m19 15 .8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15Z" /></Svg>
);
export const IconClose = (p: Props) => (
  <Svg {...p}><path d="M6 6l12 12M18 6 6 18" /></Svg>
);
export const IconCamera = (p: Props) => (
  <Svg {...p}><path d="M3 8h4l2-3h6l2 3h4v11H3V8Z" /><circle cx="12" cy="13" r="3.5" /></Svg>
);
export const IconImage = (p: Props) => (
  <Svg {...p}><rect x="3" y="4" width="18" height="16" rx="3" /><circle cx="9" cy="10" r="1.6" /><path d="m4 18 5-5 4 4 2-2 5 5" /></Svg>
);
export const IconCheck = (p: Props) => (
  <Svg {...p}><path d="m4 12 5 5L20 6" /></Svg>
);
export const IconPin = (p: Props) => (
  <Svg {...p}><path d="M12 21s7-6.1 7-11a7 7 0 1 0-14 0c0 4.9 7 11 7 11Z" /><circle cx="12" cy="10" r="2.5" /></Svg>
);
