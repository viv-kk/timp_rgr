import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import DateInputField from "../components/DateInputField";
import { useAuth } from "../context/AuthContext";
import {
  buildIsoDateTime,
  formatTimeTyping,
  isValidDateValue,
  isValidTimeValue,
  normalizeTimeOnBlur,
  validateDateTimeFields
} from "../utils/dateTime";

const defaultEventForm = {
  title: "",
  venue_id: "",
  starts_date: "",
  starts_time: ""
};

export default function AdminEventsPage() {
  const { me, events, loadEvents } = useAuth();
  const [venues, setVenues] = useState([]);
  const [venuesLoaded, setVenuesLoaded] = useState(false);
  const [eventForm, setEventForm] = useState(defaultEventForm);
  const [createErrors, setCreateErrors] = useState({});
  const [formError, setFormError] = useState("");

  useEffect(() => {
    loadVenues();
  }, []);

  async function loadVenues() {
    setVenuesLoaded(false);
    try {
      const { data } = await api.get("/venues");
      setVenues(data);
    } catch {
      setVenues([]);
    } finally {
      setVenuesLoaded(true);
    }
  }

  async function createEvent(event) {
    event.preventDefault();
    const errors = {
      ...validateDateTimeFields(eventForm.starts_date, eventForm.starts_time),
      title: eventForm.title.trim() ? "" : "Поле обязательно",
      venue_id: eventForm.venue_id ? "" : "Выбери площадку"
    };
    setCreateErrors(errors);
    if (Object.values(errors).some(Boolean)) return;
    setFormError("");

    const startsAtIso = buildIsoDateTime(eventForm.starts_date, eventForm.starts_time);
    if (!startsAtIso) return;

    try {
      await api.post("/events", {
        title: eventForm.title,
        venue_id: Number(eventForm.venue_id),
        starts_at: startsAtIso
      });
      setEventForm(defaultEventForm);
      setCreateErrors({});
      loadEvents();
    } catch (error) {
      setFormError(error?.response?.data?.detail || "Не удалось создать мероприятие");
    }
  }

  async function removeEvent(eventId) {
    const confirmed = window.confirm("Удалить мероприятие? Если по нему есть билеты, удаление будет запрещено.");
    if (!confirmed) return;
    try {
      await api.delete(`/events/${eventId}`);
      loadEvents();
    } catch (error) {
      setFormError(error?.response?.data?.detail || "Не удалось удалить мероприятие");
    }
  }

  function handleCreateTimeChange(e) {
    setEventForm((prev) => ({ ...prev, starts_time: formatTimeTyping(e.target.value) }));
    setCreateErrors((prev) => ({ ...prev, starts_time: "" }));
  }

  function handleCreateTimeBlur(e) {
    const normalized = normalizeTimeOnBlur(e.target.value);
    setEventForm((prev) => ({ ...prev, starts_time: normalized }));
    if (normalized && !isValidTimeValue(normalized)) {
      setCreateErrors((prev) => ({ ...prev, starts_time: "Некорректное время. Формат: ЧЧ:ММ" }));
    }
  }

  if (me?.role !== "manager") {
    return (
      <section className="card">
        <h2>Доступ ограничен</h2>
        <p>Страница доступна только менеджеру.</p>
      </section>
    );
  }

  return (
    <>
      <section className="card page-head">
        <h2>Управление мероприятиями</h2>
        <p className="muted">Создавай мероприятия и привязывай их к существующим площадкам.</p>
      </section>

      <form className="card" onSubmit={createEvent} noValidate>
        <h3>Создать мероприятие</h3>
        <label>
          Название
          <input
            value={eventForm.title}
            onChange={(e) => {
              setEventForm({ ...eventForm, title: e.target.value });
              setCreateErrors((prev) => ({ ...prev, title: "" }));
            }}
            className={createErrors.title ? "input-error" : ""}
            required
          />
          {createErrors.title && <span className="field-error">{createErrors.title}</span>}
        </label>
        {venuesLoaded && venues.length === 0 && (
          <p className="error">Сначала создай площадку во вкладке "Управление площадками".</p>
        )}
        <label>
          Площадка
          <select
            value={eventForm.venue_id}
            onChange={(e) => {
              setEventForm({ ...eventForm, venue_id: e.target.value });
              setCreateErrors((prev) => ({ ...prev, venue_id: "" }));
            }}
            className={createErrors.venue_id ? "input-error" : ""}
            required
            disabled={!venuesLoaded || venues.length === 0}
          >
            <option value="">Выбери площадку</option>
            {venues.map((venue) => (
              <option key={venue.id} value={venue.id}>
                {venue.name}
              </option>
            ))}
          </select>
          {createErrors.venue_id && <span className="field-error">{createErrors.venue_id}</span>}
        </label>
        <div className="datetime-grid">
          <DateInputField
            label="Дата (ДД.ММ.ГГГГ)"
            value={eventForm.starts_date}
            onChange={(value) => {
              setEventForm((prev) => ({ ...prev, starts_date: value }));
              setCreateErrors((prev) => ({ ...prev, starts_date: "" }));
            }}
            onBlurValidate={(normalized) => {
              if (normalized && !isValidDateValue(normalized)) {
                setCreateErrors((prev) => ({
                  ...prev,
                  starts_date: "Некорректная дата. Формат: ДД.ММ.ГГГГ"
                }));
              }
            }}
            error={createErrors.starts_date}
            required
          />
          <label>
            Время (ЧЧ:ММ)
            <input
              type="text"
              inputMode="numeric"
              placeholder="Например, 19:30"
              value={eventForm.starts_time}
              onChange={handleCreateTimeChange}
              onBlur={handleCreateTimeBlur}
              maxLength={5}
              className={createErrors.starts_time ? "input-error" : ""}
              required
            />
            <span className={`field-error ${createErrors.starts_time ? "" : "field-error-placeholder"}`}>
              {createErrors.starts_time || " "}
            </span>
          </label>
        </div>
        <button type="submit" disabled={!venuesLoaded || venues.length === 0}>
          Создать
        </button>
        {formError && <p className="error">{formError}</p>}
      </form>

      <section className="card">
        <h3>Список мероприятий</h3>
        {events.length === 0 ? (
          <p>Пока нет созданных мероприятий.</p>
        ) : (
          <ul className="list list-actions">
            {events.map((event) => (
              <li key={event.id}>
                <span>
                  {event.title} — {event.venue_name} (
                  {new Date(event.starts_at).toLocaleString("ru-RU", {
                    day: "2-digit",
                    month: "2-digit",
                    year: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                    hour12: false
                  })})
                </span>
                <div className="item-actions">
                  <Link to={`/admin/events/${event.id}/edit`} className="button-link">
                    Редактировать
                  </Link>
                  <button type="button" onClick={() => removeEvent(event.id)}>
                    Удалить
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
