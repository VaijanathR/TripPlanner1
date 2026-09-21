import { Link } from "react-router-dom";
import { useAuth } from "../auth/useAuth";
import Brand from "./Brand";

export default function UserBar() {
  const { user, logout } = useAuth();
  return (
    <header className="user-bar">
      <Brand to="/" />
      <div className="user-bar-right">
        <nav className="user-links" aria-label="Your account">
          <Link to="/account">Account</Link>
          {user.is_admin && <Link to="/admin">Admin</Link>}
        </nav>
        <span className="user-email">{user.email}</span>
        <button type="button" className="btn-ghost" onClick={logout}>
          Log out
        </button>
      </div>
    </header>
  );
}
