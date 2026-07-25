import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./auth/AuthContext";
import Login from "./pages/Login";
import OrdersPage from "./pages/OrdersPage";
import AdminPage from "./pages/AdminPage";

export default function App() {
  const { user, loading } = useAuth();

  if (loading) return <div className="center-screen">Loading…</div>;
  if (!user) return <Login />;

  return (
    <Routes>
      <Route path="/" element={<OrdersPage />} />
      <Route
        path="/admin"
        element={user.role === "ADMIN" ? <AdminPage /> : <Navigate to="/" replace />}
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
