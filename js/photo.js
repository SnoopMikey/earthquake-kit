// Camera photo capture via a hidden <input type="file" capture>, plus
// client-side downscaling so uploads stay small (Airtable caps at 5 MB).

export function pickPhoto(inputEl) {
  return new Promise((resolve) => {
    inputEl.value = "";
    inputEl.onchange = () => resolve(inputEl.files[0] || null);
    inputEl.click();
  });
}

// Decode via <img> (which applies EXIF orientation), downscale on a canvas,
// and return JPEG data ready for preview + Airtable upload.
export async function fileToJpeg(file, maxDim = 1280, quality = 0.82) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    canvas.getContext("2d").drawImage(img, 0, 0, w, h);
    const dataUrl = canvas.toDataURL("image/jpeg", quality);
    return { dataUrl, base64: dataUrl.split(",")[1], contentType: "image/jpeg" };
  } finally {
    URL.revokeObjectURL(url);
  }
}
