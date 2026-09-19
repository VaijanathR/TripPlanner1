import { PinIcon } from "./Icons";
import PlaceCard from "./PlaceCard";
import Photo from "./Photo";

const KINDS = [
  ["city", "City"],
  ["state", "State / region"],
  ["country", "Country"],
];

function PhotoCard({ kind, photo }) {
  return (
    <figure className={`photo-card photo-${kind}`}>
      <Photo className="photo-frame" src={photo.image_url} alt={photo.title} />
      <figcaption>
        <span className="eyebrow-dark">{KINDS.find(([k]) => k === kind)[1]}</span>
        <strong>{photo.title}</strong>
        {photo.description && <span>{photo.description}</span>}
        {photo.image_url && photo.credit_url && (
          <a className="credit" href={photo.credit_url} target="_blank" rel="noopener noreferrer">
            Photo credit
          </a>
        )}
      </figcaption>
    </figure>
  );
}

// What the destination offers: photos, things to do, and popular places to add
// to the itinerary. Every section can be pending or unavailable on its own.
export default function DestinationGuide({ destination, guide, error, onRetry, days, onAddPlace }) {
  const city = destination.city;

  if (error && !guide) {
    return (
      <section className="guide">
        <div className="error-state">
          <p>Couldn't load the guide for {city}: {error}</p>
          <button type="button" onClick={onRetry}>
            Retry
          </button>
        </div>
      </section>
    );
  }

  if (!guide) {
    return (
      <section className="guide" aria-busy="true" aria-label="Loading destination guide">
        <div className="guide-skeleton skeleton" />
      </section>
    );
  }

  if (guide.status === "failed") {
    return (
      <section className="guide">
        <div className="error-state">
          <p>We couldn't put together a guide for {city} right now.</p>
          <button type="button" onClick={onRetry}>
            Try again
          </button>
        </div>
      </section>
    );
  }

  const { sections, photos, activities, places, gallery } = guide;
  const building = guide.status === "building";
  const photoKinds = KINDS.filter(([k]) => photos[k]);
  const hasPlaces = places.city.length + places.around.length > 0;

  return (
    <section className="guide" aria-label={`Guide to ${city}`}>
      <header className="guide-header">
        <h2>
          <PinIcon /> Discover {city}
        </h2>
        {photos.city?.extract && <p className="guide-intro">{photos.city.extract}</p>}
      </header>

      {building && (
        <p className="guide-progress" role="status">
          Building your guide… the first time for a city can take up to a minute.
        </p>
      )}

      {photoKinds.length > 0 && (
        <div className="photo-trio">
          {photoKinds.map(([kind]) => (
            <PhotoCard key={kind} kind={kind} photo={photos[kind]} />
          ))}
        </div>
      )}
      {sections.photos === "unavailable" && (
        <p className="section-note">Photos of {city} are unavailable right now.</p>
      )}

      {activities.length > 0 && (
        <div className="guide-block">
          <h3>Things to do in {city}</h3>
          <ul className="activity-cards">
            {activities.map((a) => (
              <li key={a.theme} className="activity-card">
                <h4>{a.label}</h4>
                <p>{a.summary}</p>
                <p className="chips">
                  {a.places.map((name) => (
                    <span key={name} className="chip">
                      {name}
                    </span>
                  ))}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {places.city.length > 0 && (
        <div className="guide-block">
          <h3>Popular places in {city}</h3>
          <div className="place-grid">
            {places.city.map((p) => (
              <PlaceCard key={p.id} place={p} days={days} onAdd={onAddPlace} />
            ))}
          </div>
        </div>
      )}

      {places.around.length > 0 && (
        <div className="guide-block">
          <h3>Around {city}</h3>
          <div className="place-grid">
            {places.around.map((p) => (
              <PlaceCard key={p.id} place={p} days={days} onAdd={onAddPlace} />
            ))}
          </div>
        </div>
      )}

      {!building && sections.places_city === "unavailable" && (
        <p className="section-note">Popular places for {city} are unavailable right now.</p>
      )}
      {!building && sections.places_city === "ready" && !hasPlaces && (
        <p className="section-note">We couldn't find well-known places listed for {city}.</p>
      )}
      {!building && sections.places_around === "unavailable" && sections.places_city === "ready" && (
        <p className="section-note">Places around {city} are unavailable right now.</p>
      )}

      {gallery.length > 0 && (
        <div className="guide-block">
          <h3>Photos from {city}</h3>
          <div className="gallery">
            {gallery.map((g) => (
              <a key={g.image_url} href={g.credit_url ?? g.image_url} target="_blank" rel="noopener noreferrer">
                <Photo className="gallery-photo" src={g.image_url} alt={g.title} />
              </a>
            ))}
          </div>
        </div>
      )}

      <p className="attribution">
        Photos and descriptions from Wikipedia and Wikimedia Commons, used under their open licenses. Places come from
        Wikidata, ranked by how widely they are written about.
      </p>
    </section>
  );
}
