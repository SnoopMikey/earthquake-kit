// Camera barcode scanning, backed by html5-qrcode (loaded globally in index.html).

let engine = null;
let handled = false;

export function scannerAvailable() {
  return typeof window.Html5Qrcode !== "undefined" &&
    !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
}

export async function startScan(mountId, onCode) {
  const { Html5Qrcode, Html5QrcodeSupportedFormats: F } = window;
  handled = false;
  engine = new Html5Qrcode(mountId, {
    formatsToSupport: [F.EAN_13, F.EAN_8, F.UPC_A, F.UPC_E],
    verbose: false,
  });
  await engine.start(
    { facingMode: "environment" },
    { fps: 10, qrbox: { width: 260, height: 150 } },
    (text) => {
      if (handled) return; // html5-qrcode can fire repeatedly before stop() resolves
      handled = true;
      stopScan().finally(() => onCode(text));
    },
    () => { /* per-frame decode misses are expected; ignore */ },
  );
}

export async function stopScan() {
  if (!engine) return;
  const e = engine;
  engine = null;
  try {
    await e.stop();
    e.clear();
  } catch { /* already stopped */ }
}
