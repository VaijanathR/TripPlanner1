import { STRIP_TILES } from "../photos/photos";
import Photo from "./Photo";

// "Travel your way": four decorative tiles. Nothing here can be clicked.
export default function TravelStrip() {
  return (
    <section className="travel-strip" aria-labelledby="travel-strip-title">
      <h2 id="travel-strip-title">Travel your way</h2>
      <div className="travel-tiles">
        {STRIP_TILES.map((tile) => (
          <figure key={tile.key} className="travel-tile" data-tile={tile.key}>
            <Photo className="travel-tile-photo" src={tile.url} alt="" seed={tile.key} />
            <figcaption>{tile.label}</figcaption>
          </figure>
        ))}
      </div>
    </section>
  );
}
