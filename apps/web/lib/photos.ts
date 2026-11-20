"use client";
/** iPhone photos (HEIC) -> compressed JPEG that Clover accepts. Runs in the browser. */
export async function toCloverJpeg(file: File): Promise<File> {
  let input: Blob = file;
  const isHeic = /heic|heif/i.test(file.type) || /\.(heic|heif)$/i.test(file.name);
  if (isHeic) {
    const heic2any = (await import("heic2any")).default;
    const out = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.85 });
    input = Array.isArray(out) ? out[0] : out;
  }
  const imageCompression = (await import("browser-image-compression")).default;
  const asFile = new File([input], file.name.replace(/\.\w+$/, "") + ".jpg", { type: input.type || "image/jpeg" });
  const compressed = await imageCompression(asFile, { maxSizeMB: 2, maxWidthOrHeight: 2400, fileType: "image/jpeg", useWebWorker: true });
  return new File([compressed], asFile.name, { type: "image/jpeg" });
}
