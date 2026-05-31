let loadPromise = null;

export function getYandexMapsApiKey() {
  return (import.meta.env.VITE_YANDEX_MAPS_API_KEY || "").trim();
}

export function loadYmaps() {
  const apiKey = getYandexMapsApiKey();
  if (!apiKey) {
    return Promise.reject(new Error("Yandex Maps API key is not configured"));
  }
  if (window.ymaps) {
    return Promise.resolve(window.ymaps);
  }
  if (loadPromise) {
    return loadPromise;
  }

  const params = new URLSearchParams({
    lang: "ru_RU",
    apikey: apiKey,
    suggest_apikey: apiKey
  });

  loadPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `https://api-maps.yandex.ru/2.1/?${params.toString()}`;
    script.async = true;
    script.onload = () => {
      if (window.ymaps) {
        resolve(window.ymaps);
      } else {
        reject(new Error("Yandex Maps failed to initialize"));
      }
    };
    script.onerror = () => reject(new Error("Failed to load Yandex Maps script"));
    document.head.appendChild(script);
  });

  return loadPromise;
}
