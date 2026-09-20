import { Link } from "react-router-dom";
import Brand from "../components/Brand";
import { allPhotos, photoUrl } from "../photos/photos";

// Public: who took each travel photo and under what licence it is used.
export default function Credits() {
  return (
    <div className="page credits-page">
      <div className="share-header">
        <Brand />
      </div>
      <h1>Photo credits</h1>
      <p className="credits-intro">
        The travel photos in Trip Planner are public domain or shared under Creative Commons licences.
        Thank you to the photographers below.
      </p>
      <Link className="back-link credits-back" to="/">← Back to Trip Planner</Link>
      <ul className="credits-list" aria-label="Photos">
        {allPhotos.map((photo) => (
          <li key={photo.id} className="credit">
            <img src={photoUrl(photo.files.card ?? Object.values(photo.files)[0])} alt="" loading="lazy" />
            <div>
              <strong>{photo.title}</strong>
              <span>
                By {photo.author} ·{" "}
                {photo.licenseUrl ? (
                  <a href={photo.licenseUrl} target="_blank" rel="noreferrer noopener">{photo.license}</a>
                ) : (
                  photo.license
                )}
              </span>
              <span>
                <a href={photo.sourceUrl} target="_blank" rel="noreferrer noopener">Original on Wikimedia Commons</a>
                {" · "}
                {photo.changes}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
