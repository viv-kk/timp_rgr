import { useEffect, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { api } from "../api";

export default function GatePage() {
  const [qrToken, setQrToken] = useState("");
  const [qrTokenError, setQrTokenError] = useState("");
  const [scanResult, setScanResult] = useState(null);
  const [cameraError, setCameraError] = useState("");
  const [scanHint, setScanHint] = useState("");
  const [isCameraScanning, setIsCameraScanning] = useState(false);
  const [cameraBoxVisible, setCameraBoxVisible] = useState(false);
  const [isFileScanning, setIsFileScanning] = useState(false);
  const scannerRef = useRef(null);
  const processingScanRef = useRef(false);
  const scannerElementId = "gate-camera-scanner";

  useEffect(() => {
    return () => {
      stopCameraScanner();
    };
  }, []);

  async function scanTicket(event) {
    event.preventDefault();
    if (!qrToken.trim()) {
      setQrTokenError("Поле обязательно");
      return;
    }
    setQrTokenError("");
    await submitScannedToken(qrToken);
  }

  async function submitScannedToken(tokenValue) {
    try {
      const { data } = await api.post("/gate/scan", { scan_value: tokenValue.trim() });
      setScanResult(data);
      setScanHint("");
    } catch (error) {
      const detail = error?.response?.data?.detail || "Ошибка проверки QR";
      setScanResult({ allowed: false, message: detail });
    }
  }

  function getQrboxSize() {
    const viewportWidth = window.innerWidth || 360;
    const viewportHeight = window.innerHeight || 640;
    const sizeByWidth = Math.floor(viewportWidth * 0.72);
    const sizeByHeight = Math.floor(viewportHeight * 0.42);
    return Math.max(190, Math.min(sizeByWidth, sizeByHeight, 340));
  }

  async function startCameraScanner() {
    if (isCameraScanning) return;
    setCameraError("");
    setScanHint("");
    setCameraBoxVisible(true);
    await new Promise((resolve) => requestAnimationFrame(resolve));

    try {
      if (!scannerRef.current) {
        scannerRef.current = new Html5Qrcode(scannerElementId);
      }

      await scannerRef.current.start(
        { facingMode: "environment" },
        { fps: 12, qrbox: { width: getQrboxSize(), height: getQrboxSize() }, aspectRatio: 1 },
        async (decodedText) => {
          if (processingScanRef.current) return;
          processingScanRef.current = true;
          setQrToken(decodedText);
          setScanHint("Код считан. Выполняем автоматическую проверку...");
          await submitScannedToken(decodedText);
          await stopCameraScanner();
          processingScanRef.current = false;
        },
        () => {}
      );
      setIsCameraScanning(true);
    } catch {
      setCameraError("Не удалось запустить камеру. Разреши доступ к камере в браузере.");
      setIsCameraScanning(false);
      setCameraBoxVisible(false);
    }
  }

  async function stopCameraScanner() {
    if (!scannerRef.current || !scannerRef.current.isScanning) return;
    try {
      await scannerRef.current.stop();
      await scannerRef.current.clear();
    } catch {
    } finally {
      processingScanRef.current = false;
      setIsCameraScanning(false);
      setCameraBoxVisible(false);
    }
  }

  async function scanQrFromFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    setCameraError("");
    setIsFileScanning(true);

    try {
      await stopCameraScanner();
      if (!scannerRef.current) {
        scannerRef.current = new Html5Qrcode(scannerElementId);
      }
      const decodedText = await scannerRef.current.scanFile(file, false);
      setQrToken(decodedText);
      setScanHint("Код распознан из изображения. Нажми «Проверить код».");
    } catch {
      setCameraError("Не удалось распознать QR на изображении. Попробуй другое фото.");
    } finally {
      event.target.value = "";
      setIsFileScanning(false);
    }
  }

  return (
    <>
      <section className="card page-head">
        <h2>Контроль входа</h2>
        <p className="muted">Используй камеру, изображение или ручной ввод для проверки билета.</p>
      </section>

      <form className="card" onSubmit={scanTicket} noValidate>
        <h3>Проверка QR</h3>
        <p className="muted">Можно сканировать камерой, загрузить фото QR или ввести короткий 8-значный код вручную.</p>
        <div className="camera-actions">
          <button type="button" onClick={startCameraScanner} disabled={isCameraScanning}>
            Запустить камеру
          </button>
          <button type="button" onClick={stopCameraScanner} disabled={!isCameraScanning}>
            Остановить камеру
          </button>
        </div>
        <label>
          Загрузить фото QR (PNG/JPG)
          <input
            type="file"
            accept="image/png,image/jpeg,image/jpg"
            onChange={scanQrFromFile}
            disabled={isFileScanning}
          />
        </label>
        {cameraError && <p className="error">{cameraError}</p>}
        {scanHint && <p className="muted">{scanHint}</p>}
        <div
          id={scannerElementId}
          className={`camera-box ${cameraBoxVisible ? "visible" : "collapsed"}`}
        />
        <label>
          QR Token или короткий код
          <textarea
            value={qrToken}
            onChange={(e) => {
              setQrToken(e.target.value);
              if (qrTokenError) setQrTokenError("");
            }}
            rows={4}
            className={qrTokenError ? "input-error" : ""}
            required
          />
          <span className={`field-error ${qrTokenError ? "" : "field-error-placeholder"}`}>
            {qrTokenError || "."}
          </span>
        </label>
        <button type="submit">Проверить код</button>
      </form>

      {scanResult && (
        <section className={`card ${scanResult.allowed ? "success" : "error"}`}>
          <h3>{scanResult.allowed ? "Разрешено" : "Отказ"}</h3>
          <p>{scanResult.message}</p>
          {scanResult.ticket_id && <p>Ticket ID: {scanResult.ticket_id}</p>}
        </section>
      )}
    </>
  );
}
