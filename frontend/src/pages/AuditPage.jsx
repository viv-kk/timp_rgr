import { useEffect, useMemo, useState } from "react";
import { api } from "../api";

const EVENT_TYPE_LABELS = {
  ticket_sale: "Продажа",
  gate_scan: "Скан QR",
  login_success: "Вход",
  login_failed: "Вход",
  login_blocked: "Вход",
  login_2fa_sent: "Вход",
  login_2fa_failed: "Вход",
  cashier_register_success: "Регистрация",
  cashier_register_failed: "Регистрация",
  cashier_register_code_sent: "Регистрация",
  cashier_request_submitted: "Регистрация",
  cashier_request_approved: "Регистрация",
  cashier_request_rejected: "Регистрация",
  email_sent: "Email",
  email_send_failed: "Email"
};

function formatEventType(eventType) {
  return EVENT_TYPE_LABELS[eventType] || eventType;
}

const AUDIT_FILTERS = [
  { id: "all", label: "Все" },
  { id: "sales", label: "Продажа" },
  { id: "gate", label: "Скан QR" },
  { id: "auth", label: "Вход" },
  { id: "register", label: "Регистрация" },
  { id: "email", label: "Email" }
];

function matchesAuditFilter(filterId, eventType) {
  switch (filterId) {
    case "sales":
      return eventType === "ticket_sale";
    case "gate":
      return eventType === "gate_scan";
    case "auth":
      return eventType.startsWith("login_");
    case "register":
      return eventType.includes("cashier_register") || eventType.includes("cashier_request");
    case "email":
      return eventType.startsWith("email_");
    default:
      return true;
  }
}

function getAuditTypeTone(eventType, item) {
  switch (eventType) {
    case "login_success":
    case "cashier_register_success":
    case "cashier_register_code_sent":
    case "cashier_request_submitted":
    case "cashier_request_approved":
    case "email_sent":
      return "success";
    case "login_failed":
    case "cashier_register_failed":
    case "cashier_request_rejected":
    case "email_send_failed":
      return "danger";
    case "login_blocked":
    case "login_2fa_sent":
      return "warning";
    case "login_2fa_failed":
      return "danger";
    case "gate_scan": {
      const decision = item?.extra?.["Результат"] || item?.extra?.Результат;
      if (decision === "allow") return "success";
      if (decision === "deny") return "danger";
      return "warning";
    }
    case "ticket_sale":
      return "info";
    default:
      if (eventType?.includes("failed") || eventType?.includes("rejected") || eventType?.includes("deny")) {
        return "danger";
      }
      if (eventType?.includes("success") || eventType?.includes("approved")) {
        return "success";
      }
      return "info";
  }
}

export default function AuditPage() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [expandedKey, setExpandedKey] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");

  const filteredItems = useMemo(() => {
    return items.filter((item) => matchesAuditFilter(categoryFilter, item.event_type));
  }, [items, categoryFilter]);

  useEffect(() => {
    loadAudit();
  }, []);

  async function loadAudit() {
    setLoading(true);
    setError("");
    try {
      const { data } = await api.get("/audit/feed?limit=120");
      setItems(data.items || []);
    } catch (err) {
      setError(err?.response?.data?.detail || "Не удалось загрузить аудит");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <section className="card page-head">
        <h2>Аудит системы</h2>
        <p className="muted">
          Журнал действий: продажи, вход по QR, авторизация, регистрация кассиров и отправка билетов на email.
        </p>
      </section>

      <section className="card">
        <div className="audit-header">
          <h3>Последние события</h3>
          <button type="button" onClick={loadAudit} disabled={loading}>
            {loading ? "Обновляем..." : "Обновить"}
          </button>
        </div>

        {error && <p className="error">{error}</p>}

        {!error && items.length > 0 && (
          <div className="audit-toolbar">
            <div className="audit-filters" role="tablist" aria-label="Фильтр событий">
              {AUDIT_FILTERS.map((filter) => (
                <button
                  key={filter.id}
                  type="button"
                  role="tab"
                  aria-selected={categoryFilter === filter.id}
                  className={`audit-filter-btn ${categoryFilter === filter.id ? "active" : ""}`}
                  onClick={() => {
                    setCategoryFilter(filter.id);
                    setExpandedKey("");
                  }}
                >
                  {filter.label}
                </button>
              ))}
            </div>
            <p className="audit-filter-meta muted">
              Показано {filteredItems.length} из {items.length}
            </p>
          </div>
        )}

        {!error && items.length === 0 && <p className="muted">Пока нет событий аудита.</p>}
        {!error && items.length > 0 && filteredItems.length === 0 && (
          <p className="muted">Нет событий по выбранному фильтру.</p>
        )}

        {filteredItems.length > 0 && (
          <div className="audit-list">
            {filteredItems.map((item, index) => (
              <article
                className={`audit-item audit-item-clickable ${expandedKey === `${item.timestamp}-${index}` ? "expanded" : ""}`}
                key={`${item.timestamp}-${index}`}
                onClick={() =>
                  setExpandedKey((prev) => (prev === `${item.timestamp}-${index}` ? "" : `${item.timestamp}-${index}`))
                }
              >
                <div className="audit-item-top">
                  <strong>{item.action}</strong>
                  <span className={`audit-type audit-type-${getAuditTypeTone(item.event_type, item)}`}>
                    {formatEventType(item.event_type)}
                  </span>
                </div>
                <p className="muted">
                  {new Date(item.timestamp).toLocaleString("ru-RU", { hour12: false })} - {item.actor}
                </p>
                {expandedKey === `${item.timestamp}-${index}` && (
                  <div className="audit-details">
                    <p className="muted">{item.details}</p>
                    {item.extra && (
                      <ul className="audit-details-list">
                        {Object.entries(item.extra).map(([key, value]) => (
                          <li key={key}>
                            <strong>{key}: </strong>
                            {value}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </article>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
