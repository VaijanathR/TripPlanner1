import { useState } from "react";

// A photo that fills a hero area, with a scrim so white text stays readable.
// The area's own gradient sits underneath, so if the photo cannot load it just
// disappears (never a broken image) and the gradient stands in.
// Only the Trip List banner is `eager`; every other photo loads as it comes into view.
export default function HeroPhoto({ src, alt = "", eager = false }) {
  const [broken, setBroken] = useState(false);
  if (!src || broken) return null;
  return (
    <>
      <img
        className="hero-photo"
        src={src}
        alt={alt}
        loading={eager ? "eager" : "lazy"}
        fetchPriority={eager ? "high" : undefined}
        decoding="async"
        onError={() => setBroken(true)}
      />
      <span className="hero-scrim" aria-hidden="true" />
    </>
  );
}
