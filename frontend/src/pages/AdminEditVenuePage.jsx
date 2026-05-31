import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import YandexAddressPicker from "../components/YandexAddressPicker";
import { useAuth } from "../context/AuthContext";

const defaultVenueForm = {
  name: "",
  address: "",
  capacity: ""
};

export default function AdminEditVenuePage() {
  const { me } = useAuth();
  const { venueId } = useParams();
  const navigate = useNavigate();
  const [venueForm, setVenueForm] = useState(defaultVenueForm);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [nameError, setNameError] = useState("");
  const [capacityError, setCapacityError] = useState("");
  const [formError, setFormError] = useState("");

  useEffect(() => {
    loadVenue();
  }, [venueId]);

  async function loadVenue() {
    setLoading(true);
    setNotFound(false);
    try {
      const { data } = await api.get("/venues");
      const venue = data.find((item) => item.id === Number(venueId));
      if (!venue) {
        setNotFound(true);
        return;
      }
      setVenueForm({
        name: venue.name || "",
        address: venue.address || "",
        capacity: venue.capacity ? String(venue.capacity) : ""
      });
    } catch {
      setNotFound(true);
    } finally {
      setLoading(false);
    }
  }

  async function saveVenue(event) {
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
      await api.put(`/venues/${venueId}`, {
        name: venueName,
        address: venueForm.address || null,
        capacity: parsedCapacity
      });
      navigate("/admin/venues");
    } catch (error) {
      setFormError(error?.response?.data?.detail || "Не удалось обновить площадку");
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
        <p>Загрузка площадки...</p>
      </section>
    );
  }

  if (notFound) {
    return (
      <section className="card">
        <h2>Площадка не найдена</h2>
        <Link to="/admin/venues">Вернуться к площадкам</Link>
      </section>
    );
  }

  return (
    <form className="card" onSubmit={saveVenue} noValidate>
      <h2>Редактировать площадку</h2>
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
        />
        <span className={`field-error ${capacityError ? "" : "field-error-placeholder"}`}>
          {capacityError || "."}
        </span>
      </label>
      {formError && <p className="error">{formError}</p>}
      <div className="item-actions">
        <button type="submit">Сохранить</button>
        <Link to="/admin/venues" className="button-link">
          Отмена
        </Link>
      </div>
    </form>
  );
}
