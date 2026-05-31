import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import DateInputField from "../components/DateInputField";
import { useAuth } from "../context/AuthContext";
import {
  buildIsoDateTime,
  formatTimeTyping,
  isValidDateValue,
  isValidTimeValue,
  normalizeTimeOnBlur,
  toDateInputValue,
  toTimeInputValue,
  validateDateTimeFields
} from "../utils/dateTime";

const defaultEventForm = {
  title: "",
  venue_id: "",
  starts_date: "",
  starts_time: ""
};

export default function AdminEditEventPage() {
  const { me } = useAuth();
  const { eventId } = useParams();
  const navigate = useNavigate();
  const [venues, setVenues] = useState([]);
  const [eventForm, setEventForm] = useState(defaultEventForm);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState("");
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    loadPageData();
  }, [eventId]);

  async function loadPageData() {
    setLoading(true);
    setNotFound(false);
    try {
      const [venuesRes, eventsRes] = await Promise.all([api.get("/venues"), api.get("/events")]);
      const availableVenues = venuesRes.data || [];
      const eventItem = (eventsRes.data || []).find((item) => item.id === Number(eventId));
      if (!eventItem) {
        setNotFound(true);
        return;
      }

      const startsAtDate = eventItem.starts_at ? new Date(eventItem.starts_at) : null;
      const venueId =
        eventItem.venue_id ?? availableVenues.find((venue) => venue.name === eventItem.venue_name)?.id ?? "";

      setVenues(availableVenues);
      setEventForm({
        title: eventItem.title,
        venue_id: venueId ? String(venueId) : "",
        starts_date: startsAtDate ? toDateInputValue(startsAtDate) : "",
        starts_time: startsAtDate ? toTimeInputValue(startsAtDate) : ""
      });
      setErrors({});
    } catch {
      setNotFound(true);
    } finally {
      setLoading(false);
    }
  }

  async function saveEvent(event) {
    event.preventDefault();
    const formErrors = {
      ...validateDateTimeFields(eventForm.starts_date, eventForm.starts_time),
      title: eventForm.title.trim() ? "" : "Поле обязательно",
      venue_id: eventForm.venue_id ? "" : "Выбери площадку"
    };
    setErrors(formErrors);
    if (Object.values(formErrors).some(Boolean)) return;
    setFormError("");

    const startsAtIso = buildIsoDateTime(eventForm.starts_date, eventForm.starts_time);
    if (!startsAtIso) return;

    try {
      await api.put(`/events/${eventId}`, {
        title: eventForm.title,
        venue_id: Number(eventForm.venue_id),
        starts_at: startsAtIso
      });
      navigate("/admin/events");
    } catch (error) {
      setFormError(error?.response?.data?.detail || "Не удалось обновить мероприятие");
    }
  }

  function handleTimeChange(e) {
    setEventForm((prev) => ({ ...prev, starts_time: formatTimeTyping(e.target.value) }));
    setErrors((prev) => ({ ...prev, starts_time: "" }));
  }

  function handleTimeBlur(e) {
    const normalized = normalizeTimeOnBlur(e.target.value);
    setEventForm((prev) => ({ ...prev, starts_time: normalized }));
    if (normalized && !isValidTimeValue(normalized)) {
      setErrors((prev) => ({ ...prev, starts_time: "Некорректное время. Формат: ЧЧ:ММ" }));
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

  if (loading) {
    return (
      <section className="card">
        <p>Загрузка мероприятия...</p>
      </section>
    );
  }

  if (notFound) {
    return (
      <section className="card">
        <h2>Мероприятие не найдено</h2>
        <Link to="/admin/events">Вернуться к мероприятиям</Link>
      </section>
    );
  }

  return (
    <form className="card" onSubmit={saveEvent} noValidate>
      <h2>Редактировать мероприятие</h2>
      <label>
        Название
        <input
          value={eventForm.title}
          onChange={(e) => {
            setEventForm({ ...eventForm, title: e.target.value });
            setErrors((prev) => ({ ...prev, title: "" }));
          }}
          className={errors.title ? "input-error" : ""}
          required
        />
        {errors.title && <span className="field-error">{errors.title}</span>}
      </label>
      <label>
        Площадка
        <select
          value={eventForm.venue_id}
          onChange={(e) => {
            setEventForm({ ...eventForm, venue_id: e.target.value });
            setErrors((prev) => ({ ...prev, venue_id: "" }));
          }}
          className={errors.venue_id ? "input-error" : ""}
          required
          disabled={venues.length === 0}
        >
          <option value="">Выбери площадку</option>
          {venues.map((venue) => (
            <option key={venue.id} value={venue.id}>
              {venue.name}
            </option>
          ))}
        </select>
        {errors.venue_id && <span className="field-error">{errors.venue_id}</span>}
      </label>

      <div className="datetime-grid">
        <DateInputField
          label="Дата (ДД.ММ.ГГГГ)"
          value={eventForm.starts_date}
          onChange={(value) => {
            setEventForm((prev) => ({ ...prev, starts_date: value }));
            setErrors((prev) => ({ ...prev, starts_date: "" }));
          }}
          onBlurValidate={(normalized) => {
            if (normalized && !isValidDateValue(normalized)) {
              setErrors((prev) => ({
                ...prev,
                starts_date: "Некорректная дата. Формат: ДД.ММ.ГГГГ"
              }));
            }
          }}
          error={errors.starts_date}
          required
        />
        <label>
          Время (ЧЧ:ММ)
          <input
            type="text"
            inputMode="numeric"
            placeholder="Например, 19:30"
            value={eventForm.starts_time}
            onChange={handleTimeChange}
            onBlur={handleTimeBlur}
            maxLength={5}
            className={errors.starts_time ? "input-error" : ""}
            required
          />
          <span className={`field-error ${errors.starts_time ? "" : "field-error-placeholder"}`}>
            {errors.starts_time || " "}
          </span>
        </label>
      </div>

      <div className="item-actions">
        <button type="submit">Сохранить</button>
        <Link to="/admin/events" className="button-link">
          Отмена
        </Link>
      </div>
      {formError && <p className="error">{formError}</p>}
    </form>
  );
}
