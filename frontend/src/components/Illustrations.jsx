// Decorative scenery drawn in SVG, so the app looks good with no image files
// and no network. Real destination photos replace these where we have them.

export function HeroScene({ className }) {
  return (
    <svg
      className={className}
      viewBox="0 0 1200 420"
      preserveAspectRatio="xMidYMax slice"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id="sun-glow" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffd27a" />
          <stop offset="1" stopColor="#ff8a63" />
        </linearGradient>
        <linearGradient id="sea" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.22" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0.05" />
        </linearGradient>
      </defs>
      <circle cx="930" cy="150" r="150" fill="#ffd27a" opacity="0.16" />
      <circle cx="930" cy="150" r="96" fill="#ffd27a" opacity="0.22" />
      <circle cx="930" cy="150" r="58" fill="url(#sun-glow)" />
      <path d="M0 300 210 175 330 250 500 130 690 270 820 205 1010 300 1200 215V420H0Z" fill="#ffffff" opacity="0.13" />
      <path d="M0 340 150 250 280 320 450 205 620 330 790 245 960 335 1200 250V420H0Z" fill="#ffffff" opacity="0.18" />
      <path d="M0 375C120 340 210 405 340 372S560 340 690 375 930 405 1060 368 1150 350 1200 362V420H0Z" fill="url(#sea)" />
      <path d="M0 400C140 372 250 420 380 396S620 372 760 400 990 422 1110 394 1170 386 1200 392V420H0Z" fill="#ffffff" opacity="0.1" />
      <g fill="none" stroke="#ffffff" strokeOpacity="0.7" strokeWidth="2" strokeDasharray="3 8" strokeLinecap="round">
        <path d="M420 150C520 96 600 150 670 96S690 76 700 84" />
      </g>
      <path d="m716 78-44 18 16 6 6 18 9-11 11 5 2-36Zm-12 12 6 3-5 5Z" fill="#ffffff" transform="rotate(-8 700 90)" />
    </svg>
  );
}

// A tidy suitcase-and-map picture for empty states.
export function EmptyTrips({ className }) {
  return (
    <svg className={className} viewBox="0 0 200 140" aria-hidden="true" focusable="false">
      <ellipse cx="100" cy="126" rx="70" ry="7" fill="currentColor" opacity="0.08" />
      <rect x="44" y="46" width="112" height="72" rx="12" fill="var(--primary)" />
      <rect x="44" y="46" width="112" height="72" rx="12" fill="url(#empty-shine)" opacity="0.25" />
      <path d="M82 46v-8a8 8 0 0 1 8-8h20a8 8 0 0 1 8 8v8" fill="none" stroke="var(--primary-strong)" strokeWidth="6" strokeLinecap="round" />
      <rect x="44" y="76" width="112" height="6" fill="var(--primary-strong)" opacity="0.35" />
      <rect x="92" y="70" width="16" height="18" rx="4" fill="var(--gold)" />
      <circle cx="66" cy="62" r="8" fill="var(--accent)" />
      <path d="M62 62h8M66 58v8" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
      <path d="m138 96 20-6 8 14-20 6Z" fill="var(--accent-soft)" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round" />
      <defs>
        <linearGradient id="empty-shine" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fff" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>
    </svg>
  );
}
