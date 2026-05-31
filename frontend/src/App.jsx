import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import AppLayout from "./components/AppLayout";
import { AuthProvider, useAuth } from "./context/AuthContext";
import AdminEventsPage from "./pages/AdminEventsPage";
import AdminEditEventPage from "./pages/AdminEditEventPage";
import AdminEditVenuePage from "./pages/AdminEditVenuePage";
import AdminCashierRequestsPage from "./pages/AdminCashierRequestsPage";
import AdminVenuesPage from "./pages/AdminVenuesPage";
import AuditPage from "./pages/AuditPage";
import CashierRegistrationPage from "./pages/CashierRegistrationPage";
import GatePage from "./pages/GatePage";
import LoginPage from "./pages/LoginPage";
import SalesPage from "./pages/SalesPage";
import StatsPage from "./pages/StatsPage";

function ProtectedLayout() {
  const { token, loading, me } = useAuth();

  if (loading) {
    return (
      <main className="container">
        <section className="card">
          <p>Загрузка...</p>
        </section>
      </main>
    );
  }
  if (!token) {
    return <Navigate to="/login" replace />;
  }
  if (!me) {
    return (
      <main className="container">
        <section className="card">
          <p>Загрузка профиля...</p>
        </section>
      </main>
    );
  }
  return <AppLayout />;
}

function RoleRoute({ allowedRoles, children }) {
  const { me } = useAuth();
  if (!me) return null;
  if (!allowedRoles.includes(me.role)) {
    return <Navigate to="/" replace />;
  }
  return children;
}

function HomeRedirect() {
  const { me } = useAuth();
  if (!me) return null;
  if (me.role === "admin") return <Navigate to="/admin/audit" replace />;
  if (me.role === "manager") return <Navigate to="/admin/venues" replace />;
  return <Navigate to="/sales" replace />;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register-cashier" element={<CashierRegistrationPage staffRole="cashier" />} />
          <Route path="/register-manager" element={<CashierRegistrationPage staffRole="manager" />} />
          <Route element={<ProtectedLayout />}>
            <Route path="/" element={<HomeRedirect />} />
            <Route
              path="/sales"
              element={
                <RoleRoute allowedRoles={["cashier"]}>
                  <SalesPage />
                </RoleRoute>
              }
            />
            <Route
              path="/gate"
              element={
                <RoleRoute allowedRoles={["cashier"]}>
                  <GatePage />
                </RoleRoute>
              }
            />
            <Route
              path="/stats"
              element={
                <RoleRoute allowedRoles={["admin"]}>
                  <StatsPage />
                </RoleRoute>
              }
            />
            <Route
              path="/admin/venues"
              element={
                <RoleRoute allowedRoles={["manager"]}>
                  <AdminVenuesPage />
                </RoleRoute>
              }
            />
            <Route
              path="/admin/venues/:venueId/edit"
              element={
                <RoleRoute allowedRoles={["manager"]}>
                  <AdminEditVenuePage />
                </RoleRoute>
              }
            />
            <Route
              path="/admin/events"
              element={
                <RoleRoute allowedRoles={["manager"]}>
                  <AdminEventsPage />
                </RoleRoute>
              }
            />
            <Route
              path="/admin/events/:eventId/edit"
              element={
                <RoleRoute allowedRoles={["manager"]}>
                  <AdminEditEventPage />
                </RoleRoute>
              }
            />
            <Route
              path="/admin/audit"
              element={
                <RoleRoute allowedRoles={["admin"]}>
                  <AuditPage />
                </RoleRoute>
              }
            />
            <Route
              path="/admin/cashier-requests"
              element={
                <RoleRoute allowedRoles={["admin"]}>
                  <AdminCashierRequestsPage />
                </RoleRoute>
              }
            />
          </Route>
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
