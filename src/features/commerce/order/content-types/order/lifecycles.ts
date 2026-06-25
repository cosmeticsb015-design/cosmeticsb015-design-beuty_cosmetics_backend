"use client";
// RUTA: src/features/admin/contenido/components/BannerImageField.tsx

import { AlertTriangle, CheckCircle2, ImageIcon, UploadCloud } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

type BannerImageFieldProps = {
  name: string;
  existingUrl?: string | null;
  frameLabel: string;
  recommendedWidth: number;
  recommendedHeight: number;
  // Proporción real que ocupa esta imagen en el Hero (HeroBackgroundSlider.tsx
  // / HeroSection.tsx), para que el recorte "object-cover" que se ve aquí sea
  // lo más parecido posible al recorte real que verá el cliente.
  liveAspectRatio: number;
  helperText?: string;
  // Clases para el ancho del recuadro de previsualización. Por defecto ocupa
  // todo el ancho disponible (sirve para el recuadro horizontal de desktop);
  // para el recuadro vertical de móvil se pasa algo como
  // "mx-auto max-w-[260px]" para que no salga una caja gigante y angosta.
  previewWidthClassName?: string;
};

const RATIO_TOLERANCE = 0.02;
// Las imágenes que pesan más de esto no se aceptan: se avisa de inmediato en
// vez de esperar a que el backend las rechace al guardar.
const MAX_IMAGE_SIZE_BYTES = 1 * 1024 * 1024;

function formatSize(bytes: number) {
  return `${(bytes / (1024 * 1024)).toFixed(2)}MB`;
}

function detectStatus(width: number, height: number, recommendedWidth: number, recommendedHeight: number) {
  const detectedRatio = width / height;
  const recommendedRatio = recommendedWidth / recommendedHeight;
  const exactMatch = width === recommendedWidth && height === recommendedHeight;
  const ratioMatches = Math.abs(detectedRatio - recommendedRatio) / recommendedRatio <= RATIO_TOLERANCE;
  if (exactMatch) return { tone: "ok" as const, message: `Coincide exacto con ${recommendedWidth}×${recommendedHeight}px.` };
  if (ratioMatches) return { tone: "warn" as const, message: `Proporción correcta, tamaño ${width}×${height}px (se reescalará sin recortar).` };
  return { tone: "bad" as const, message: `Proporción distinta a ${recommendedWidth}×${recommendedHeight}px. Strapi/el navegador recortarán al centro, justo como ves arriba.` };
}

export default function BannerImageField({
  name,
  existingUrl,
  frameLabel,
  recommendedWidth,
  recommendedHeight,
  liveAspectRatio,
  helperText,
  previewWidthClassName = "w-full",
}: BannerImageFieldProps) {
  const [file, setFile] = useState<File | null>(null);
  const [dimensions, setDimensions] = useState<{ width: number; height: number } | null>(null);
  const [sizeError, setSizeError] = useState<string | null>(null);

  const objectUrl = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  const previewUrl = objectUrl ?? existingUrl ?? null;

  useEffect(() => () => { if (objectUrl) URL.revokeObjectURL(objectUrl); }, [objectUrl]);

  useEffect(() => {
    if (!previewUrl) {
      setDimensions(null);
      return;
    }
    let cancelled = false;
    const probe = new window.Image();
    probe.onload = () => {
      if (!cancelled) setDimensions({ width: probe.naturalWidth, height: probe.naturalHeight });
    };
    probe.onerror = () => {
      if (!cancelled) setDimensions(null);
    };
    probe.src = previewUrl;
    return () => {
      cancelled = true;
    };
  }, [previewUrl]);

  const status = dimensions ? detectStatus(dimensions.width, dimensions.height, recommendedWidth, recommendedHeight) : null;

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm font-bold uppercase tracking-[0.08em] text-[#3F4450]">{frameLabel}</span>
        <span className="text-xs font-semibold text-[#6B6063]">Recomendado: {recommendedWidth}×{recommendedHeight}px · máx. 1MB</span>
      </div>

      {/* Recuadro con la MISMA proporción que ocupa esta imagen en el Hero
          real (HeroBackgroundSlider.tsx), para que el recorte "object-cover"
          que se ve aquí sea lo más fiel posible al recorte real. */}
      <div
        className={`relative overflow-hidden rounded-[10px] border-2 border-dashed border-[#C9CEDD] bg-[#F6F7F9] ${previewWidthClassName}`}
        style={{ aspectRatio: liveAspectRatio }}
      >
        {previewUrl ? (
          <img src={previewUrl} alt={`Previsualización banner ${frameLabel}`} className="absolute inset-0 h-full w-full object-cover" />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-[#4B5262]">
            <ImageIcon size={32} strokeWidth={1.8} />
            <span className="text-xs font-semibold">Sin imagen {frameLabel.toLowerCase()}</span>
          </div>
        )}
      </div>

      {status ? (
        <p
          className={`mt-2 flex items-start gap-2 text-[12px] font-semibold ${
            status.tone === "ok" ? "text-emerald-700" : status.tone === "warn" ? "text-amber-700" : "text-red-600"
          }`}
        >
          {status.tone === "ok" ? <CheckCircle2 size={15} className="mt-[1px] shrink-0" /> : <AlertTriangle size={15} className="mt-[1px] shrink-0" />}
          <span>
            Detectado {dimensions?.width}×{dimensions?.height}px. {status.message}
          </span>
        </p>
      ) : (
        <p className="mt-2 text-[12px] text-[#6B6063]">{helperText}</p>
      )}
      {sizeError ? (
        <p className="mt-1 text-[12px] font-semibold text-red-600">{sizeError}</p>
      ) : null}

      <label className="mt-3 inline-flex cursor-pointer items-center gap-2 rounded-[4px] border border-[#8E94A3] bg-white px-5 py-2 text-sm font-bold text-[#1F1F22] transition-colors hover:border-[#9E3659] hover:text-[#9E3659]">
        <UploadCloud size={17} />
        {file ? "Cambiar imagen" : existingUrl ? `Reemplazar imagen ${frameLabel.toLowerCase()}` : `Subir imagen ${frameLabel.toLowerCase()}`}
        <input
          name={name}
          type="file"
          accept="image/*"
          className="sr-only"
          onChange={(event) => {
            const selected = event.currentTarget.files?.[0] ?? null;
            if (selected && selected.size > MAX_IMAGE_SIZE_BYTES) {
              setSizeError(`No se subió porque pesa mucho (máximo 1MB por imagen): ${selected.name} (${formatSize(selected.size)}).`);
              // Limpiamos el input real: sin esto, el archivo rechazado se
              // quedaría en su FileList y se enviaría igual al guardar.
              event.currentTarget.value = "";
              return;
            }
            setSizeError(null);
            setFile(selected);
          }}
        />
      </label>
    </div>
  );
}