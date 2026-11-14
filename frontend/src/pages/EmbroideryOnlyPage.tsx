import { useAuth } from "../auth/AuthContext";
import EmbroideryPanel from "../components/embroidery/EmbroideryPanel";

// The whole app for the EMBROIDERY role: the Embroidery page and nothing else.
export default function EmbroideryOnlyPage() {
  const { user, logout } = useAuth();
  return (
    <div className="app-layout">
      <div className="main">
        <header className="topbar">
          <div className="topbar-title">🧵 Embroidery</div>
          <div className="spacer" />
          <div className="user-box">
            <span className="user-name">{user?.name}</span>
            <span className="user-role">{user?.role}</span>
            <button className="link-btn" onClick={logout}>Sign out</button>
          </div>
        </header>
        <EmbroideryPanel />
      </div>
    </div>
  );
}
