/**
 * Configuração central da marca do sistema.
 *
 * Use SEMPRE estas constantes em vez de strings literais ("VisionFood",
 * "Vision Mídia Digital", etc.) na UI, SEO, e-mails, edge functions JS, etc.
 *
 * Para mudar o nome do sistema no futuro (rebrand, white-label, expansão
 * para VisionSalud / VisionLog), basta alterar este arquivo.
 *
 * Observação: HTML estático (index.html) e funções Deno (supabase/functions,
 * netlify/edge-functions) NÃO podem importar deste módulo — nesses pontos
 * mantenha o valor sincronizado manualmente.
 */
export const BRAND_NAME = 'VisionFood';
export const BRAND_LEGAL_NAME = 'VisionFood Digital';
export const BRAND_TAGLINE = 'Autoatendimento Inteligente';
export const BRAND_FULL_TITLE = `${BRAND_NAME} - Autoatendimento`;

export const brandConfig = {
  name: BRAND_NAME,
  legalName: BRAND_LEGAL_NAME,
  tagline: BRAND_TAGLINE,
  fullTitle: BRAND_FULL_TITLE,
} as const;

export default brandConfig;
