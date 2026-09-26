import { describe, expect, it } from 'vitest';

type ModuleLoader = () => Promise<{ default?: unknown }>;

const drawerModules: Array<[string, ModuleLoader]> = [
  ['Configuração / StorageUsageCard', () => import('@/components/admin/StorageUsageCard')],
  ['Configuração / ChangePasswordCard', () => import('@/components/admin/ChangePasswordCard')],
  ['Configuração / MercadoPagoCard', () => import('@/components/admin/MercadoPagoCard')],
  ['Painel de Senhas (TV)', () => import('@/components/admin/SenhasPanel')],
  ['Cupons', () => import('@/components/admin/CouponsPanel')],
  ['Fidelidade', () => import('@/components/admin/LoyaltyPanel')],
  ['CRM', () => import('@/components/admin/CrmPanel')],
  ['Entregadores', () => import('@/components/admin/EntregadoresPanel')],
  ['Bairros', () => import('@/components/admin/BairrosPanel')],
  ['Área CEP', () => import('@/components/admin/AreaAtendimentoPanel')],
  ['Delivery', () => import('@/components/admin/DeliveryPanel')],
  ['Logística', () => import('@/components/admin/LogisticaPanel')],
  ['Roteirização IA', () => import('@/components/admin/RoteirizacaoIAPanel')],
  ['Vision Prime', () => import('@/components/admin/VisionPrimePanel')],
  ['Parcerias', () => import('@/components/admin/CoMarketingPanel')],
  ['Operação', () => import('@/components/admin/OperacaoPanel')],
  ['Assistente Vision', () => import('@/components/admin/AssistenteVisionPanel')],
  ['Personalização Visual', () => import('@/components/admin/PersonalizacaoVisualPanel')],
  ['Impressão Térmica', () => import('@/components/admin/ImpressaoTermicaPanel')],
  ['Estoque Inteligente', () => import('@/components/admin/EstoqueInteligentePanel')],
  ['IA Estoque Preditivo', () => import('@/components/admin/EstoquePreditivPanel')],
  ['Assinatura', () => import('@/components/admin/AssinaturaPanel')],
  ['Fiscal', () => import('@/components/admin/FiscalExportCard')],
  ['Operadores PDV', () => import('@/components/admin/OperadoresPdvPanel')],
  ['Lojas', () => import('@/components/admin/MasterPanel')],
  ['Multi-Lojas', () => import('@/components/admin/MultiLojasPanel')],
  ['Planos', () => import('@/components/admin/PlansMatrixPanel')],
  ['Push (OneSignal)', () => import('@/components/admin/OneSignalPanel')],
  ['Cobrança Master', () => import('@/components/admin/MasterBillingPanel')],
  ['Mapa Parcerias', () => import('@/components/admin/CoMarketingGlobalMap')],
  ['Super', () => import('@/components/admin/SuperAdminPanel')],
];

describe('ADM drawer modules', () => {
  it('carrega cada módulo lateral sequencialmente, parando no primeiro erro', async () => {
    const admin = await import('@/pages/Admin');
    expect(admin.default).toBeTruthy();

    for (const [label, load] of drawerModules) {
      try {
        const module = await load();
        expect(module.default, `${label} não exportou componente default`).toBeTruthy();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Falha ao carregar "${label}" antes de prosseguir para o próximo: ${message}`);
      }
    }
  });
});
