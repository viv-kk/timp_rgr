import { useEffect, useState } from "react";
import { api } from "../api";
import { useAuth } from "../context/AuthContext";

const ALL_EVENTS_VALUE = "all";

const EVENT_TITLE_COLUMN = { key: "event_title", label: "Мероприятие" };

const CHART_COLORS = [
  "#1d4ed8",
  "#7c3aed",
  "#059669",
  "#d97706",
  "#dc2626",
  "#0891b2",
  "#db2777",
  "#65a30d",
  "#4f46e5",
  "#ea580c"
];

const STAT_MODALS = {
  sold: {
    title: "Продано билетов",
    columns: [
      { key: "buyer_name", label: "Покупатель" },
      { key: "seat_label", label: "Место" },
      { key: "ticket_code", label: "Код билета" },
      { key: "price", label: "Цена", format: "price" },
      { key: "sold_at", label: "Дата продажи", format: "datetime" },
      { key: "sold_by_username", label: "Кассир" }
    ]
  },
  checked_in: {
    title: "Прошли на вход",
    columns: [
      { key: "buyer_name", label: "Покупатель" },
      { key: "seat_label", label: "Место" },
      { key: "ticket_code", label: "Код билета" },
      { key: "used_at", label: "Время прохода", format: "datetime" },
      { key: "scanner_username", label: "Контролёр" }
    ]
  },
  not_checked_in: {
    title: "Не пришли",
    columns: [
      { key: "buyer_name", label: "Покупатель" },
      { key: "seat_label", label: "Место" },
      { key: "ticket_code", label: "Код билета" },
      { key: "sold_at", label: "Дата продажи", format: "datetime" }
    ]
  },
  gate_allow: {
    title: "Допуск на входе",
    columns: [
      { key: "buyer_name", label: "Покупатель" },
      { key: "seat_label", label: "Место" },
      { key: "scanned_at", label: "Время сканирования", format: "datetime" },
      { key: "scanner_username", label: "Контролёр" },
      { key: "reason", label: "Результат" }
    ]
  },
  gate_deny: {
    title: "Отказы на входе",
    columns: [
      { key: "buyer_name", label: "Покупатель" },
      { key: "seat_label", label: "Место" },
      { key: "scanned_at", label: "Время сканирования", format: "datetime" },
      { key: "scanner_username", label: "Контролёр" },
      { key: "reason", label: "Причина" }
    ]
  },
  repeated_qr: {
    title: "Повторные QR-попытки",
    columns: [
      { key: "buyer_name", label: "Покупатель" },
      { key: "seat_label", label: "Место" },
      { key: "scanned_at", label: "Время попытки", format: "datetime" },
      { key: "scanner_username", label: "Контролёр" },
      { key: "reason", label: "Причина" }
    ]
  }
};

function formatCellValue(value, format) {
  if (value == null || value === "") return "—";
  if (format === "datetime") {
    return new Date(value).toLocaleString("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    });
  }
  if (format === "price") {
    return `${Number(value).toLocaleString("ru-RU")} ₽`;
  }
  return String(value);
}

function buildConicGradient(slices) {
  if (!slices.length) {
    return "conic-gradient(#334155 0% 100%)";
  }
  let offset = 0;
  const stops = slices.map((slice) => {
    const start = offset;
    offset += slice.percent;
    return `${slice.color} ${start}% ${offset}%`;
  });
  return `conic-gradient(${stops.join(", ")})`;
}

function StatCard({ label, value, onOpen, disabled }) {
  const clickable = Boolean(onOpen) && !disabled;
  return (
    <article
      className={`stat-card ${clickable ? "stat-card-clickable" : ""}`}
      onClick={clickable ? onOpen : undefined}
      onKeyDown={
        clickable
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onOpen();
              }
            }
          : undefined
      }
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      title={clickable ? "Нажмите, чтобы посмотреть детали" : undefined}
    >
      <p className="muted">{label}</p>
      <h3>{value}</h3>
    </article>
  );
}

function BarRow({ label, count, widthPercent, barClass, onOpen, disabled }) {
  const clickable = Boolean(onOpen) && !disabled;
  return (
    <div
      className={`bar-row ${clickable ? "bar-row-clickable" : ""}`}
      onClick={clickable ? onOpen : undefined}
      onKeyDown={
        clickable
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onOpen();
              }
            }
          : undefined
      }
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      title={clickable ? "Нажмите, чтобы посмотреть детали" : undefined}
    >
      <span>{label}</span>
      <div className="bar-track">
        <div className={`bar-fill ${barClass}`} style={{ width: `${widthPercent}%` }} />
      </div>
      <strong>{count}</strong>
    </div>
  );
}

function MultiEventPieChart({ title, centerLabel, slices, onSliceClick, onOpenAll }) {
  const activeSlices = slices.filter((slice) => slice.percent > 0);
  const gradient = buildConicGradient(activeSlices);

  return (
    <article className="stat-card chart-card multi-pie-card">
      <p className="muted">{title}</p>
      <div
        className={`donut-chart multi-donut ${onOpenAll ? "stat-card-clickable" : ""}`}
        style={{ background: gradient }}
        onClick={onOpenAll}
        onKeyDown={
          onOpenAll
            ? (event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onOpenAll();
                }
              }
            : undefined
        }
        role={onOpenAll ? "button" : undefined}
        tabIndex={onOpenAll ? 0 : undefined}
        title={onOpenAll ? "Нажмите, чтобы открыть все записи" : undefined}
      >
        <span>{centerLabel}</span>
      </div>
      <ul className="pie-legend">
        {slices.map((slice) => (
          <li key={slice.eventId}>
            <button
              type="button"
              className="pie-legend-item"
              disabled={!slice.count}
              onClick={() => slice.count && onSliceClick(slice.eventId)}
            >
              <span className="pie-swatch" style={{ background: slice.color }} />
              <span className="pie-legend-text">
                <strong>{slice.label}</strong>
                <span className="muted">
                  {slice.percent}% · {slice.count} · проход {slice.checkInRate}%
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </article>
  );
}

function StatsByEventPanels({ data, onOpenDetail }) {
  if (!data?.items?.length) {
    return <p className="muted">Нет мероприятий для отображения.</p>;
  }

  const makeSlices = (countKey, percentKey) =>
    data.items.map((item, index) => ({
      eventId: item.event_id,
      label: item.event_title,
      count: item[countKey],
      percent: item[percentKey],
      checkInRate: item.check_in_rate_percent,
      color: CHART_COLORS[index % CHART_COLORS.length]
    }));

  const soldSlices = makeSlices("sold_count", "sold_share_percent");
  const checkedInSlices = makeSlices("checked_in_count", "checked_in_share_percent");
  const notCheckedSlices = makeSlices("not_checked_in_count", "not_checked_in_share_percent");

  const openForEvent = (category, targetEventId) => onOpenDetail(category, "event", targetEventId);
  const openForAll = (category) => onOpenDetail(category, "all");

  return (
    <>
      <div className="stats-grid stats-grid-compact">
        <StatCard label="Мероприятий" value={data.events_count} />
        <StatCard
          label="Всего продано"
          value={data.total_sold}
          onOpen={() => openForAll("sold")}
          disabled={!data.total_sold}
        />
        <StatCard
          label="Всего прошли"
          value={data.total_checked_in}
          onOpen={() => openForAll("checked_in")}
          disabled={!data.total_checked_in}
        />
        <StatCard
          label="Всего не пришли"
          value={data.total_not_checked_in}
          onOpen={() => openForAll("not_checked_in")}
          disabled={!data.total_not_checked_in}
        />
        <StatCard label="Общий % прохода" value={`${data.check_in_rate_percent}%`} />
      </div>

      <div className="stats-visual stats-visual-multi">
        <MultiEventPieChart
          title="Доля проданных билетов"
          centerLabel={`${data.total_sold}`}
          slices={soldSlices}
          onSliceClick={(id) => openForEvent("sold", id)}
          onOpenAll={data.total_sold ? () => openForAll("sold") : undefined}
        />
        <MultiEventPieChart
          title="Доля прошедших на вход"
          centerLabel={`${data.total_checked_in}`}
          slices={checkedInSlices}
          onSliceClick={(id) => openForEvent("checked_in", id)}
          onOpenAll={data.total_checked_in ? () => openForAll("checked_in") : undefined}
        />
        <MultiEventPieChart
          title="Доля не пришедших"
          centerLabel={`${data.total_not_checked_in}`}
          slices={notCheckedSlices}
          onSliceClick={(id) => openForEvent("not_checked_in", id)}
          onOpenAll={data.total_not_checked_in ? () => openForAll("not_checked_in") : undefined}
        />
      </div>
    </>
  );
}

function StatsPanels({ stats, onOpenDetail }) {
  if (!stats) return null;

  const soldCount = stats.sold_count || 0;
  const gateTotal = (stats.gate_allow_count || 0) + (stats.gate_deny_count || 0);

  return (
    <>
      <div className="stats-visual">
        <article className="stat-card chart-card">
          <p className="muted">Посещаемость</p>
          <div
            className="donut-chart"
            style={{ "--p": `${Math.min(Math.max(stats.check_in_rate_percent, 0), 100)}%` }}
          >
            <span>{stats.check_in_rate_percent}%</span>
          </div>
        </article>

        <article className="stat-card chart-card">
          <p className="muted">Проход / Не пришли</p>
          <div className="bar-group">
            <BarRow
              label="Прошли"
              count={stats.checked_in_count}
              widthPercent={soldCount ? (stats.checked_in_count / soldCount) * 100 : 0}
              barClass="ok"
              onOpen={() => onOpenDetail("checked_in")}
              disabled={!stats.checked_in_count}
            />
            <BarRow
              label="Не пришли"
              count={stats.not_checked_in_count}
              widthPercent={soldCount ? (stats.not_checked_in_count / soldCount) * 100 : 0}
              barClass="warn"
              onOpen={() => onOpenDetail("not_checked_in")}
              disabled={!stats.not_checked_in_count}
            />
          </div>
        </article>

        <article className="stat-card chart-card">
          <p className="muted">Результаты сканирования</p>
          <div className="bar-group">
            <BarRow
              label="Допуск"
              count={stats.gate_allow_count}
              widthPercent={gateTotal ? (stats.gate_allow_count / gateTotal) * 100 : 0}
              barClass="ok"
              onOpen={() => onOpenDetail("gate_allow")}
              disabled={!stats.gate_allow_count}
            />
            <BarRow
              label="Отказы"
              count={stats.gate_deny_count}
              widthPercent={gateTotal ? (stats.gate_deny_count / gateTotal) * 100 : 0}
              barClass="deny"
              onOpen={() => onOpenDetail("gate_deny")}
              disabled={!stats.gate_deny_count}
            />
          </div>
        </article>
      </div>

      <div className="stats-grid">
        <StatCard
          label="Продано билетов"
          value={stats.sold_count}
          onOpen={() => onOpenDetail("sold")}
          disabled={!stats.sold_count}
        />
        <StatCard
          label="Прошли на вход"
          value={stats.checked_in_count}
          onOpen={() => onOpenDetail("checked_in")}
          disabled={!stats.checked_in_count}
        />
        <StatCard
          label="Не пришли"
          value={stats.not_checked_in_count}
          onOpen={() => onOpenDetail("not_checked_in")}
          disabled={!stats.not_checked_in_count}
        />
        <StatCard label="Процент прохода" value={`${stats.check_in_rate_percent}%`} />
        <StatCard
          label="Повторные QR-попытки"
          value={stats.repeated_qr_attempts}
          onOpen={() => onOpenDetail("repeated_qr")}
          disabled={!stats.repeated_qr_attempts}
        />
      </div>
    </>
  );
}

export default function StatsPage() {
  const { events } = useAuth();
  const [eventId, setEventId] = useState(ALL_EVENTS_VALUE);
  const [byEventStats, setByEventStats] = useState(null);
  const [stats, setStats] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [modalCategory, setModalCategory] = useState(null);
  const [modalItems, setModalItems] = useState([]);
  const [modalLoading, setModalLoading] = useState(false);
  const [modalError, setModalError] = useState("");
  const [detailScope, setDetailScope] = useState("all");
  const [modalEventId, setModalEventId] = useState(null);
  const [modalEventTitle, setModalEventTitle] = useState("");

  useEffect(() => {
    setModalCategory(null);
    setModalItems([]);
    setModalError("");
    setModalLoading(false);

    if (eventId === ALL_EVENTS_VALUE) {
      setStats(null);
      loadByEventStats();
      return;
    }

    if (!eventId) {
      setByEventStats(null);
      setStats(null);
      setLoading(false);
      return;
    }

    setByEventStats(null);
    loadStats(eventId);
  }, [eventId]);

  useEffect(() => {
    function onKeyDown(event) {
      if (event.key === "Escape") {
        closeModal();
      }
    }
    if (modalCategory) {
      window.addEventListener("keydown", onKeyDown);
      return () => window.removeEventListener("keydown", onKeyDown);
    }
    return undefined;
  }, [modalCategory]);

  async function loadByEventStats() {
    setLoading(true);
    setError("");
    try {
      const { data } = await api.get("/stats/by-event");
      setByEventStats(data);
    } catch (err) {
      setByEventStats(null);
      setError(err?.response?.data?.detail || "Не удалось загрузить сводную статистику");
    } finally {
      setLoading(false);
    }
  }

  async function loadStats(selectedEventId) {
    setLoading(true);
    setError("");
    try {
      const { data } = await api.get(`/events/${selectedEventId}/stats`);
      setStats(data);
    } catch (err) {
      setStats(null);
      setError(err?.response?.data?.detail || "Не удалось загрузить статистику");
    } finally {
      setLoading(false);
    }
  }

  function closeModal() {
    setModalCategory(null);
    setModalItems([]);
    setModalError("");
    setModalLoading(false);
    setModalEventId(null);
    setModalEventTitle("");
  }

  async function openDetails(category, scope, targetEventId = null) {
    if (!STAT_MODALS[category]) return;
    if (scope === "event" && !targetEventId) return;

    const eventMeta =
      scope === "event"
        ? events.find((event) => String(event.id) === String(targetEventId)) ||
          byEventStats?.items?.find((item) => item.event_id === Number(targetEventId))
        : null;

    setDetailScope(scope);
    setModalEventId(targetEventId);
    setModalEventTitle(eventMeta?.title || eventMeta?.event_title || "");
    setModalCategory(category);
    setModalItems([]);
    setModalError("");
    setModalLoading(true);

    const url =
      scope === "all"
        ? `/stats/details/${category}`
        : `/events/${targetEventId}/stats/details/${category}`;

    try {
      const { data } = await api.get(url);
      setModalItems(data.items || []);
    } catch (err) {
      setModalError(err?.response?.data?.detail || "Не удалось загрузить детали");
    } finally {
      setModalLoading(false);
    }
  }

  const modalConfig = modalCategory ? STAT_MODALS[modalCategory] : null;
  const showEventColumn = detailScope === "all";
  const modalColumns = modalConfig
    ? showEventColumn
      ? [EVENT_TITLE_COLUMN, ...modalConfig.columns]
      : modalConfig.columns
    : [];

  const isAllEvents = eventId === ALL_EVENTS_VALUE;

  return (
    <>
      <section className="card page-head">
        <h2>Аналитика</h2>
        <p className="muted">
          Выберите «Все мероприятия» для сводных диаграмм или конкретное событие. Нажимайте на сегменты и
          показатели для деталей.
        </p>
      </section>

      <section className="card stats-section">
        <label>
          Мероприятие
          <select value={eventId} onChange={(e) => setEventId(e.target.value)}>
            <option value={ALL_EVENTS_VALUE}>Все мероприятия</option>
            {events.map((event) => (
              <option value={event.id} key={event.id}>
                {event.title} — {event.venue_name}
              </option>
            ))}
          </select>
        </label>

        {loading && <p className="muted">Загрузка...</p>}
        {error && <p className="error">{error}</p>}

        {!loading && !error && isAllEvents && byEventStats && (
          <StatsByEventPanels
            data={byEventStats}
            onOpenDetail={(category, scope, targetEventId) => openDetails(category, scope, targetEventId)}
          />
        )}

        {!loading && !error && !isAllEvents && stats && (
          <StatsPanels
            stats={stats}
            onOpenDetail={(category) => openDetails(category, "event", eventId)}
          />
        )}
      </section>

      {modalCategory && modalConfig && (
        <div className="stats-modal-backdrop" onClick={closeModal} role="presentation">
          <div
            className="stats-modal"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="stats-modal-title"
          >
            <header className="stats-modal-header">
              <div>
                <h3 id="stats-modal-title">
                  {modalConfig.title}
                  {detailScope === "all"
                    ? " (все мероприятия)"
                    : modalEventTitle
                      ? ` — ${modalEventTitle}`
                      : ""}
                </h3>
                <p className="muted">Записей: {modalLoading ? "…" : modalItems.length}</p>
              </div>
              <button type="button" className="stats-modal-close" onClick={closeModal} aria-label="Закрыть">
                ×
              </button>
            </header>

            {modalLoading && <p className="muted">Загрузка...</p>}
            {modalError && <p className="error">{modalError}</p>}

            {!modalLoading && !modalError && modalItems.length === 0 && (
              <p className="muted">Нет записей для отображения.</p>
            )}

            {!modalLoading && !modalError && modalItems.length > 0 && (
              <div className="stats-modal-table-wrap">
                <table className="stats-detail-table">
                  <thead>
                    <tr>
                      {modalColumns.map((column) => (
                        <th key={column.key}>{column.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {modalItems.map((item, index) => (
                      <tr key={`${modalCategory}-${detailScope}-${modalEventId}-${index}`}>
                        {modalColumns.map((column) => (
                          <td key={column.key}>{formatCellValue(item[column.key], column.format)}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
