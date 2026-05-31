import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

const ROLE_LABELS = {
  admin: "администратор",
  manager: "менеджер",
  cashier: "кассир"
};

export default function AppLayout() {
  const { me, logout } = useAuth();
  const roleLabel = ROLE_LABELS[me?.role] || me?.role;
  const displayName = me?.full_name || me?.username;

  return (
    <main className="container">
      <header className="header">
        <div className="brand">
          <p className="eyebrow">Система безопасности мероприятий</p>
          <h1>Event Security</h1>
          <p className="muted">
            Пользователь: <strong>{displayName}</strong>
          </p>
        </div>
        <div className="header-actions">
          <span className="role-chip">{roleLabel}</span>
          <button onClick={logout}>Выйти</button>
        </div>
      </header>

      <nav className="nav card">
        {me?.role === "cashier" && (
          <>
            <NavLink to="/sales" className="nav-link">
              Продажа билетов
            </NavLink>
            <NavLink to="/gate" className="nav-link">
              Контроль входа
            </NavLink>
          </>
        )}
        {me?.role === "manager" && (
          <>
            <NavLink to="/admin/venues" className="nav-link">
              Управление площадками
            </NavLink>
            <NavLink to="/admin/events" className="nav-link">
              Управление мероприятиями
            </NavLink>
          </>
        )}
        {me?.role === "admin" && (
          <>
            <NavLink to="/stats" className="nav-link">
              Аналитика
            </NavLink>
            <NavLink to="/admin/audit" className="nav-link">
              Аудит системы
            </NavLink>
            <NavLink to="/admin/cashier-requests" className="nav-link">
              Заявки
            </NavLink>
          </>
        )}
      </nav>

      <Outlet />
    </main>
  );
}
