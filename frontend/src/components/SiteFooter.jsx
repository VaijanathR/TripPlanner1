import { Link } from "react-router-dom";

// On every screen: the way to the photo credits.
export default function SiteFooter() {
  return (
    <footer className="site-footer">
      <Link to="/credits">Photo credits</Link>
    </footer>
  );
}
