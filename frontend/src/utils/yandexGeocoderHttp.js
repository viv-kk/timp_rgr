import { api } from "../api";

export async function forwardGeocodeHttp(query) {
  const trimmed = (query || "").trim();
  if (!trimmed) return null;
  const { data } = await api.get("/yandex/geocode", { params: { geocode: trimmed } });
  return data;
}

export async function reverseGeocodeHttp(coords) {
  const [lat, lon] = coords;
  const { data } = await api.get("/yandex/geocode", {
    params: { geocode: `${lon},${lat}` }
  });
  return data;
}

export async function fetchAddressSuggestions(text) {
  const trimmed = (text || "").trim();
  if (trimmed.length < 2) return [];
  const { data } = await api.get("/yandex/suggest", { params: { text: trimmed } });
  return data?.items || [];
}

export async function geocodeByUri(uri) {
  if (!uri) return null;
  const { data } = await api.get("/yandex/geocode", { params: { uri } });
  return data;
}
