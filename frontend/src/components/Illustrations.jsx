// Decorative drawings for empty states. (Hero areas use real photos; see photos/.)

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
