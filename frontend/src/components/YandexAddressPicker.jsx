import { useEffect, useId, useRef, useState } from "react";
import {
  fetchAddressSuggestions,
  forwardGeocodeHttp,
  geocodeByUri,
  reverseGeocodeHttp
} from "../utils/yandexGeocoderHttp";
import { getYandexMapsApiKey, loadYmaps } from "../utils/yandexMaps";

const DEFAULT_CENTER = [55.0084, 82.9357];
const DEFAULT_ZOOM = 11;

export default function YandexAddressPicker({
  value,
  onChange,
  placeholder = "Начните вводить адрес или выберите точку на карте"
}) {
  const reactId = useId().replace(/:/g, "");
  const mapContainerId = `yandex-map-${reactId}`;
  const listId = `yandex-suggest-${reactId}`;
  const ymapsRef = useRef(null);
  const placemarkRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const suggestTimerRef = useRef(null);
  const skipSuggestRef = useRef(false);
  const initialValueSyncedRef = useRef(false);

  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [geocodeError, setGeocodeError] = useState("");
  const [geocoding, setGeocoding] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const hasApiKey = Boolean(getYandexMapsApiKey());

  function updatePlacemark(coords, addressText) {
    if (!mapInstanceRef.current || !ymapsRef.current) return;
    const ymaps = ymapsRef.current;

    if (!placemarkRef.current) {
      placemarkRef.current = new ymaps.Placemark(
        coords,
        { iconCaption: addressText || "Площадка" },
        { preset: "islands#blueDotIcon", draggable: true }
      );
      placemarkRef.current.events.add("dragend", () => {
        const draggedCoords = placemarkRef.current.geometry.getCoordinates();
        handleReverseGeocode(draggedCoords);
      });
      mapInstanceRef.current.geoObjects.add(placemarkRef.current);
    } else {
      placemarkRef.current.geometry.setCoordinates(coords);
      placemarkRef.current.properties.set("iconCaption", addressText || "Площадка");
    }
    mapInstanceRef.current.setCenter(coords, 16, { duration: 300 });
  }

  function applyGeocodeResult(result) {
    if (!result) {
      setGeocodeError("Адрес не найден. Уточните запрос или выберите точку на карте.");
      return;
    }
    setGeocodeError("");
    onChange(result.address);
    updatePlacemark(result.coords, result.address);
  }

  async function handleReverseGeocode(coords) {
    setGeocoding(true);
    setGeocodeError("");
    try {
      const result = await reverseGeocodeHttp(coords);
      applyGeocodeResult(result);
    } catch (error) {
      console.error(error);
      setGeocodeError(error.message || "Не удалось определить адрес по координатам.");
    } finally {
      setGeocoding(false);
    }
  }

  async function handleForwardGeocode(query) {
    const trimmed = (query || "").trim();
    if (!trimmed) return;
    setGeocoding(true);
    setGeocodeError("");
    try {
      const result = await forwardGeocodeHttp(trimmed);
      applyGeocodeResult(result);
    } catch (error) {
      console.error(error);
      setGeocodeError(error.message || "Не удалось найти адрес.");
    } finally {
      setGeocoding(false);
    }
  }

  async function handleSelectSuggestion(item) {
    skipSuggestRef.current = true;
    setSuggestOpen(false);
    setSuggestions([]);
    setGeocoding(true);
    setGeocodeError("");
    try {
      const result = item.uri ? await geocodeByUri(item.uri) : await forwardGeocodeHttp(item.address);
      if (result) {
        applyGeocodeResult(result);
      } else {
        onChange(item.address);
      }
    } catch (error) {
      console.error(error);
      onChange(item.address);
      setGeocodeError("Адрес выбран, но не удалось показать точку на карте.");
    } finally {
      setGeocoding(false);
      window.setTimeout(() => {
        skipSuggestRef.current = false;
      }, 0);
    }
  }

  function scheduleSuggestions(text) {
    if (suggestTimerRef.current) {
      window.clearTimeout(suggestTimerRef.current);
    }
    const trimmed = (text || "").trim();
    if (trimmed.length < 2 || skipSuggestRef.current) {
      setSuggestions([]);
      setSuggestOpen(false);
      return;
    }
    suggestTimerRef.current = window.setTimeout(async () => {
      try {
        const items = await fetchAddressSuggestions(trimmed);
        setSuggestions(items);
        setSuggestOpen(items.length > 0);
        setGeocodeError("");
      } catch (error) {
        console.error(error);
        setSuggestions([]);
        setSuggestOpen(false);
      }
    }, 350);
  }

  function handleInputChange(event) {
    const nextValue = event.target.value;
    onChange(nextValue);
    setGeocodeError("");
    scheduleSuggestions(nextValue);
  }

  useEffect(() => {
    if (!hasApiKey) {
      setLoadError("Ключ Яндекс.Карт не задан (VITE_YANDEX_MAPS_API_KEY).");
      return undefined;
    }

    let cancelled = false;

    loadYmaps()
      .then((ymaps) => {
        if (cancelled) return;
        ymapsRef.current = ymaps;
        ymaps.ready(() => {
          if (cancelled || mapInstanceRef.current) return;

          mapInstanceRef.current = new ymaps.Map(
            mapContainerId,
            {
              center: DEFAULT_CENTER,
              zoom: DEFAULT_ZOOM,
              controls: ["zoomControl", "geolocationControl"]
            },
            { suppressMapOpenBlock: true }
          );

          mapInstanceRef.current.events.add("click", (event) => {
            setSuggestOpen(false);
            handleReverseGeocode(event.get("coords"));
          });

          setReady(true);
          setLoadError("");
        });
      })
      .catch((error) => {
        if (!cancelled) {
          setLoadError(error.message || "Не удалось загрузить Яндекс.Карты");
        }
      });

    return () => {
      cancelled = true;
      if (suggestTimerRef.current) {
        window.clearTimeout(suggestTimerRef.current);
      }
      if (mapInstanceRef.current) {
        mapInstanceRef.current.destroy();
        mapInstanceRef.current = null;
      }
      placemarkRef.current = null;
      ymapsRef.current = null;
    };
  }, [hasApiKey, mapContainerId]);

  useEffect(() => {
    if (!ready || initialValueSyncedRef.current) return;
    const trimmed = (value || "").trim();
    if (!trimmed) return;
    initialValueSyncedRef.current = true;
    handleForwardGeocode(trimmed);
  }, [ready, value]);

  if (!hasApiKey) {
    return (
      <div className="yandex-address-picker">
        <input value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
        <p className="yandex-address-hint muted">{loadError}</p>
      </div>
    );
  }

  return (
    <div className="yandex-address-picker">
      <div className="yandex-address-input-wrap">
        <input
          value={value}
          placeholder={placeholder}
          autoComplete="off"
          role="combobox"
          aria-expanded={suggestOpen}
          aria-controls={listId}
          onChange={handleInputChange}
          onFocus={() => {
            if (suggestions.length > 0) setSuggestOpen(true);
          }}
          onBlur={() => {
            window.setTimeout(() => setSuggestOpen(false), 180);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setSuggestOpen(false);
            }
          }}
        />
        {suggestOpen && suggestions.length > 0 ? (
          <ul id={listId} className="yandex-suggest-list" role="listbox">
            {suggestions.map((item, index) => (
              <li key={`${item.address}-${index}`}>
                <button
                  type="button"
                  role="option"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => handleSelectSuggestion(item)}
                >
                  {item.address}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <p className="yandex-address-hint muted">
        {geocoding
          ? "Определяем адрес…"
          : "Подсказки при вводе. Клик по карте или перетаскивание метки задаёт адрес."}
      </p>
      {loadError ? <p className="error">{loadError}</p> : null}
      {geocodeError ? <p className="error">{geocodeError}</p> : null}
      <div id={mapContainerId} className="yandex-map" aria-label="Карта выбора адреса" />
    </div>
  );
}
