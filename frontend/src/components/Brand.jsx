import { Link } from "react-router-dom";
import { LogoMark } from "./Icons";

// The logo and name. A link home on signed-in pages; plain text on the public
// Share View, which has no other links or controls.
export default function Brand({ to }) {
  const content = (
    <>
      <LogoMark size={30} />
      <span className="brand-name">Trip Planner</span>
    </>
  );
  return to ? (
    <Link className="brand" to={to}>
      {content}
    </Link>
  ) : (
    <span className="brand">{content}</span>
  );
}
