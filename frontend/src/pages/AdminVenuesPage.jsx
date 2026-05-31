import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import YandexAddressPicker from "../components/YandexAddressPicker";
import { useAuth } from "../context/AuthContext";

const defaultVenueForm = {
  name: "",
  address: "",
  capacity: ""
};

export default function AdminVenuesPage() {
  const { me } = useAuth();
  const [venues, setVenues] = useState([]);
  const [venueForm, setVenueForm] = useState(defaultVenueForm);
  const [nameError, setNameError] = useState("");
  const [capacityError, setCapacityError] = useState("");
  const [formError, setFormError] = useState("");

  useEffect(() => {
    loadVenues();
  }, []);

  async function loadVenues() {
    try {
      const { data } = await api.get("/venues");
      setVenues(data);
    } catch {
      setVenues([]);
    }
  }

  async function createVenue(event) {
    event.preventDefault();
    setFormError("");
    const venueName = venueForm.name.trim();
    if (!venueName) {
      setNameError("Поле обязательно");
      return;
    }
    setNameError("");
    const rawCapacity = venueForm.capacity.trim();
    let parsedCapacity = null;
    if (rawCapacity) {
      parsedCapacity = Number(rawCapacity);
      if (!Number.isInteger(parsedCapacity)) {
        setCapacityError("Поле должно содержать целое число");
        return;
      }
      if (parsedCapacity < 1) {
        setCapacityError("Вместимость должна быть не меньше 1");
        return;
      }
    }
    setCapacityError("");
    try {
      await api.post("/venues", {
        name: venueName,
        address: venueForm.address || null,
        capacity: parsedCapacity
      });
      setVenueForm(defaultVenueForm);
      loadVenues();
      setNameError("");
      setCapacityError("");
    } catch (error) {
      setFormError(error?.response?.data?.detail || "Не удалось создать площадку");
    }
  }

  async function removeVenue(venueId) {
    const confirmed = window.confirm("Удалить площадку? Если есть связанные мероприятия, удаление будет запрещено.");
    if (!confirmed) return;
    try {
      await api.delete(`/venues/${venueId}`);
      loadVenues();
    } catch (error) {
      setFormError(error?.response?.data?.detail || "Не удалось удалить площадку");
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
        <h2>Управление площадками</h2>
        <p className="muted">Создавай площадки, которые затем можно выбирать при создании мероприятий.</p>
      </section>

      <form className="card" onSubmit={createVenue} noValidate>
        <h3>Создать площадку</h3>
        <label>
          Название площадки
          <input
            value={venueForm.name}
            onChange={(e) => {
              setVenueForm({ ...venueForm, name: e.target.value });
              if (nameError) setNameError("");
            }}
            className={nameError ? "input-error" : ""}
            required
          />
          {nameError && <span className="field-error">{nameError}</span>}
        </label>
        <label>
          Адрес
          <YandexAddressPicker
            value={venueForm.address}
            onChange={(address) => setVenueForm({ ...venueForm, address })}
          />
        </label>
        <label>
          Вместимость
          <input
            type="text"
            inputMode="numeric"
            value={venueForm.capacity}
            onChange={(e) => {
              setVenueForm({ ...venueForm, capacity: e.target.value });
              if (capacityError) setCapacityError("");
            }}
            className={capacityError ? "input-error" : ""}
            placeholder="Например 10000"
          />
          <span className={`field-error ${capacityError ? "" : "field-error-placeholder"}`}>
            {capacityError || "."}
          </span>
        </label>
        {formError && <p className="error">{formError}</p>}
        <button type="submit">Создать площадку</button>
      </form>

      <section className="card">
        <h3>Список площадок</h3>
        {venues.length === 0 ? (
          <p>Площадки пока не созданы.</p>
        ) : (
          <ul className="list list-actions">
            {venues.map((venue) => (
              <li key={venue.id}>
                <span>
                  {venue.name}
                  {venue.address ? ` — ${venue.address}` : ""}
                  {venue.capacity ? ` (вместимость: ${venue.capacity})` : ""}
                </span>
                <div className="item-actions">
                  <Link to={`/admin/venues/${venue.id}/edit`} className="button-link">
                    Редактировать
                  </Link>
                  <button type="button" onClick={() => removeVenue(venue.id)}>
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
