import { useState } from "react";
import { coverGradient } from "../utils/cover";

// A photo that never leaves an ugly hole: if there is no image, or it fails to
// load (Wikimedia files can go missing), a colourful gradient stands in.
export default function Photo({ src, alt, seed, className, children }) {
  const [broken, setBroken] = useState(false);
  const showImage = Boolean(src) && !broken;
  return (
    <div className={className} style={showImage ? undefined : { backgroundImage: coverGradient(seed ?? alt) }}>
      {showImage && <img src={src} alt={alt} loading="lazy" onError={() => setBroken(true)} />}
      {children}
    </div>
  );
}
