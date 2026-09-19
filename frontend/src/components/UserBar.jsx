import { useAuth } from "../auth/useAuth";

export default function UserBar() {
  const { user, logout } = useAuth();
  return (
    <div className="user-bar">
      <span className="user-email">{user.email}</span>
      <button type="button" onClick={logout}>
        Log out
      </button>
    </div>
  );
}
