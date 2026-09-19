// Small inline SVG icons. Decorative: they are hidden from screen readers, and
// any button carrying one still has its own text or aria-label.
const base = {
  width: 18,
  height: 18,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
  focusable: "false",
};

export const PinIcon = (props) => (
  <svg {...base} {...props}>
    <path d="M12 21s7-5.6 7-11a7 7 0 1 0-14 0c0 5.4 7 11 7 11Z" />
    <circle cx="12" cy="10" r="2.5" />
  </svg>
);

export const CalendarIcon = (props) => (
  <svg {...base} {...props}>
    <rect x="3" y="5" width="18" height="16" rx="3" />
    <path d="M8 3v4M16 3v4M3 10h18" />
  </svg>
);

export const TrashIcon = (props) => (
  <svg {...base} {...props}>
    <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" />
  </svg>
);

export const ShareIcon = (props) => (
  <svg {...base} {...props}>
    <circle cx="6" cy="12" r="2.5" />
    <circle cx="17" cy="6" r="2.5" />
    <circle cx="17" cy="18" r="2.5" />
    <path d="m8.2 10.8 6.6-3.6M8.2 13.2l6.6 3.6" />
  </svg>
);

export const ArrowLeftIcon = (props) => (
  <svg {...base} {...props}>
    <path d="M19 12H5M11 6l-6 6 6 6" />
  </svg>
);

export const LogoMark = ({ size = 32, ...props }) => (
  <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" focusable="false" {...props}>
    <defs>
      <linearGradient id="logo-grad" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#0b5f73" />
        <stop offset="0.55" stopColor="#0e7c86" />
        <stop offset="1" stopColor="#ff8a63" />
      </linearGradient>
    </defs>
    <rect width="64" height="64" rx="16" fill="url(#logo-grad)" />
    <path d="M50 14 14 28.5l12.2 5.3L29 47l7.4-9.4 8.8 4L50 14Zm-8.6 8.9-11.6 9.6-.3-.1 11.9-9.5Z" fill="#fff" />
  </svg>
);
