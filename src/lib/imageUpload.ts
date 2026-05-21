import { supabase } from '@/integrations/supabase/client';
import { BRAND_LEGAL_NAME } from '@/config/brandConfig';

/**
 * Tipos de imagem suportados.
 * - `product` / `logo` / `icon`: até 800px (padrão)
 * - `banner` / `cover`: até 1920px (alta definição para telas grandes)
 */
export type ImageKind = 'product' | 'logo' | 'icon' | 'banner' | 'cover';

export interface ImageUploadOptions {
  kind?: ImageKind;
  /** Quando true, aplica ajuste leve de contraste/saturação ("Dark Premium"). Padrão: true */
  enhance?: boolean;
}

const MAX_DIM_DEFAULT = 800;
const MAX_DIM_LARGE = 1920;
const QUALITY = 0.88;

// Boost sutil — fotos ficam mais vivas, mas sem queimar a cor
const CONTRAST = 1.08;   // +8% contraste
const SATURATION = 1.12; // +12% saturação
const BLACK_LIFT = 0.96; // pretos ~4% mais profundos

export const STORAGE_LIMIT_BYTES = 250 * 1024 * 1024; // 250 MB por loja
export const STORAGE_BUCKET = 'produtos';

export class StorageLimitError extends Error {
  constructor(
    message = 'Espaço de armazenamento esgotado (Limite de 250MB atingido). Fale com a Vision Mídia Digital para expandir seu plano!',
  ) {
    super(message);
    this.name = 'StorageLimitError';
  }
}

function maxDimFor(kind: ImageKind): number {
  return kind === 'banner' || kind === 'cover' ? MAX_DIM_LARGE : MAX_DIM_DEFAULT;
}

/**
 * Aplica ajuste leve de contraste e saturação direto no Canvas
 * para combinar com a estética Dark Premium do totem.
 */
function applyEnhancement(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  const imgData = ctx.getImageData(0, 0, width, height);
  const d = imgData.data;
  const contrastFactor = (259 * (CONTRAST * 255 + 255)) / (255 * (259 - CONTRAST * 255));

  for (let i = 0; i < d.length; i += 4) {
    let r = d[i];
    let g = d[i + 1];
    let b = d[i + 2];

    // Contraste
    r = contrastFactor * (r - 128) + 128;
    g = contrastFactor * (g - 128) + 128;
    b = contrastFactor * (b - 128) + 128;

    // Saturação
    const gray = 0.2989 * r + 0.587 * g + 0.114 * b;
    r = gray + (r - gray) * SATURATION;
    g = gray + (g - gray) * SATURATION;
    b = gray + (b - gray) * SATURATION;

    // Pretos mais profundos (somente nos tons escuros)
    if (gray < 64) {
      r *= BLACK_LIFT;
      g *= BLACK_LIFT;
      b *= BLACK_LIFT;
    }

    d[i] = Math.max(0, Math.min(255, r));
    d[i + 1] = Math.max(0, Math.min(255, g));
    d[i + 2] = Math.max(0, Math.min(255, b));
  }
  ctx.putImageData(imgData, 0, 0);
}

function processImage(file: File, kind: ImageKind, enhance: boolean): Promise<Blob> {
  const maxDim = maxDimFor(kind);
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        const ratio = Math.min(maxDim / width, maxDim / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Canvas não suportado neste navegador.'));
        return;
      }
      // Qualidade máxima de reamostragem
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, width, height);

      if (enhance) {
        try {
          applyEnhancement(ctx, width, height);
        } catch (err) {
          // Se CORS bloquear getImageData (não acontece com upload local),
          // segue sem o enhancement em vez de falhar o upload.
          console.warn('[imageUpload] enhancement skipped:', err);
        }
      }

      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('Falha ao otimizar imagem.'))),
        'image/webp',
        QUALITY,
      );
    };
    img.onerror = () => reject(new Error('Não foi possível ler o arquivo de imagem.'));
    img.src = url;
  });
}

/**
 * Soma o tamanho (bytes) de todos os arquivos da loja no bucket de imagens.
 */
export async function getOrgStorageUsage(orgId: string): Promise<number> {
  if (!orgId) return 0;
  let total = 0;
  let offset = 0;
  const pageSize = 1000;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { data, error } = await supabase.storage
      .from(STORAGE_BUCKET)
      .list(orgId, { limit: pageSize, offset });
    if (error || !data) break;
    for (const item of data) {
      const size = (item as { metadata?: { size?: number } })?.metadata?.size;
      if (typeof size === 'number') total += size;
    }
    if (data.length < pageSize) break;
    offset += pageSize;
  }
  return total;
}

export async function uploadProductImage(
  file: File,
  orgId: string,
  options: ImageUploadOptions = {},
): Promise<string> {
  if (!orgId) throw new Error('Loja não identificada para upload.');
  const kind = options.kind ?? 'product';
  const enhance = options.enhance ?? true;

  const optimized = await processImage(file, kind, enhance);

  // Validação: total atual + novo arquivo
  const used = await getOrgStorageUsage(orgId);
  if (used + optimized.size > STORAGE_LIMIT_BYTES) {
    throw new StorageLimitError();
  }

  const fileName = `${orgId}/${crypto.randomUUID()}.webp`;
  const { error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(fileName, optimized, { contentType: 'image/webp', upsert: true });

  if (error) throw error;

  const { data } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(fileName);
  return data.publicUrl;
}
