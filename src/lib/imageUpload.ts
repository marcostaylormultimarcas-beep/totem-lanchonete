import { supabase } from '@/integrations/supabase/client';

const MAX_WIDTH = 800;
const MAX_HEIGHT = 800;
const QUALITY = 0.8;

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

export async function uploadProductImage(file: File): Promise<string> {
  const resized = await resizeImage(file);
  const fileName = `${crypto.randomUUID()}.webp`;
  const { error } = await supabase.storage
    .from('produtos')
    .upload(fileName, resized, { contentType: 'image/webp', upsert: true });

  if (error) throw error;

  const { data } = supabase.storage.from('produtos').getPublicUrl(fileName);
  return data.publicUrl;
}
