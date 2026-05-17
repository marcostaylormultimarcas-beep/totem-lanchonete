import { supabase } from '@/integrations/supabase/client';

const MAX_WIDTH = 800;
const MAX_HEIGHT = 800;
const QUALITY = 0.8;

export const STORAGE_LIMIT_BYTES = 250 * 1024 * 1024; // 250 MB por loja
export const STORAGE_BUCKET = 'produtos';

export class StorageLimitError extends Error {
  constructor(message = 'Espaço de armazenamento esgotado (Limite de 250MB atingido). Fale com a Vision Mídia Digital para expandir seu plano!') {
    super(message);
    this.name = 'StorageLimitError';
  }
}

function resizeImage(file: File): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      if (width > MAX_WIDTH || height > MAX_HEIGHT) {
        const ratio = Math.min(MAX_WIDTH / width, MAX_HEIGHT / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('Failed to resize'))),
        'image/webp',
        QUALITY
      );
    };
    img.onerror = reject;
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
  while (true) {
    const { data, error } = await supabase.storage
      .from(STORAGE_BUCKET)
      .list(orgId, { limit: pageSize, offset });
    if (error || !data) break;
    for (const item of data) {
      const size = (item as any)?.metadata?.size;
      if (typeof size === 'number') total += size;
    }
    if (data.length < pageSize) break;
    offset += pageSize;
  }
  return total;
}

export async function uploadProductImage(file: File, orgId: string): Promise<string> {
  if (!orgId) throw new Error('Loja não identificada para upload.');
  const resized = await resizeImage(file);

  // Validação: total atual + novo arquivo
  const used = await getOrgStorageUsage(orgId);
  if (used + resized.size > STORAGE_LIMIT_BYTES) {
    throw new StorageLimitError();
  }

  const fileName = `${orgId}/${crypto.randomUUID()}.webp`;
  const { error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(fileName, resized, { contentType: 'image/webp', upsert: true });

  if (error) throw error;

  const { data } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(fileName);
  return data.publicUrl;
}
