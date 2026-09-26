import { toast } from 'sonner';
import { getKioskHomePath } from '@/lib/kioskHome';
import { lazy, Suspense, useState, useEffect } from 'react';
import { ArrowLeft, Plus, Pencil, Trash2, Save, Settings, Lock, Image, Store, Zap, Megaphone, Upload, Loader2, ClipboardList, Shield, Pause, Play, LogOut, Building2, Ticket, Truck, Award, ExternalLink, KeyRound, CreditCard, Share2, FileText, Users, Crown, Sparkles, Palette, Printer, Boxes, MapPin, Bell, Menu, X, Barcode, AlertTriangle } from 'lucide-react';
import { vencimentoStatus, vencimentoLabel } from '@/lib/validade';
import VencimentoBanner from '@/components/admin/VencimentoBanner';
import { Sheet, SheetClose, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Product, BannerItem, StoreSettings, CategoryItem, formatCurrency } from '@/data/store';
import { uploadProductImage, StorageLimitError } from '@/lib/imageUpload';
import { supabase } from '@/integrations/supabase/client';
import { useOrg } from '@/contexts/OrgContext';
import { signOutCompletely } from '@/lib/auth';
import FeatureGate from '@/components/FeatureGate';
import InstallAppButton from '@/components/pwa/InstallAppButton';
import { identifyOneSignalUser, requestOneSignalPermission } from '@/lib/onesignal';
import OneSignalPanel from '@/components/admin/OneSignalPanel';
import OrgSwitcher from '@/components/admin/OrgSwitcher';
import CrmPanel from '@/components/admin/CrmPanel';
import MesasPanel from '@/components/admin/MesasPanel';
import { AdminTab, normalizeAdminTabForTier, parseAdminTab, withAdminTabSearchParams } from '@/lib/adminTabState';
import RuntimeErrorBoundary from '@/components/RuntimeErrorBoundary';

// Heavy admin modules are loaded only when the Admin route needs them.
const ClientesLeadsPanel = lazy(() => import('@/components/admin/ClientesLeadsPanel'));
const OrdersPanel = lazy(() => import('@/components/admin/OrdersPanel'));
const DashboardPanel = lazy(() => import('@/components/admin/DashboardPanel'));
const MasterPanel = lazy(() => import('@/components/admin/MasterPanel'));
const SuperAdminPanel = lazy(() => import('@/components/admin/SuperAdminPanel'));
const PlansMatrixPanel = lazy(() => import('@/components/admin/PlansMatrixPanel'));
const ChangePasswordCard = lazy(() => import('@/components/admin/ChangePasswordCard'));
const CouponsPanel = lazy(() => import('@/components/admin/CouponsPanel'));
const LoyaltyPanel = lazy(() => import('@/components/admin/LoyaltyPanel'));
const StorageUsageCard = lazy(() => import('@/components/admin/StorageUsageCard'));
const MercadoPagoCard = lazy(() => import('@/components/admin/MercadoPagoCard'));
const FiscalExportCard = lazy(() => import('@/components/admin/FiscalExportCard'));
const EntregadoresPanel = lazy(() => import('@/components/admin/EntregadoresPanel'));
const BairrosPanel = lazy(() => import('@/components/admin/BairrosPanel'));
const LogisticaPanel = lazy(() => import('@/components/admin/LogisticaPanel'));
const VisionPrimePanel = lazy(() => import('@/components/admin/VisionPrimePanel'));
const CoMarketingPanel = lazy(() => import('@/components/admin/CoMarketingPanel'));
const CoMarketingGlobalMap = lazy(() => import('@/components/admin/CoMarketingGlobalMap'));
const OperacaoPanel = lazy(() => import('@/components/admin/OperacaoPanel'));
const AssistenteVisionPanel = lazy(() => import('@/components/admin/AssistenteVisionPanel'));
const PersonalizacaoVisualPanel = lazy(() => import('@/components/admin/PersonalizacaoVisualPanel'));
const ImpressaoTermicaPanel = lazy(() => import('@/components/admin/ImpressaoTermicaPanel'));
const FinanceiroPanel = lazy(() => import('@/components/admin/FinanceiroPanel'));
const EstoqueInteligentePanel = lazy(() => import('@/components/admin/EstoqueInteligentePanel'));
const EstoquePreditivPanel = lazy(() => import('@/components/admin/EstoquePreditivPanel'));
const RoteirizacaoIAPanel = lazy(() => import('@/components/admin/RoteirizacaoIAPanel'));
const AreaAtendimentoPanel = lazy(() => import('@/components/admin/AreaAtendimentoPanel'));
const DeliveryPanel = lazy(() => import('@/components/admin/DeliveryPanel'));
const AssinaturaPanel = lazy(() => import('@/components/admin/AssinaturaPanel'));
const MasterBillingPanel = lazy(() => import('@/components/admin/MasterBillingPanel'));
const MultiLojasPanel = lazy(() => import('@/components/admin/MultiLojasPanel'));
const SenhasPanel = lazy(() => import('@/components/admin/SenhasPanel'));
const OperadoresPdvPanel = lazy(() => import('@/components/admin/OperadoresPdvPanel'));


const DEFAULT_CATEGORIES: CategoryItem[] = [
  { key: 'hamburgueres', label: 'Hambúrgueres', icon: '🍔' },
  { key: 'pizzas', label: 'Pizzas', icon: '🍕' },
  { key: 'bebidas', label: 'Bebidas', icon: '🥤' },
];
const BADGE_COLORS: BannerItem['badgeColor'][] = ['primary', 'secondary', 'accent'];
const BADGE_COLOR_LABELS = { primary: '🟠 Laranja', secondary: '🔴 Vermelho', accent: '🟡 Amarelo' };

interface AdminUser {
  id: string;
  username: string; // email
  tier: 'super' | 'master' | 'admin';
  organization_id: string | null;
}

const AdminPage = () => {
  const navigate = useNavigate();

  const [searchParams, setSearchParams] = useSearchParams();
  const { orgId: ctxOrgId, setOrgId, org, refresh: refreshOrg } = useOrg();
  const [authenticated, setAuthenticated] = useState(false);
  const [authLoading, setAuthLoading] = useState(true);
  const [currentAdmin, setCurrentAdmin] = useState<AdminUser | null>(null);
  // For Master: selected org (defaults to own). For regular admin: their own org only.
  const [activeOrgId, setActiveOrgId] = useState<string | null>(null);
  const [allOrgs, setAllOrgs] = useState<Array<{ id: string; name: string; slug: string }>>([]);
  const [loginEmail, setLoginEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [products, setProducts] = useState<Product[]>([]);
  const [settings, setSettings] = useState<StoreSettings>({
    whatsappNumber: '', storeName: 'Vision Mídia', coverImage: '',
    combo: { name: 'Batata + Refri', description: 'Batata + Refri', price: 15, emoji: '🍟🥤', image: '' },
    banners: [],
    categoryIcons: { hamburgueres: '🍔', pizzas: '🍕', bebidas: '🥤' },
    categories: DEFAULT_CATEGORIES,
    instagramUrl: '',
    deliveryEnabled: true,
    shareImage: '', pixKeyManual: '', mpAccessToken: '', mpPublicKey: '', mpTerminalId: '',
    payCashEnabled: true, payPixEnabled: true, payCardTerminalEnabled: false, payCardOnlineEnabled: false,
  });
  const [settingsId, setSettingsId] = useState<string | null>(null);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [tab, setTabState] = useState<AdminTab>(() => parseAdminTab(searchParams.get('tab')));

  const setTab = (nextTab: AdminTab) => {
    setTabState(nextTab);
    setSearchParams(withAdminTabSearchParams(searchParams, nextTab), { replace: false });
  };

  useEffect(() => {
    const urlTab = parseAdminTab(searchParams.get('tab'));
    setTabState(current => current === urlTab ? current : urlTab);
  }, [searchParams]);

  useEffect(() => {
    if (!authenticated || !currentAdmin) return;
    const allowedTab = normalizeAdminTabForTier(tab, currentAdmin.tier);
    if (allowedTab === tab) return;

    setTabState(allowedTab);
    setSearchParams(withAdminTabSearchParams(searchParams, allowedTab), { replace: true });
  }, [authenticated, currentAdmin, tab, searchParams, setSearchParams]);


  const [subscriptionStatus, setSubscriptionStatus] = useState<string>('ativo');
  const [masterUnlocked, setMasterUnlocked] = useState(false);
  const [masterPassword, setMasterPassword] = useState('');
  const [masterError, setMasterError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadingBannerIdx, setUploadingBannerIdx] = useState<number | null>(null);
  const [productPreviewUrl, setProductPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (productPreviewUrl) URL.revokeObjectURL(productPreviewUrl);
    };
  }, [productPreviewUrl]);

  // Load products from Supabase (scoped by activeOrgId)
  useEffect(() => {
    if (!activeOrgId) { setProducts([]); return; }
    const fetch = async () => {
      const { data } = await supabase.from('products').select('*').eq('organization_id', activeOrgId);
      if (data) {
        setProducts(data.map((p: any) => ({
          id: p.id, name: p.name, price: Number(p.price),
          costPrice: p.cost_price == null ? null : Number(p.cost_price),
          markupPercent: p.markup_percent == null ? null : Number(p.markup_percent),
          category: p.category as Product['category'],
          image: p.image, removableIngredients: (p.removable_ingredients as string[]) || [],
          extras: (p.extras as { name: string; price: number }[]) || [], isCombo: p.is_combo || false,
          ingredients: (p.ingredients as string[]) || [], description: p.description || '',
          available: p.available !== false,
          ingredientStockBlocked: Boolean(p.ingredient_stock_blocked),
          manageStock: Boolean(p.manage_stock),
          stockQuantity: Number(p.stock_quantity ?? 0),
          lowStockThreshold: Number(p.low_stock_threshold ?? 5),
          soldByWeight: Boolean((p as any).sold_by_weight),
          codigoBarras: (p as any).codigo_barras || '',
          dataVencimento: (p as any).data_vencimento || null,
          lote: (p as any).lote || '',
          alertaVencimento: Boolean((p as any).alerta_vencimento),
          prepTimeMin: Number((p as any).prep_time_min ?? 0),
        })));
      }
    };
    fetch();
  }, [activeOrgId]);

  // Identifica o administrador no OneSignal sem abrir prompt automaticamente.
  useEffect(() => {
    if (!authenticated || !activeOrgId) return;
    let active = true;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!active || !user) return;
      await identifyOneSignalUser(`admin:${user.id}`, {
        tipo: 'admin',
        organization_id: activeOrgId,
      });
    })();
    return () => { active = false; };
  }, [authenticated, activeOrgId]);

  const enableAdminPush = async () => {
    if (!activeOrgId) {
      toast.error('Selecione uma loja antes de ativar as notificações.');
      return;
    }
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      toast.error('Sessão administrativa não encontrada.');
      return;
    }
    const ok = await requestOneSignalPermission(`admin:${user.id}`, {
      tipo: 'admin',
      organization_id: activeOrgId,
    });
    if (ok) toast.success('Notificações push ativadas neste dispositivo.');
    else toast.info('Push não foi ativado. Verifique a permissão de notificações do navegador.');
  };

  // Status de assinatura (com realtime) — bloqueia o painel se inadimplente/cancelado
  useEffect(() => {
    if (!activeOrgId) return;
    let mounted = true;
    const fetchStatus = async () => {
      const { data } = await supabase
        .from('organizations')
        .select('status_assinatura')
        .eq('id', activeOrgId)
        .maybeSingle();
      if (mounted) setSubscriptionStatus((data as any)?.status_assinatura || 'ativo');
    };
    fetchStatus();
    const ch = supabase
      .channel(`org-status-${activeOrgId}`)
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'organizations', filter: `id=eq.${activeOrgId}` },
        (p: any) => setSubscriptionStatus(p.new?.status_assinatura || 'ativo'),
      )
      .subscribe();
    return () => { mounted = false; supabase.removeChannel(ch); };
  }, [activeOrgId]);



  // Load settings from Supabase (scoped by activeOrgId)
  useEffect(() => {
    if (!activeOrgId) return;
    const fetch = async () => {
      const [{ data }, { data: fiscalOrg }] = await Promise.all([
        supabase.from('settings').select('*').eq('organization_id', activeOrgId).maybeSingle(),
        supabase.from('organizations').select('cnpj, razao_social').eq('id', activeOrgId).maybeSingle(),
      ]);
      if (data) {
        setSettingsId(data.id);
        setSettings({
          storeName: data.store_name || 'Vision Mídia',
          whatsappNumber: data.whatsapp_number || '',
          coverImage: data.cover_image || '',
          combo: (data.combo as any) || { name: 'Batata + Refri', description: 'Batata + Refri', price: 15, emoji: '🍟🥤', image: '' },
          banners: (data.banners as unknown as BannerItem[]) || [],
          categoryIcons: ((data as any).category_icons as any) || { hamburgueres: '🍔', pizzas: '🍕', bebidas: '🥤' },
          categories: ((data as any).categories as CategoryItem[]) || DEFAULT_CATEGORIES,
          instagramUrl: (data as any).instagram_url || '',
          deliveryEnabled: (data as any).delivery_enabled !== false,
          shareImage: (data as any).share_image || '',
          pixKeyManual: (data as any).pix_key_manual || '',
          mpAccessToken: (data as any).mp_access_token || '',
          mpPublicKey: (data as any).mp_public_key || '',
          mpTerminalId: (data as any).mp_terminal_id || '',
          payCashEnabled: (data as any).pay_cash_enabled !== false,
          payPixEnabled: (data as any).pay_pix_enabled !== false,
          payCardTerminalEnabled: Boolean((data as any).pay_card_terminal_enabled),
          payCardOnlineEnabled: Boolean((data as any).pay_card_online_enabled),
          fiscalEnabled: false,
          fiscalCnpj: (fiscalOrg as any)?.cnpj || '',
          fiscalRazao: (fiscalOrg as any)?.razao_social || '',
          fiscalIe: '',
          fiscalRegime: '',
          fiscalCsc: '',
          fiscalToken: '',
          balancaModelo: ((data as any).balanca_modelo as any) || 'generic',
          balancaBaudRate: Number((data as any).balanca_baud_rate ?? 9600),
        });
      } else {
        setSettingsId(null);
      }
    };
    fetch();
  }, [activeOrgId]);

  type SettingsPayload = Record<string, string | number | boolean | null | object>;

  const showDatabaseError = (context: string, error: unknown) => {
    const dbError = error as { message?: string; details?: string; hint?: string; code?: string };
    const message = dbError?.message || 'Erro desconhecido ao gravar no banco de dados.';
    console.error(`[${context}]`, { ...dbError, organization_id: activeOrgId });
    toast.error(message, {
      description: [dbError?.details, dbError?.hint, dbError?.code].filter(Boolean).join(' · ') || undefined,
    });
  };

  const persistSettingsFields = async (payload: SettingsPayload, context: string) => {
    try {
      if (!activeOrgId) throw new Error('Loja não identificada para salvar as configurações.');
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw sessionError;
      if (!session) throw new Error('Sessão expirada. Faça login novamente para salvar.');

      if (settingsId) {
        const { error } = await supabase.from('settings').update(payload as any).eq('id', settingsId);
        if (error) throw error;
        return;
      }

      // Usa upsert com onConflict em organization_id para evitar violar a
      // constraint uniq_settings_org quando já existe um registro para a loja.
      const { data, error } = await supabase
        .from('settings')
        .upsert(
          { organization_id: activeOrgId, ...payload } as any,
          { onConflict: 'organization_id' }
        )
        .select('id')
        .maybeSingle();
      if (error) throw error;
      if (data?.id) setSettingsId(data.id);
    } catch (error) {
      showDatabaseError(context, error);
      throw error;
    }
  };

  const persistAuthoritativeCombo = async (combo: StoreSettings['combo']) => {
    if (!activeOrgId) throw new Error('Loja não identificada para salvar o combo.');
    const { data, error } = await supabase.rpc('visionfood_upsert_combo_product' as any, {
      _org: activeOrgId,
      _name: combo?.name || '',
      _price: Number(combo?.price || 0),
      _description: combo?.description || '',
      _image: combo?.image || combo?.emoji || '',
    });
    const result: any = data;
    if (error) throw error;
    if (!result?.ok || !result?.product_id) throw new Error(result?.reason || 'combo_sync_failed');
    return result;
  };

  // Preferências não secretas da loja. Credenciais Mercado Pago permanecem
  // exclusivamente no MercadoPagoCard/RPC seguro e nunca entram neste payload.
  const saveSettingsToDb = async (s: StoreSettings) => {
    const fields: Array<[string, SettingsPayload]> = [
      ['storeName', { store_name: s.storeName }],
      ['whatsapp', { whatsapp_number: s.whatsappNumber }],
      ['banners', { banners: s.banners as any }],
      ['categoryIcons', { category_icons: s.categoryIcons as any }],
      ['categories', { categories: s.categories as any }],
      ['instagram', { instagram_url: s.instagramUrl || '' }],
      ['balancaBaudRate', { balanca_baud_rate: s.balancaBaudRate === 4800 ? 4800 : 9600 }],
      ['pixKeyManual', { pix_key_manual: s.pixKeyManual || '' }],
      ['payCashEnabled', { pay_cash_enabled: Boolean(s.payCashEnabled) }],
      ['payPixEnabled', { pay_pix_enabled: Boolean(s.payPixEnabled) }],
      ['payCardTerminalEnabled', { pay_card_terminal_enabled: Boolean(s.payCardTerminalEnabled) }],
      ['payCardOnlineEnabled', { pay_card_online_enabled: Boolean(s.payCardOnlineEnabled) }],
      ['mpTerminalId', { mp_terminal_id: s.mpTerminalId || '' }],
    ];
    let failed = false;
    try {
      await persistAuthoritativeCombo(s.combo);
    } catch (error) {
      failed = true;
      showDatabaseError('saveSettings.combo', error);
    }
    for (const [field, payload] of fields) {
      try {
        await persistSettingsFields(payload, `saveSettings.${field}`);
      } catch {
        failed = true;
      }
    }
    if (failed) {
      throw new Error('Uma ou mais preferências não puderam ser salvas.');
    }
  };

  const saveFiscalCompany = async () => {
    if (!activeOrgId) {
      toast.error('Loja não identificada.');
      return;
    }

    const cnpj = (settings.fiscalCnpj || '').trim();
    const cnpjDigits = cnpj.replace(/\D/g, '');
    if (cnpj && cnpjDigits.length !== 14) {
      toast.error('CNPJ inválido. Informe os 14 dígitos.');
      return;
    }

    const razaoSocial = (settings.fiscalRazao || '').trim();
    const { error } = await supabase
      .from('organizations')
      .update({ cnpj, razao_social: razaoSocial } as any)
      .eq('id', activeOrgId);

    if (error) {
      showDatabaseError('saveFiscalCompany', error);
      return;
    }

    toast.success('Dados cadastrais salvos.');
    await refreshOrg();
  };

  const saveCategories = async (updated: StoreSettings, previous: StoreSettings) => {
    try {
      let saved = false;
      try {
        await persistSettingsFields({ categories: updated.categories as any }, 'saveCategories.list');
        saved = true;
      } catch { /* o ícone ainda pode ser salvo */ }
      try {
        await persistSettingsFields({ category_icons: updated.categoryIcons as any }, 'saveCategories.icons');
        saved = true;
      } catch { /* o erro exato já foi exibido */ }
      if (!saved) throw new Error('Categorias não foram salvas.');
      return true;
    } catch (error) {
      setSettings(previous);
      return false;
    }
  };


  const handleBannerImageUpload = async (e: React.ChangeEvent<HTMLInputElement>, idx: number) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingBannerIdx(idx);
    try {
      const url = await uploadProductImage(file, activeOrgId!, { kind: 'banner' });
      const banners = [...settings.banners];
      banners[idx] = { ...banners[idx], image: url };
      const updated = { ...settings, banners };
      setSettings(updated);
      await saveSettingsToDb(updated);
    } catch (err) {
      alert(err instanceof StorageLimitError ? err.message : 'Erro ao enviar imagem do banner. Tente novamente.');
      console.error(err);
    } finally {
      setUploadingBannerIdx(null);
    }
  };

  const [uploadingCategoryIcon, setUploadingCategoryIcon] = useState<string | null>(null);

  const handleCategoryIconUpload = async (e: React.ChangeEvent<HTMLInputElement>, key: string) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingCategoryIcon(key);
    const previous = settings;
    try {
      const url = await uploadProductImage(file, activeOrgId!);
      const cats = (settings.categories || DEFAULT_CATEGORIES).map(c => c.key === key ? { ...c, icon: url } : c);
      const updated = { ...settings, categories: cats, categoryIcons: { ...settings.categoryIcons, [key]: url } };
      setSettings(updated);
      const saved = await saveCategories(updated, previous);
      if (!saved) return;
      toast.success('Imagem da categoria atualizada!');
    } catch (err) {
      if (err instanceof StorageLimitError) toast.error(err.message);
      else showDatabaseError('uploadCategoryImage', err);
    } finally {
      setUploadingCategoryIcon(null);
    }
  };

  const [uploadingComboImage, setUploadingComboImage] = useState(false);
  const handleComboImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingComboImage(true);
    try {
      const url = await uploadProductImage(file, activeOrgId!);
      const updated = { ...settings, combo: { ...settings.combo, image: url } };
      setSettings(updated);
      await saveSettingsToDb(updated);
    } catch (err) {
      alert(err instanceof StorageLimitError ? err.message : 'Erro ao enviar imagem do combo. Tente novamente.');
    } finally {
      setUploadingComboImage(false);
    }
  };

  const updateCategory = async (idx: number, field: 'label' | 'icon' | 'key', value: string) => {
    const previous = settings;
    const cats = [...(settings.categories || DEFAULT_CATEGORIES)];
    cats[idx] = { ...cats[idx], [field]: value };
    const updated = { ...settings, categories: cats };
    setSettings(updated);
    await saveCategories(updated, previous);
  };

  const addCategory = async () => {
    const previous = settings;
    const key = 'cat_' + Math.random().toString(36).slice(2, 8);
    const cats = [...(settings.categories || DEFAULT_CATEGORIES), { key, label: 'Nova Categoria', icon: '🍽️' }];
    const updated = { ...settings, categories: cats };
    setSettings(updated);
    await saveCategories(updated, previous);
  };

  const removeCategory = async (key: string) => {
    if (!confirm('Remover esta categoria? Os produtos vinculados a ela ficarão sem categoria visível.')) return;
    const previous = settings;
    const cats = (settings.categories || DEFAULT_CATEGORIES).filter(c => c.key !== key);
    const updated = { ...settings, categories: cats };
    setSettings(updated);
    await saveCategories(updated, previous);
  };

  const [uploadingCover, setUploadingCover] = useState(false);
  const [uploadingShare, setUploadingShare] = useState(false);

  const handleShareImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingShare(true);
    try {
      const url = await uploadProductImage(file, activeOrgId!);
      const updated = { ...settings, shareImage: url };
      setSettings(updated);
      await persistSettingsFields({ share_image: url }, 'saveShareImage');
      toast.success('Imagem de compartilhamento atualizada!');
    } catch (err) {
      if (err instanceof StorageLimitError) toast.error(err.message);
    } finally {
      setUploadingShare(false);
    }
  };

  const handleCoverImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingCover(true);
    try {
      const url = await uploadProductImage(file, activeOrgId!, { kind: 'cover' });
      const updated = { ...settings, coverImage: url };
      setSettings(updated);
      await persistSettingsFields({ cover_image: url }, 'saveCoverImage');
      toast.success('Imagem de capa atualizada!');
    } catch (err) {
      if (err instanceof StorageLimitError) toast.error(err.message);
    } finally {
      setUploadingCover(false);
    }
  };

  const [form, setForm] = useState({
    name: '', price: '', costPrice: '', markupPercent: '', category: 'hamburgueres' as string,
    image: '🍔', removableIngredients: '', extras: '',
    ingredients: '', description: '',
    manageStock: false, stockQuantity: '0', lowStockThreshold: '5',
    soldByWeight: false,
    codigoBarras: '',
    dataVencimento: '' as string,
    lote: '' as string,
    alertaVencimento: false,
    prepTimeMin: '0',
  });

  // Carrega sessão atual e contexto do admin
  const bootstrapSession = async () => {
    setAuthLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setAuthenticated(false);
        setCurrentAdmin(null);
        setActiveOrgId(null);
        setAllOrgs([]);
        return;
      }
      // Carrega todas as roles do usuário e determina o tier
      const { data: rolesData } = await supabase
        .from('user_roles' as any)
        .select('role')
        .eq('user_id', user.id);
      const roleList = (rolesData || []).map((r: any) => r.role);
      const isSuper = roleList.includes('super_admin') || roleList.includes('master');
      const isMasterAdmin = roleList.includes('master_admin');
      const isAdminLojista = roleList.includes('admin');
      const tier: 'super' | 'master' | 'admin' | null =
        isSuper ? 'super' : isMasterAdmin ? 'master' : isAdminLojista ? 'admin' : null;

      // Org do usuário (lojista tem sua própria)
      const { data: ownOrg } = await supabase
        .from('organizations')
        .select('*')
        .eq('owner_id', user.id)
        .maybeSingle();

      // Fallback: dono de org sem linha em user_roles → trata como admin
      let effectiveTier: 'super' | 'master' | 'admin' | null = tier;
      if (!effectiveTier && ownOrg?.id) effectiveTier = 'admin';

      if (!effectiveTier) {
        // NÃO desloga — mantém sessão e apenas indica falta de permissão.
        setAuthenticated(false);
        setCurrentAdmin(null);
        setActiveOrgId(null);
        setError('Esta conta não tem permissão de administrador.');
        return;
      }

      const adminCtx: AdminUser = {
        id: user.id,
        username: user.email || '',
        tier: effectiveTier,
        organization_id: ownOrg?.id ?? null,
      };
      setCurrentAdmin(adminCtx);

      // Lista de lojas disponíveis conforme o tier
      let initialOrg: string | null = ownOrg?.id ?? null;
      if (tier === 'super') {
        const { data: orgs } = await supabase.from('organizations').select('id, name, slug').order('name');
        setAllOrgs((orgs as any) || []);
        if (!initialOrg && orgs && orgs.length) initialOrg = (orgs[0] as any).id;
      } else if (tier === 'master') {
        const { data: orgs } = await supabase
          .from('organizations').select('id, name, slug')
          .eq('master_id', user.id).order('name');
        setAllOrgs((orgs as any) || []);
        if (!initialOrg && orgs && orgs.length) initialOrg = (orgs[0] as any).id;
      } else {
        setAllOrgs(ownOrg ? [{ id: ownOrg.id, name: ownOrg.name, slug: ownOrg.slug }] : []);
      }

      setActiveOrgId(initialOrg);
      setAuthenticated(true);

      // O contexto público da loja é complementar ao shell administrativo.
      // Não bloqueia mais a abertura do ADM caso a leitura pública demore.
      if (initialOrg) {
        void setOrgId(initialOrg).catch((e) => {
          console.error('[Admin] setOrgId failed', e);
        });
      }
    } catch (e) {
      console.error('[Admin] bootstrapSession failed', e);
      setError('Não foi possível carregar o painel. Tente novamente.');
      setAuthenticated(false);
    } finally {
      setAuthLoading(false);
    }
  };


  useEffect(() => {
    bootstrapSession();
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        setAuthenticated(false);
        setCurrentAdmin(null);
      } else if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        bootstrapSession();
      }
    });
    return () => { sub.subscription.unsubscribe(); };
  }, []);

  const handleLogin = async () => {
    const u = loginEmail.trim().toLowerCase();
    const p = password;
    if (!u || !p) { setError('Informe email e senha'); return; }
    const { error: err } = await supabase.auth.signInWithPassword({ email: u, password: p });
    if (err) {
      setError(err.message === 'Invalid login credentials' ? 'Email ou senha incorretos' : err.message);
      return;
    }
    setError('');
    setPassword('');
    await bootstrapSession();
  };

  const handleLogout = async () => {
    await signOutCompletely('/admin');
  };

  const switchOrg = async (newOrgId: string) => {
    setActiveOrgId(newOrgId);
    await setOrgId(newOrgId);
  };

  const refreshOrgList = async () => {
    const { data: orgs } = await supabase.from('organizations').select('id, name, slug').order('name');
    setAllOrgs((orgs as any) || []);
  };

  const unlockMaster = async () => {
    if (!currentAdmin) return;
    if (currentAdmin.tier !== 'super' && currentAdmin.tier !== 'master') {
      setMasterError('Acesso restrito.'); return;
    }
    const { error: err } = await supabase.auth.signInWithPassword({
      email: currentAdmin.username,
      password: masterPassword,
    });
    if (err) { setMasterError('Senha incorreta.'); return; }
    setMasterUnlocked(true);
    setMasterPassword('');
    setMasterError('');
  };


  const resetForm = () => {
    if (productPreviewUrl) URL.revokeObjectURL(productPreviewUrl);
    setProductPreviewUrl(null);
    setForm({ name: '', price: '', costPrice: '', markupPercent: '', category: 'hamburgueres', image: '🍔', removableIngredients: '', extras: '', ingredients: '', description: '', manageStock: false, stockQuantity: '0', lowStockThreshold: '5', soldByWeight: false, codigoBarras: '', dataVencimento: '', lote: '', alertaVencimento: false, prepTimeMin: '0' });
    setEditingProduct(null);
    setShowForm(false);
  };

  const editProduct = (p: Product) => {
    if (productPreviewUrl) {
      URL.revokeObjectURL(productPreviewUrl);
      setProductPreviewUrl(null);
    }
    setForm({
      name: p.name, price: p.price.toString(),
      costPrice: p.costPrice == null ? '' : String(p.costPrice),
      markupPercent: p.markupPercent == null ? '' : String(p.markupPercent),
      category: p.category,
      image: p.image, removableIngredients: p.removableIngredients.join(', '),
      extras: p.extras.map(e => `${e.name}:${e.price}`).join(', '),
      ingredients: (p.ingredients || []).join('\n'),
      description: p.description || '',
      manageStock: Boolean(p.manageStock),
      stockQuantity: String(p.stockQuantity ?? 0),
      lowStockThreshold: String(p.lowStockThreshold ?? 5),
      soldByWeight: Boolean(p.soldByWeight),
      codigoBarras: (p as any).codigoBarras || '',
      dataVencimento: (p as any).dataVencimento || '',
      lote: (p as any).lote || '',
      alertaVencimento: Boolean((p as any).alertaVencimento),
      prepTimeMin: String((p as any).prepTimeMin ?? 0),
    });
    setEditingProduct(p);
    setShowForm(true);
  };

  const parsePricingNumber = (value: string) => {
    if (value.trim() === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };

  const formatPricingInput = (value: number) =>
    String(Math.round((value + Number.EPSILON) * 100) / 100);

  const handleCostPriceChange = (value: string) => {
    setForm(prev => {
      const cost = parsePricingNumber(value);
      const markup = parsePricingNumber(prev.markupPercent);
      const suggestedPrice = cost !== null && cost >= 0 && markup !== null && markup >= -100
        ? formatPricingInput(cost * (1 + markup / 100))
        : prev.price;
      return { ...prev, costPrice: value, price: suggestedPrice };
    });
  };

  const handleMarkupPercentChange = (value: string) => {
    setForm(prev => {
      const cost = parsePricingNumber(prev.costPrice);
      const markup = parsePricingNumber(value);
      const suggestedPrice = cost !== null && cost >= 0 && markup !== null && markup >= -100
        ? formatPricingInput(cost * (1 + markup / 100))
        : prev.price;
      return { ...prev, markupPercent: value, price: suggestedPrice };
    });
  };

  const handleSellingPriceChange = (value: string) => {
    setForm(prev => {
      const cost = parsePricingNumber(prev.costPrice);
      const price = parsePricingNumber(value);
      const markup = cost !== null && cost > 0 && price !== null && price >= 0
        ? formatPricingInput(((price / cost) - 1) * 100)
        : prev.markupPercent;
      return { ...prev, price: value, markupPercent: markup };
    });
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (productPreviewUrl) URL.revokeObjectURL(productPreviewUrl);
    const url = URL.createObjectURL(file);
    console.log('URL do Preview:', url);
    setProductPreviewUrl(url);
    setUploading(true);
    try {
      const uploadedUrl = await uploadProductImage(file, activeOrgId!, { preserveOriginal: true });
      setForm(prev => ({ ...prev, image: uploadedUrl }));
    } catch (err) {
      alert(err instanceof StorageLimitError ? err.message : 'Erro ao enviar imagem. Tente novamente.');
      console.error(err);
      URL.revokeObjectURL(url);
      setProductPreviewUrl(null);
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const saveProduct = async () => {
    if (!form.name.trim() || !form.price) {
      toast.error('Preencha nome e preço do produto.');
      return;
    }
    if (!activeOrgId) { toast.error('Selecione uma loja primeiro.'); return; }

    const costPrice = form.costPrice.trim() === '' ? null : Number(form.costPrice);
    const markupPercent = form.markupPercent.trim() === '' ? null : Number(form.markupPercent);
    if (costPrice !== null && (!Number.isFinite(costPrice) || costPrice < 0)) {
      toast.error('Informe um custo válido, maior ou igual a zero.');
      return;
    }
    if (markupPercent !== null && (!Number.isFinite(markupPercent) || markupPercent < -100)) {
      toast.error('Informe um percentual válido, maior ou igual a -100%.');
      return;
    }

    // Garante que a requisição carrega o token do usuário logado (RLS)
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      toast.error('Sessão expirada. Faça login novamente para salvar produtos.');
      return;
    }

    const parsedExtras = form.extras.split(',').map(s => s.trim()).filter(Boolean).map(s => {
      const [name, price] = s.split(':');
      return { name: name?.trim() || '', price: parseFloat(price) || 0 };
    });
    const removable = form.removableIngredients.split(',').map(s => s.trim()).filter(Boolean);

    const ingredientsList = form.ingredients.split(/\r?\n|,/).map(s => s.trim()).filter(Boolean);

    const dbPayload: any = {
      organization_id: activeOrgId,
      name: form.name.trim(),
      price: parseFloat(form.price) || 0,
      cost_price: costPrice,
      markup_percent: markupPercent,
      category: form.category || 'outros',
      image: form.image.trim() || '🍔',
      removable_ingredients: removable,
      extras: parsedExtras,
      ingredients: ingredientsList,
      description: form.description.trim(),
      // Ao editar, preserve a disponibilidade atual. O banco continua sendo a autoridade
      // para bloqueios automáticos por estoque insuficiente de ingredientes.
      available: editingProduct ? editingProduct.available !== false : true,
      manage_stock: form.manageStock,
      stock_quantity: Math.max(0, parseInt(form.stockQuantity, 10) || 0),
      low_stock_threshold: Math.max(0, parseInt(form.lowStockThreshold, 10) || 0),
      sold_by_weight: form.soldByWeight,
      codigo_barras: form.codigoBarras.trim() || null,
      data_vencimento: form.dataVencimento || null,
      lote: form.lote.trim() || null,
      alerta_vencimento: form.alertaVencimento,
      prep_time_min: Math.max(0, parseInt(form.prepTimeMin, 10) || 0),
    };

    // Colunas que não podem ser removidas do payload (essenciais)
    const REQUIRED_PRODUCT_COLUMNS = new Set(['organization_id', 'name', 'price', 'category', 'image']);
    const payload: any = { ...dbPayload };
    const droppedColumns: string[] = [];

    let data: any;
    try {
      // Auto-cura: se o banco externo não tiver alguma coluna opcional (PGRST204),
      // removemos a coluna do payload e tentamos de novo.
      for (let attempt = 0; attempt < 12; attempt++) {
        const { data: savedProduct, error } = editingProduct
          ? await supabase.from('products').update(payload).eq('id', editingProduct.id).select().maybeSingle()
          : await supabase.from('products').insert(payload).select().maybeSingle();
        if (!error) { data = savedProduct; break; }

        const missing = error.code === 'PGRST204'
          ? (error.message.match(/'([^']+)' column/) || [])[1]
          : undefined;
        if (!missing || REQUIRED_PRODUCT_COLUMNS.has(missing) || !(missing in payload)) throw error;
        delete payload[missing];
        droppedColumns.push(missing);
      }
    } catch (err) {
      showDatabaseError('saveProduct', err);
      return;
    }

    if (droppedColumns.length) {
      console.warn('[saveProduct] colunas ausentes no banco e ignoradas:', droppedColumns);
      toast.warning(`Produto salvo, mas algumas colunas não existem no banco: ${droppedColumns.join(', ')}`);
    }


    if (editingProduct) {
      setProducts(prev => prev.map(p => p.id === editingProduct.id ? {
        ...p, ...dbPayload, removableIngredients: removable, ingredients: ingredientsList, description: dbPayload.description,
        manageStock: dbPayload.manage_stock, stockQuantity: dbPayload.stock_quantity, lowStockThreshold: dbPayload.low_stock_threshold,
        costPrice: dbPayload.cost_price, markupPercent: dbPayload.markup_percent,
        soldByWeight: dbPayload.sold_by_weight,
        codigoBarras: dbPayload.codigo_barras || '',
        dataVencimento: dbPayload.data_vencimento,
        lote: dbPayload.lote || '',
        alertaVencimento: dbPayload.alerta_vencimento,
      } as Product : p));
    } else if (data) {
      setProducts(prev => [...prev, {
        id: data.id, name: data.name, price: Number(data.price),
        costPrice: (data as any).cost_price == null ? null : Number((data as any).cost_price),
        markupPercent: (data as any).markup_percent == null ? null : Number((data as any).markup_percent),
        category: data.category as Product['category'], image: data.image,
        removableIngredients: (data.removable_ingredients as string[]) || [],
        extras: (data.extras as { name: string; price: number }[]) || [],
        isCombo: data.is_combo || false,
        ingredients: ((data as any).ingredients as string[]) || [],
        description: (data as any).description || '',
        available: (data as any).available !== false,
        ingredientStockBlocked: Boolean((data as any).ingredient_stock_blocked),
        manageStock: Boolean((data as any).manage_stock),
        stockQuantity: Number((data as any).stock_quantity ?? 0),
        lowStockThreshold: Number((data as any).low_stock_threshold ?? 5),
        soldByWeight: Boolean((data as any).sold_by_weight),
        codigoBarras: (data as any).codigo_barras || '',
        dataVencimento: (data as any).data_vencimento || null,
        lote: (data as any).lote || '',
        alertaVencimento: Boolean((data as any).alerta_vencimento),
      }]);
    }
    toast.success(editingProduct ? 'Produto atualizado!' : 'Produto cadastrado!');
    resetForm();
  };


  const deleteProduct = async (id: string) => {
    if (!confirm('Tem certeza que deseja excluir este produto?')) return;
    await supabase.from('products').delete().eq('id', id);
    setProducts(prev => prev.filter(p => p.id !== id));
  };

  const saveSettingsHandler = async () => {
    try {
      await saveSettingsToDb(settings);
      toast.success('Configurações salvas com sucesso!');
    } catch {
      // persistSettingsFields já exibe o erro exato; os uploads salvos continuam válidos.
    }
  };

  const updateBannerField = async (idx: number, field: string, value: any) => {
    const banners = [...settings.banners];
    banners[idx] = { ...banners[idx], [field]: value };
    const updated = { ...settings, banners };
    setSettings(updated);
    await saveSettingsToDb(updated);
  };

  const isImageUrl = (str: string) => str.startsWith('http') || str.startsWith('/');

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!authenticated) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-6 px-6">
        <div className="w-16 h-16 rounded-full bg-primary/20 flex items-center justify-center">
          <Lock className="w-8 h-8 text-primary" />
        </div>
        <h1 className="text-2xl font-bold">Painel Administrativo</h1>
        <div className="w-full max-w-xs space-y-3">
          <input type="email" placeholder="Email" value={loginEmail} autoComplete="email"
            onChange={e => setLoginEmail(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleLogin()}
            className="w-full px-4 py-4 bg-muted rounded-xl text-lg outline-none focus:ring-2 focus:ring-primary text-center" />
          <input type="password" placeholder="Senha" value={password} autoComplete="current-password"
            onChange={e => setPassword(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleLogin()}
            className="w-full px-4 py-4 bg-muted rounded-xl text-lg outline-none focus:ring-2 focus:ring-primary text-center" maxLength={72} />
          {error && <p className="text-secondary text-sm text-center">{error}</p>}
          <button onClick={handleLogin} className="touch-btn w-full bg-primary text-primary-foreground py-4 rounded-xl">Entrar</button>
          <p className="text-[11px] text-muted-foreground text-center leading-relaxed">
            Apenas o ADM Master cria contas de administrador.<br />
            Clientes não devem usar este painel.
          </p>
        </div>
        <Link to={getKioskHomePath()} className="text-muted-foreground text-sm hover:text-foreground">← Voltar ao Totem</Link>
        <p className="text-[11px] text-muted-foreground mt-4">Desenvolvido by VisionTek</p>
      </div>
    );
  }

  return (
    <div className="admin-shell min-h-screen pb-8 text-zinc-100">
      <InstallAppButton />

      {/* === Header premium === */}
      <header className="sticky top-0 z-40 px-5 pt-5 pb-3 bg-[#0B0B0D]/85 backdrop-blur-xl border-b border-white/[0.04] flex items-center justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <Link to={getKioskHomePath()} aria-label="Voltar" className="md:hidden text-zinc-500 hover:text-white">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-[#FF7A00] to-[#FF9D42] flex items-center justify-center shadow-[0_8px_24px_-6px_rgba(255,122,0,0.55)]">
            <Crown className="w-5 h-5 text-white" strokeWidth={2.5} />
          </div>
          <div className="min-w-0">
            <h1 className="text-base font-bold tracking-tight text-white truncate">Painel Admin</h1>
            {currentAdmin && (
              <p className="text-[11px] text-zinc-500 truncate">
                {currentAdmin.tier === 'super' ? 'Super Admin' : currentAdmin.tier === 'master' ? 'Master' : 'Lojista'} · {currentAdmin.username}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={enableAdminPush} className="relative p-2.5 rounded-full bg-white/5 border border-white/10 hover:bg-white/10 transition-colors" aria-label="Ativar notificações push" title="Ativar notificações push">
            <Bell className="w-4 h-4 text-zinc-300" />
            <span className="absolute top-2 right-2 w-2 h-2 bg-[#FF7A00] rounded-full ring-2 ring-[#0B0B0D]"></span>
          </button>
          <button
            onClick={handleLogout}
            className="p-2.5 rounded-full bg-white/5 border border-white/10 text-zinc-400 hover:text-red-400 hover:border-red-400/30 transition-colors"
            aria-label="Sair"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* === Store row + Abrir loja === */}
      <div className="px-5 pt-5 flex items-center gap-2">
        {(currentAdmin?.tier === 'super' || currentAdmin?.tier === 'master') ? (
          <div className="flex-1 [&_button]:!bg-white/[0.04] [&_button]:!border-white/10 [&_button]:!rounded-2xl [&_button]:!text-zinc-100">
            <OrgSwitcher
              orgs={allOrgs as any}
              activeOrgId={activeOrgId}
              onChange={switchOrg}
              onConsolidated={() => setTab('multilojas')}
              consolidatedActive={tab === 'multilojas'}
            />
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-between px-4 py-3 rounded-2xl bg-white/[0.04] border border-white/10">
            <div className="flex items-center gap-2.5 min-w-0">
              <Store className="w-4 h-4 text-[#FF7A00] flex-shrink-0" />
              <span className="text-sm font-medium text-white truncate">{org?.name || 'Loja'}</span>
            </div>
          </div>
        )}
        {(() => {
          const activeSlug = allOrgs.find(o => o.id === activeOrgId)?.slug || org?.slug;
          if (!activeSlug) return null;
          return (
            <a
              href={getKioskHomePath(activeSlug)}
              target="_blank"
              rel="noopener noreferrer"
              className="px-4 py-3 border border-[#FF7A00]/40 rounded-2xl text-[#FF7A00] font-bold text-[11px] uppercase tracking-widest whitespace-nowrap flex items-center gap-1.5 hover:bg-[#FF7A00]/10 transition-colors active:scale-95"
              title="Abrir minha loja em nova aba"
            >
              <ExternalLink className="w-3.5 h-3.5" /> Abrir loja
            </a>
          );
        })()}
      </div>

      {/* === Tab card grid (primary nav) === */}
      {(() => {
        const ALL_TABS = [
          { key: 'dashboard' as const, label: 'Dashboard', icon: Zap, requires: 'admin' as const, quick: true },
          { key: 'orders' as const, label: 'Pedidos', icon: ClipboardList, requires: 'admin' as const, quick: true },
          { key: 'mesas' as const, label: 'Mesas', icon: MapPin, requires: 'admin' as const, quick: true },
          { key: 'products' as const, label: 'Produtos', icon: Boxes, requires: 'admin' as const, quick: true },
          { key: 'leads' as const, label: 'Clientes', icon: Users, requires: 'admin' as const, quick: true },
          { key: 'financeiro' as const, label: 'Financeiro', icon: CreditCard, requires: 'admin' as const, quick: true },
          { key: 'settings' as const, label: 'Configuração', icon: Settings, requires: 'admin' as const },
          { key: 'senhas' as const, label: 'Painel de Senhas (TV)', icon: Bell, requires: 'admin' as const },
          { key: 'banners' as const, label: 'Banners', icon: Megaphone, requires: 'admin' as const },
          { key: 'coupons' as const, label: 'Cupons', icon: Ticket, requires: 'admin' as const },
          { key: 'loyalty' as const, label: 'Fidelidade', icon: Award, requires: 'admin' as const },
          { key: 'crm' as const, label: 'CRM', icon: Users, requires: 'admin' as const },
          { key: 'entregadores' as const, label: 'Entregadores', icon: Truck, requires: 'admin' as const },
          { key: 'bairros' as const, label: 'Bairros', icon: Truck, requires: 'admin' as const },
          { key: 'area_cep' as const, label: 'Área CEP', icon: MapPin, requires: 'admin' as const },
          { key: 'delivery' as const, label: 'Delivery', icon: Truck, requires: 'admin' as const },
          { key: 'logistica' as const, label: 'Logística', icon: Truck, requires: 'admin' as const },
          { key: 'rotaIA' as const, label: 'Roteirização IA', icon: Sparkles, requires: 'admin' as const },
          { key: 'prime' as const, label: 'Vision Prime', icon: Crown, requires: 'admin' as const },
          { key: 'parcerias' as const, label: 'Parcerias', icon: Share2, requires: 'admin' as const },
          { key: 'operacao' as const, label: 'Operação', icon: Settings, requires: 'admin' as const },
          { key: 'assistente' as const, label: 'Assistente Vision', icon: Sparkles, requires: 'admin' as const },
          { key: 'tema' as const, label: 'Personalização Visual', icon: Palette, requires: 'admin' as const },
          { key: 'impressao' as const, label: 'Impressão Térmica', icon: Printer, requires: 'admin' as const },
          { key: 'estoque' as const, label: 'Estoque Inteligente', icon: Boxes, requires: 'admin' as const },
          { key: 'preditivo' as const, label: 'IA Estoque Preditivo', icon: Sparkles, requires: 'admin' as const },
          { key: 'assinatura' as const, label: 'Assinatura', icon: Crown, requires: 'admin' as const },
          { key: 'fiscal' as const, label: 'Fiscal', icon: FileText, requires: 'admin' as const },
          { key: 'pdv_operadores' as const, label: 'Operadores PDV', icon: Users, requires: 'admin' as const },
          { key: 'admins' as const, label: 'Lojas', icon: Shield, requires: 'master' as const },
          { key: 'multilojas' as const, label: 'Multi-Lojas', icon: Building2, requires: 'master' as const },
          { key: 'plans' as const, label: 'Planos', icon: Shield, requires: 'super' as const },
          { key: 'onesignal' as const, label: 'Push (OneSignal)', icon: Bell, requires: 'super' as const },
          { key: 'billing' as const, label: 'Cobrança Master', icon: CreditCard, requires: 'super' as const },
          { key: 'parcerias_map' as const, label: 'Mapa Parcerias', icon: Share2, requires: 'super' as const },
          { key: 'super' as const, label: 'Super', icon: Shield, requires: 'super' as const },
        ];
        const tier = currentAdmin?.tier;
        const allowed = ALL_TABS.filter(t => {
          if (t.requires === 'admin') return true;
          if (t.requires === 'master') return tier === 'super' || tier === 'master';
          if (t.requires === 'super') return tier === 'super';
          return false;
        });
        const quickTabs = allowed.filter(t => (t as any).quick);
        const drawerTabs = allowed.filter(t => !(t as any).quick);

        return (
          <div className="flex gap-3 px-5 pt-6 pb-2 overflow-x-auto no-scrollbar">
            {quickTabs.map(t => {
              const active = tab === t.key;
              const Icon = t.icon;
              return (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  className={`flex flex-col items-center justify-center min-w-[76px] h-[76px] rounded-2xl transition-all duration-200 active:scale-95 ${
                    active
                      ? 'bg-white/[0.06] border-b-2 border-[#FF7A00] ring-1 ring-[#FF7A00]/30 shadow-[0_0_20px_-8px_rgba(255,122,0,0.6)]'
                      : 'bg-white/[0.03] border border-white/[0.06] hover:border-white/15'
                  }`}
                >
                  <Icon className={`w-5 h-5 mb-1.5 ${active ? 'text-[#FF7A00]' : 'text-zinc-400'}`} strokeWidth={2} />
                  <span className={`text-[10px] font-bold uppercase tracking-wide ${active ? 'text-[#FF7A00]' : 'text-zinc-400'}`}>
                    {t.label.length > 9 ? t.label.slice(0, 8) : t.label}
                  </span>
                </button>
              );
            })}
            <Sheet>
              <SheetTrigger asChild>
                <button className="flex flex-col items-center justify-center min-w-[76px] h-[76px] rounded-2xl bg-white/[0.03] border border-white/[0.06] text-zinc-400 hover:border-white/15 transition-all active:scale-95">
                  <Menu className="w-5 h-5 mb-1.5" strokeWidth={2} />
                  <span className="text-[10px] font-bold uppercase tracking-wide">Mais</span>
                </button>
              </SheetTrigger>
              <SheetContent side="left" className="w-[300px] sm:w-[340px] bg-[#0B0B0D] border-r border-white/[0.06] text-zinc-100 p-0 overflow-y-auto">
                <SheetHeader className="px-5 py-4 border-b border-white/[0.06]">
                  <SheetTitle className="text-white text-left flex items-center gap-2">
                    <Menu className="w-5 h-5 text-[#FF7A00]" /> Mais ferramentas
                  </SheetTitle>
                </SheetHeader>
                <div className="p-3 flex flex-col gap-1.5">
                  {drawerTabs.map(t => {
                    const active = tab === t.key;
                    const Icon = t.icon;
                    return (
                      <SheetClose asChild key={t.key}>
                        <button
                          onClick={() => setTab(t.key)}
                          className={`w-full text-left px-4 py-3 rounded-xl text-sm flex items-center gap-3 border transition-colors ${
                            active
                              ? 'bg-[#FF7A00]/10 text-[#FF7A00] border-[#FF7A00]/40'
                              : 'bg-white/[0.03] text-zinc-300 border-white/[0.06] hover:border-white/15 hover:text-white'
                          }`}
                        >
                          {Icon && <Icon className="w-4 h-4 flex-shrink-0" />}
                          <span className="truncate font-medium">{t.label}</span>
                        </button>
                      </SheetClose>
                    );
                  })}
                </div>
              </SheetContent>
            </Sheet>
          </div>
        );
      })()}

      {/* Blindagem visual: imagens sempre em cores originais sRGB, sem filtros/inversão/mix-blend */}
      <style>{`
        .admin-shell img{
          filter:none !important;
          -webkit-filter:none !important;
          mix-blend-mode:normal !important;
          opacity:1 !important;
          background:transparent !important;
          color-scheme:light !important;
          image-rendering:auto !important;
        }
      `}</style>


      <RuntimeErrorBoundary resetKey={tab} compact homeHref="/admin?tab=orders">
      <Suspense fallback={
        <div className="mx-4 mt-6 kiosk-card p-6 flex items-center justify-center gap-3 text-sm text-zinc-400">
          <Loader2 className="w-5 h-5 animate-spin text-[#FF7A00]" />
          <span>Carregando módulo...</span>
        </div>
      }>
      {/* Bloqueio por inadimplência (apenas lojista) */}
      {currentAdmin?.tier === 'admin' && (subscriptionStatus === 'inadimplente' || subscriptionStatus === 'cancelado') && tab !== 'assinatura' ? (
        <div className="mx-4 mt-6 kiosk-card p-8 text-center space-y-4 border-2 border-destructive/40">
          <div className="w-16 h-16 mx-auto rounded-full bg-destructive/15 text-destructive flex items-center justify-center">
            <Lock className="w-8 h-8" />
          </div>
          <h2 className="text-2xl font-black">Painel bloqueado</h2>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            Sua assinatura está <b className="text-destructive">{subscriptionStatus === 'cancelado' ? 'cancelada' : 'em atraso'}</b>.
            Para reativar todos os recursos, regularize o pagamento.
          </p>
          <button onClick={() => setTab('assinatura')}
            className="touch-btn bg-primary text-primary-foreground px-6 py-3 rounded-xl font-bold inline-flex items-center gap-2">
            <CreditCard className="w-4 h-4" /> Ir para Assinatura
          </button>
        </div>
      ) : (
      <>
      <VencimentoBanner organizationId={activeOrgId} />
      {tab === 'orders' && <OrdersPanel organizationId={activeOrgId} />}
      {tab === 'mesas' && (
        <MesasPanel
          organizationId={activeOrgId}
          orgSlug={allOrgs.find(o => o.id === activeOrgId)?.slug || org?.slug || null}
        />
      )}
      {tab === 'dashboard' && <DashboardPanel organizationId={activeOrgId} onNavigate={(t) => setTab(t as any)} />}
      {tab === 'senhas' && (
        <SenhasPanel
          organizationId={activeOrgId}
          orgSlug={allOrgs.find(o => o.id === activeOrgId)?.slug || org?.slug || null}
        />
      )}
      {tab === 'coupons' && (
        <FeatureGate feature="coupons" label="Cupons de Desconto">
          <CouponsPanel organizationId={activeOrgId} />
        </FeatureGate>
      )}
      {tab === 'loyalty' && (
        <FeatureGate feature="loyalty" label="Programa de Fidelidade">
          <LoyaltyPanel organizationId={activeOrgId} />
        </FeatureGate>
      )}
      {tab === 'crm' && (
        <FeatureGate feature="crm" label="CRM — Marketing de Retenção">
          <CrmPanel organizationId={activeOrgId} storeName={settings.storeName} />
        </FeatureGate>
      )}
      {tab === 'leads' && (
        <ClientesLeadsPanel organizationId={activeOrgId} storeName={settings.storeName} />
      )}
      {tab === 'entregadores' && (
        <EntregadoresPanel organizationId={activeOrgId} />
      )}
      {tab === 'bairros' && (
        <BairrosPanel organizationId={activeOrgId} />
      )}
      {tab === 'area_cep' && (
        <AreaAtendimentoPanel organizationId={activeOrgId} />
      )}
      {tab === 'delivery' && (
        <DeliveryPanel organizationId={activeOrgId} />
      )}
      {tab === 'logistica' && (
        <LogisticaPanel organizationId={activeOrgId} />
      )}
      {tab === 'prime' && (
        <FeatureGate feature="vision_prime" label="Clube Vision Prime">
          <VisionPrimePanel organizationId={activeOrgId} />
        </FeatureGate>
      )}
      {tab === 'parcerias' && (
        <FeatureGate feature="co_marketing" label="Co-Marketing Hub">
          <CoMarketingPanel organizationId={activeOrgId} />
        </FeatureGate>
      )}
      {tab === 'operacao' && (
        <OperacaoPanel organizationId={activeOrgId} />
      )}
      {tab === 'assistente' && (
        <FeatureGate feature="vision_assistant" label="Assistente Vision (IA)">
          <AssistenteVisionPanel organizationId={activeOrgId} storeName={settings.storeName} whatsappNumber={settings.whatsappNumber} />
        </FeatureGate>
      )}
      {tab === 'tema' && (
        <PersonalizacaoVisualPanel organizationId={activeOrgId} />
      )}
      {tab === 'impressao' && (
        <FeatureGate feature="print_receipt" label="Impressão Térmica Automática">
          <ImpressaoTermicaPanel organizationId={activeOrgId} />
        </FeatureGate>
      )}
      {tab === 'financeiro' && (
        <FinanceiroPanel organizationId={activeOrgId} />
      )}
      {tab === 'estoque' && (
        <FeatureGate feature="estoque_inteligente" label="Estoque Inteligente">
          <EstoqueInteligentePanel organizationId={activeOrgId} />
        </FeatureGate>
      )}
      {tab === 'preditivo' && (
        <FeatureGate feature="estoque_inteligente" label="IA de Estoque Preditivo">
          <EstoquePreditivPanel organizationId={activeOrgId} />
        </FeatureGate>
      )}
      {tab === 'rotaIA' && (
        <RoteirizacaoIAPanel organizationId={activeOrgId} />
      )}
      {tab === 'assinatura' && (
        <AssinaturaPanel organizationId={activeOrgId} />
      )}
      {tab === 'onesignal' && currentAdmin?.tier === 'super' && (
        <OneSignalPanel />
      )}
      {tab === 'billing' && currentAdmin?.tier === 'super' && (
        <MasterBillingPanel />
      )}


      {tab === 'parcerias_map' && currentAdmin?.tier === 'super' && (
        <CoMarketingGlobalMap />
      )}
      {tab === 'plans' && currentAdmin?.tier === 'super' && (
        <PlansMatrixPanel />
      )}
      {tab === 'super' && currentAdmin?.tier === 'super' && (
        <SuperAdminPanel currentUserId={currentAdmin.id} />
      )}
      {tab === 'admins' && (currentAdmin?.tier === 'super' || currentAdmin?.tier === 'master') && (
        masterUnlocked ? (
          <MasterPanel currentAdminId={currentAdmin.id} />
        ) : (
          <MasterUnlockGate masterPassword={masterPassword} setMasterPassword={setMasterPassword} masterError={masterError} unlockMaster={unlockMaster} />
        )
      )}
      {tab === 'multilojas' && (currentAdmin?.tier === 'super' || currentAdmin?.tier === 'master') && (
        <MultiLojasPanel tier={currentAdmin.tier as 'master' | 'super'} userId={currentAdmin.id} />
      )}


      {tab === 'products' && (
        <div className="px-4 space-y-4">
          <button onClick={() => { resetForm(); setShowForm(true); }} className="touch-btn w-full bg-success text-success-foreground py-3 rounded-xl flex items-center justify-center gap-2">
            <Plus className="w-5 h-5" /> Adicionar Novo Produto
          </button>

          {showForm && (
            <div className="kiosk-card p-4 space-y-3">
              <h3 className="font-bold text-lg">{editingProduct ? '✏️ Editar Produto' : '➕ Novo Produto'}</h3>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Nome do Produto</label>
                <input placeholder="Ex: X-Burguer Especial" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="w-full px-3 py-3 bg-muted rounded-lg outline-none focus:ring-2 focus:ring-primary" maxLength={100} />
              </div>
              {/* Tipo de venda: Unidade x Quilo (Balança) */}
              <div className="rounded-xl p-3 bg-zinc-900 border border-zinc-800 space-y-2">
                <label className="text-xs text-zinc-400 block">⚖️ Tipo de Venda</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setForm({ ...form, soldByWeight: false })}
                    className={`touch-btn py-2.5 rounded-lg text-sm font-semibold border transition-colors ${!form.soldByWeight ? 'bg-amber-500 text-zinc-950 border-amber-500' : 'bg-zinc-950 text-zinc-300 border-zinc-700 hover:border-zinc-500'}`}
                  >
                    Por Unidade
                  </button>
                  <button
                    type="button"
                    onClick={() => setForm({ ...form, soldByWeight: true })}
                    className={`touch-btn py-2.5 rounded-lg text-sm font-semibold border transition-colors ${form.soldByWeight ? 'bg-amber-500 text-zinc-950 border-amber-500' : 'bg-zinc-950 text-zinc-300 border-zinc-700 hover:border-zinc-500'}`}
                  >
                    Por Quilo (Balança)
                  </button>
                </div>
                {form.soldByWeight && (
                  <p className="text-[11px] text-amber-400/80">O totem multiplicará o peso lido na balança pelo preço por Kg.</p>
                )}
              </div>
              {/* Código de Barras (EAN) — leitor físico */}
              <div className="rounded-xl p-3 bg-zinc-900 border border-zinc-800 space-y-2">
                <label className="text-xs text-zinc-400 block">Código de Barras (EAN)</label>
                <div className="relative">
                  <Barcode className="absolute left-3 top-1/2 -translate-y-1/2 text-amber-500" size={18} />
                  <input
                    type="text"
                    inputMode="numeric"
                    autoComplete="off"
                    placeholder="Bipe ou digite o EAN-13"
                    value={form.codigoBarras}
                    onChange={e => setForm({ ...form, codigoBarras: e.target.value.replace(/\D/g, '').slice(0, 14) })}
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        const v = (e.target as HTMLInputElement).value.replace(/\D/g, '');
                        if (v.length >= 8 && v.length <= 14) {
                          setForm(f => ({ ...f, codigoBarras: v }));
                          (e.target as HTMLInputElement).blur();
                        }
                      }
                    }}
                    maxLength={14}
                    className="w-full pl-10 pr-3 py-3 bg-zinc-950 border border-zinc-800 text-white rounded-lg outline-none focus:ring-2 focus:ring-amber-500 font-mono tracking-wider"
                  />
                </div>
                <p className="text-[11px] text-zinc-500">Foque neste campo e bipe o produto. O leitor envia o código e pressiona Enter automaticamente.</p>
              </div>
              <div className="rounded-xl p-3 bg-muted/30 border border-border space-y-3">
                <div>
                  <h4 className="text-sm font-semibold">Precificação</h4>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Informe o custo e o acréscimo desejado para calcular o preço automaticamente. O preço final continua editável.
                  </p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">{form.soldByWeight ? 'Custo por Kg (R$)' : 'Custo do produto (R$)'}</label>
                    <input
                      placeholder={form.soldByWeight ? 'Ex: 32.00' : 'Ex: 12.00'}
                      type="number"
                      min="0"
                      step="0.01"
                      value={form.costPrice}
                      onChange={e => handleCostPriceChange(e.target.value)}
                      className="w-full px-3 py-3 bg-muted rounded-lg outline-none focus:ring-2 focus:ring-primary"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Acréscimo sobre o custo (%)</label>
                    <input
                      placeholder="Ex: 50"
                      type="number"
                      min="-100"
                      step="0.01"
                      value={form.markupPercent}
                      onChange={e => handleMarkupPercentChange(e.target.value)}
                      className="w-full px-3 py-3 bg-muted rounded-lg outline-none focus:ring-2 focus:ring-primary"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">{form.soldByWeight ? 'Preço por Kg (R$)' : 'Preço de venda (R$)'}</label>
                    <input
                      placeholder={form.soldByWeight ? 'Ex: 59.90' : 'Ex: 25.90'}
                      type="number"
                      min="0"
                      step="0.01"
                      value={form.price}
                      onChange={e => handleSellingPriceChange(e.target.value)}
                      className="w-full px-3 py-3 bg-muted rounded-lg outline-none focus:ring-2 focus:ring-primary"
                    />
                  </div>
                </div>
                {form.costPrice !== '' && form.price !== '' && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                    <div className="rounded-lg border border-border bg-background/50 px-3 py-2">
                      <span className="text-muted-foreground">{form.soldByWeight ? 'Resultado bruto estimado por Kg' : 'Resultado bruto estimado por unidade'}</span>
                      <strong className="block mt-1">
                        {formatCurrency((parsePricingNumber(form.price) || 0) - (parsePricingNumber(form.costPrice) || 0))}
                      </strong>
                    </div>
                    <div className="rounded-lg border border-border bg-background/50 px-3 py-2">
                      <span className="text-muted-foreground">Margem bruta estimada</span>
                      <strong className="block mt-1">
                        {(parsePricingNumber(form.price) || 0) > 0
                          ? `${((((parsePricingNumber(form.price) || 0) - (parsePricingNumber(form.costPrice) || 0)) / (parsePricingNumber(form.price) || 1)) * 100).toFixed(1)}%`
                          : '—'}
                      </strong>
                    </div>
                  </div>
                )}
                <p className="text-[11px] text-muted-foreground">
                  No Financeiro, uma ficha técnica completa tem prioridade. Este custo direto será usado apenas como fallback do CMV quando a ficha técnica não estiver completa.
                </p>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Categoria</label>
                <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} className="w-full px-3 py-3 bg-muted rounded-lg outline-none focus:ring-2 focus:ring-primary">
                  {(settings.categories || DEFAULT_CATEGORIES).map(c => {
                    const isUrl = typeof c.icon === 'string' && /^(https?:|\/|data:)/i.test(c.icon);
                    const prefix = isUrl ? '🍽️' : c.icon;
                    return <option key={c.key} value={c.key}>{prefix} {c.label}</option>;
                  })}
                </select>
              </div>
              {/* Image Upload */}
              <div>
                <label className="text-xs text-muted-foreground mb-1 block flex items-center gap-1">
                  <Image className="w-3 h-3" /> Foto do Produto
                </label>
                <div className="flex gap-2">
                  <label className={`flex-1 touch-btn flex items-center justify-center gap-2 py-3 rounded-lg cursor-pointer border-2 border-dashed border-border hover:border-primary transition-colors ${uploading ? 'opacity-50 pointer-events-none' : ''}`}>
                    {uploading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Upload className="w-5 h-5" />}
                    <span className="text-sm">{uploading ? 'Enviando...' : 'Subir Foto'}</span>
                    <input type="file" accept="image/*" onChange={handleImageUpload} className="hidden" disabled={uploading} />
                  </label>
                  <input placeholder="Ou emoji: 🍔" value={isImageUrl(form.image) ? '' : form.image} onChange={e => {
                    if (productPreviewUrl) {
                      URL.revokeObjectURL(productPreviewUrl);
                      setProductPreviewUrl(null);
                    }
                    setForm({ ...form, image: e.target.value });
                  }} className="w-24 px-3 py-3 bg-muted rounded-lg outline-none focus:ring-2 focus:ring-primary text-center text-2xl" maxLength={4} />
                </div>
                {(productPreviewUrl || form.image) && (
                  <div className="mt-2 flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">Preview:</span>
                    {productPreviewUrl ? (
                      <img
                        src={productPreviewUrl}
                        alt="Preview"
                        decoding="async"
                        className="w-16 h-16 object-cover rounded-lg invert-0 dark:invert-0 filter-none"
                        style={{ filter: 'none', mixBlendMode: 'normal', colorScheme: 'light', forcedColorAdjust: 'none', backgroundColor: 'transparent', opacity: 1 } as React.CSSProperties}
                      />
                    ) : isImageUrl(form.image) ? (
                      <img
                        src={form.image}
                        alt="Preview"
                        decoding="async"
                        className="w-16 h-16 object-cover rounded-lg invert-0 dark:invert-0 filter-none"
                        style={{ filter: 'none', mixBlendMode: 'normal', colorScheme: 'light', forcedColorAdjust: 'none', backgroundColor: 'transparent', opacity: 1 } as React.CSSProperties}
                      />
                    ) : (
                      <span className="text-3xl">{form.image}</span>
                    )}
                  </div>
                )}
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Ingredientes Removíveis (separados por vírgula)</label>
                <input placeholder="Ex: Cebola, Alface, Tomate" value={form.removableIngredients} onChange={e => setForm({ ...form, removableIngredients: e.target.value })} className="w-full px-3 py-3 bg-muted rounded-lg outline-none focus:ring-2 focus:ring-primary" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Adicionais (formato: Nome:Preço)</label>
                <input placeholder="Ex: Bacon:5, Queijo:4, Ovo:3" value={form.extras} onChange={e => setForm({ ...form, extras: e.target.value })} className="w-full px-3 py-3 bg-muted rounded-lg outline-none focus:ring-2 focus:ring-primary" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Ingredientes do Produto (um por linha)</label>
                <textarea
                  placeholder={'Ex:\nPão Brioche selado na manteiga\nBlend de Carne Bovina Artesanal (150g)\nQueijo Mussarela derretido'}
                  value={form.ingredients}
                  onChange={e => setForm({ ...form, ingredients: e.target.value })}
                  rows={6}
                  className="w-full px-3 py-3 bg-muted rounded-lg outline-none focus:ring-2 focus:ring-primary resize-y"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Descrição do Produto</label>
                <textarea
                  placeholder="Insira aqui o texto de marketing ou detalhes adicionais sobre o preparo deste sanduíche."
                  value={form.description}
                  onChange={e => setForm({ ...form, description: e.target.value })}
                  rows={4}
                  className="w-full px-3 py-3 bg-muted rounded-lg outline-none focus:ring-2 focus:ring-primary resize-y"
                />
              </div>

              {/* Estoque */}
              <div className="kiosk-card p-3 space-y-2 bg-muted/30 border border-border">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={form.manageStock} onChange={e => setForm({ ...form, manageStock: e.target.checked })} className="w-4 h-4 accent-primary" />
                  <span className="text-sm font-semibold">📦 Controlar estoque deste produto</span>
                </label>
                {form.manageStock && (
                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <div>
                      <label className="text-xs text-muted-foreground mb-1 block">Em estoque</label>
                      <input type="number" min="0" value={form.stockQuantity} onChange={e => setForm({ ...form, stockQuantity: e.target.value })} className="w-full px-3 py-2 bg-background rounded-lg outline-none focus:ring-2 focus:ring-primary text-sm" />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground mb-1 block">Alerta abaixo de</label>
                      <input type="number" min="0" value={form.lowStockThreshold} onChange={e => setForm({ ...form, lowStockThreshold: e.target.value })} className="w-full px-3 py-2 bg-background rounded-lg outline-none focus:ring-2 focus:ring-primary text-sm" />
                    </div>
                  </div>
                )}
                <p className="text-[11px] text-muted-foreground">Quando um pedido é criado, a quantidade é debitada automaticamente.</p>
              </div>

              {/* Tempo de preparo */}
              <div className="kiosk-card p-3 space-y-2 bg-muted/30 border border-border">
                <label className="text-sm font-semibold flex items-center gap-2">⏱️ Tempo de preparo deste produto (min)</label>
                <input
                  type="number"
                  min="0"
                  value={form.prepTimeMin}
                  onChange={e => setForm({ ...form, prepTimeMin: e.target.value })}
                  className="w-full px-3 py-2 bg-background rounded-lg outline-none focus:ring-2 focus:ring-primary text-sm"
                  placeholder="0"
                />
                <p className="text-[11px] text-muted-foreground">Somado ao tempo base da loja por unidade. Ex.: Pizza 15, Hambúrguer 8.</p>
              </div>

              {/* Validade & Lote */}
              <div className="kiosk-card p-3 space-y-2 bg-muted/30 border border-border">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold">📅 Controle de validade</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Data de vencimento</label>
                    <input
                      type="date"
                      value={form.dataVencimento}
                      onChange={e => setForm({ ...form, dataVencimento: e.target.value })}
                      className="w-full px-3 py-2 bg-background rounded-lg outline-none focus:ring-2 focus:ring-amber-500 text-sm"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Lote</label>
                    <input
                      type="text"
                      placeholder="Ex: L2026-A"
                      value={form.lote}
                      onChange={e => setForm({ ...form, lote: e.target.value })}
                      className="w-full px-3 py-2 bg-background rounded-lg outline-none focus:ring-2 focus:ring-amber-500 text-sm"
                    />
                  </div>
                </div>
                <label className="flex items-center justify-between gap-2 cursor-pointer pt-1">
                  <span className="text-xs">⚠️ Ativar alerta de vencimento (≤ 7 dias)</span>
                  <span className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${form.alertaVencimento ? 'bg-amber-500' : 'bg-muted'}`}>
                    <input
                      type="checkbox"
                      checked={form.alertaVencimento}
                      onChange={e => setForm({ ...form, alertaVencimento: e.target.checked })}
                      className="sr-only"
                    />
                    <span className={`inline-block h-4 w-4 transform rounded-full bg-background transition-transform ${form.alertaVencimento ? 'translate-x-4' : 'translate-x-0.5'}`} />
                  </span>
                </label>
              </div>


              <div className="flex gap-2 pt-2">
                <button onClick={saveProduct} className="touch-btn flex-1 bg-primary text-primary-foreground py-3 rounded-xl flex items-center justify-center gap-2"><Save className="w-4 h-4" /> Salvar</button>
                <button onClick={resetForm} className="touch-btn flex-1 bg-muted text-muted-foreground py-3 rounded-xl">Cancelar</button>
              </div>
            </div>
          )}

          {(settings.categories || DEFAULT_CATEGORIES).map(cat => {
            const catProducts = products.filter(p => p.category === cat.key);
            if (catProducts.length === 0) return null;
            return (
              <div key={cat.key}>
                <h3 className="font-bold text-sm text-muted-foreground mb-2 flex items-center gap-2">
                  {isImageUrl(cat.icon) ? (
                    <img src={cat.icon} alt="" className="w-5 h-5 object-cover rounded" />
                  ) : (
                    <span>{cat.icon}</span>
                  )}
                  <span>{cat.label}</span>
                </h3>
                <div className="space-y-2">
                  {catProducts.map(p => (
                    <div key={p.id} className="kiosk-card p-3 flex items-center gap-3">
                      {isImageUrl(p.image) ? (
                        <img src={p.image} alt={p.name} className="w-12 h-12 object-cover rounded-lg flex-shrink-0" />
                      ) : (
                        <span className="text-2xl flex-shrink-0">{p.image}</span>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <p className="font-bold text-sm truncate">{p.name}</p>
                          {p.alertaVencimento && (() => {
                            const st = vencimentoStatus(p.dataVencimento);
                            if (st === 'ok') return null;
                            return (
                              <span
                                title={vencimentoLabel(p.dataVencimento) + (p.lote ? ` · Lote ${p.lote}` : '')}
                                className={`flex-shrink-0 ${st === 'vencido' ? 'text-destructive' : 'text-amber-500'} animate-pulse`}
                              >
                                <AlertTriangle className="w-4 h-4" />
                              </span>
                            );
                          })()}
                        </div>
                        <p className="text-primary font-bold text-sm">{formatCurrency(p.price)}</p>
                        {p.alertaVencimento && p.dataVencimento && (
                          <p className={`text-[11px] font-semibold mt-0.5 ${vencimentoStatus(p.dataVencimento) === 'vencido' ? 'text-destructive' : vencimentoStatus(p.dataVencimento) === 'proximo' ? 'text-amber-500' : 'text-muted-foreground'}`}>
                            📅 {vencimentoLabel(p.dataVencimento)}{p.lote ? ` · Lote ${p.lote}` : ''}
                          </p>
                        )}
                        {p.manageStock && (
                          <p className={`text-[11px] font-semibold mt-0.5 ${(p.stockQuantity ?? 0) <= 0 ? 'text-destructive' : (p.stockQuantity ?? 0) <= (p.lowStockThreshold ?? 5) ? 'text-accent' : 'text-muted-foreground'}`}>
                            📦 {p.stockQuantity ?? 0} em estoque
                            {(p.stockQuantity ?? 0) <= 0 ? ' · esgotado' : (p.stockQuantity ?? 0) <= (p.lowStockThreshold ?? 5) ? ' · baixo' : ''}
                          </p>
                        )}
                      </div>
                      <button onClick={() => editProduct(p)} className="p-2 text-muted-foreground hover:text-primary"><Pencil className="w-5 h-5" /></button>
                      <button onClick={() => deleteProduct(p.id)} className="p-2 text-muted-foreground hover:text-destructive"><Trash2 className="w-5 h-5" /></button>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {tab === 'banners' && (
        <div className="px-4 space-y-4">
          <p className="text-xs text-muted-foreground">Banners promocionais exibidos na tela inicial. As alterações são salvas automaticamente no banco de dados.</p>
          {(settings.banners || []).map((banner, idx) => (
            <div key={banner.id} className="kiosk-card p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="font-bold text-sm">Banner #{idx + 1}</h4>
                <button onClick={async () => { const updated = { ...settings, banners: settings.banners.filter(b => b.id !== banner.id) }; setSettings(updated); await saveSettingsToDb(updated); }} className="p-1 text-muted-foreground hover:text-destructive"><Trash2 className="w-4 h-4" /></button>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Título</label>
                <input value={banner.title} onChange={e => updateBannerField(idx, 'title', e.target.value)} className="w-full px-3 py-3 bg-muted rounded-lg outline-none focus:ring-2 focus:ring-primary" maxLength={50} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Subtítulo</label>
                <input value={banner.subtitle} onChange={e => updateBannerField(idx, 'subtitle', e.target.value)} className="w-full px-3 py-3 bg-muted rounded-lg outline-none focus:ring-2 focus:ring-primary" maxLength={100} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block flex items-center gap-1">
                  <Image className="w-3 h-3" /> Imagem do Banner
                </label>
                <p className="text-[11px] text-muted-foreground mb-2">
                  Tamanho recomendado: 1920 × 768 px (proporção 2,5:1). Mantenha textos e elementos importantes no centro, pois a imagem pode ser recortada conforme a tela.
                </p>
                <div className="flex gap-2">
                  <label className={`flex-1 touch-btn flex items-center justify-center gap-2 py-3 rounded-lg cursor-pointer border-2 border-dashed border-border hover:border-primary transition-colors ${uploadingBannerIdx === idx ? 'opacity-50 pointer-events-none' : ''}`}>
                    {uploadingBannerIdx === idx ? <Loader2 className="w-5 h-5 animate-spin" /> : <Upload className="w-5 h-5" />}
                    <span className="text-sm">{uploadingBannerIdx === idx ? 'Enviando...' : 'Subir Foto'}</span>
                    <input type="file" accept="image/*" onChange={e => handleBannerImageUpload(e, idx)} className="hidden" disabled={uploadingBannerIdx === idx} />
                  </label>
                  <input placeholder="Ou emoji" value={isImageUrl(banner.image) ? '' : banner.image} onChange={e => updateBannerField(idx, 'image', e.target.value)} className="w-20 px-3 py-3 bg-muted rounded-lg outline-none focus:ring-2 focus:ring-primary text-center text-2xl" maxLength={4} />
                </div>
                {banner.image && (
                  <div className="mt-2 flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">Preview:</span>
                    {isImageUrl(banner.image) ? (
                      <img
                        src={banner.image}
                        alt="Preview"
                        className="w-16 h-16 object-cover rounded-lg filter-none opacity-100"
                        style={{ colorScheme: 'light', forcedColorAdjust: 'none', filter: 'none', mixBlendMode: 'normal', backgroundColor: 'transparent' } as React.CSSProperties}
                      />
                    ) : (
                      <span className="text-3xl">{banner.image}</span>
                    )}
                  </div>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Texto Badge</label>
                  <input value={banner.badgeText} onChange={e => updateBannerField(idx, 'badgeText', e.target.value)} className="w-full px-3 py-3 bg-muted rounded-lg outline-none focus:ring-2 focus:ring-primary" placeholder="🔥 PROMO" maxLength={20} />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Cor Badge</label>
                  <select value={banner.badgeColor} onChange={e => updateBannerField(idx, 'badgeColor', e.target.value)} className="w-full px-3 py-3 bg-muted rounded-lg outline-none focus:ring-2 focus:ring-primary">
                    {BADGE_COLORS.map(c => <option key={c} value={c}>{BADGE_COLOR_LABELS[c]}</option>)}
                  </select>
                </div>
              </div>
            </div>
          ))}

          <button onClick={async () => {
            const newBanner: BannerItem = { id: crypto.randomUUID(), title: 'Novo Banner', subtitle: 'Descrição da promoção', image: '🎉', badgeText: '🔥 NOVO', badgeColor: 'primary' };
            const updated = { ...settings, banners: [...(settings.banners || []), newBanner] };
            setSettings(updated);
            await saveSettingsToDb(updated);
          }} className="touch-btn w-full bg-muted text-muted-foreground py-3 rounded-xl flex items-center justify-center gap-2 border-2 border-dashed border-border">
            <Plus className="w-5 h-5" /> Adicionar Banner
          </button>
        </div>
      )}

      {tab === 'settings' && (
        <div className="px-4 space-y-4">
          <StorageUsageCard organizationId={activeOrgId} />


          <div className="kiosk-card p-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center ${settings.deliveryEnabled !== false ? 'bg-success/20 text-success' : 'bg-muted text-muted-foreground'}`}>
                  <Truck className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold leading-tight">Status da Entrega por Bairro</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {settings.deliveryEnabled !== false
                      ? 'Delivery liberado para os clientes.'
                      : 'Delivery pausado. Clientes só conseguem Retirada/Local.'}
                  </p>
                </div>
              </div>
              <button
                onClick={async () => {
                  const updated = { ...settings, deliveryEnabled: settings.deliveryEnabled === false ? true : false };
                  setSettings(updated);
                  await saveSettingsToDb(updated);
                }}
                role="switch"
                aria-checked={settings.deliveryEnabled !== false}
                className={`relative inline-flex h-7 w-12 flex-shrink-0 items-center rounded-full transition-colors ${settings.deliveryEnabled !== false ? 'bg-primary' : 'bg-muted'}`}
              >
                <span className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${settings.deliveryEnabled !== false ? 'translate-x-6' : 'translate-x-1'}`} />
              </button>
            </div>
          </div>

          {/* Configurações de Hardware - Balança */}
          <div className="rounded-2xl p-4 space-y-4 bg-zinc-900 border border-zinc-800">
            <div className="flex items-center gap-2">
              <div className="w-9 h-9 rounded-lg bg-amber-500/15 text-amber-400 flex items-center justify-center">⚖️</div>
              <div>
                <h3 className="font-bold text-white">Configurações de Hardware — Balança</h3>
                <p className="text-xs text-zinc-400">Define como o totem (PWA) lê a balança via cabo USB/Serial.</p>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-zinc-400 mb-1 block">Marca da Balança</label>
                <select
                  value={settings.balancaModelo || 'generic'}
                  onChange={async e => {
                    const updated = { ...settings, balancaModelo: e.target.value as any };
                    setSettings(updated);
                    await saveSettingsToDb(updated);
                  }}
                  className="w-full px-3 py-3 bg-zinc-950 border border-zinc-800 text-white rounded-lg outline-none focus:ring-2 focus:ring-amber-500"
                >
                  <option value="toledo">Toledo (Prix)</option>
                  <option value="filizola">Filizola</option>
                  <option value="urano">Urano</option>
                  <option value="elgin">Elgin</option>
                  <option value="generic">Genérica / String Bruta</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-zinc-400 mb-1 block">Velocidade (Baud Rate)</label>
                <select
                  value={String(settings.balancaBaudRate || 9600)}
                  onChange={async e => {
                    const updated = { ...settings, balancaBaudRate: parseInt(e.target.value, 10) || 9600 };
                    setSettings(updated);
                    await saveSettingsToDb(updated);
                  }}
                  className="w-full px-3 py-3 bg-zinc-950 border border-zinc-800 text-white rounded-lg outline-none focus:ring-2 focus:ring-amber-500"
                >
                  <option value="9600">9600 bps</option>
                  <option value="4800">4800 bps</option>
                </select>
              </div>
            </div>
            <p className="text-[11px] text-zinc-500">As preferências são herdadas automaticamente pelo Totem desta loja na próxima conexão da balança.</p>
          </div>


          <ChangePasswordCard />
          <div className="kiosk-card p-4 space-y-4">
            <h3 className="font-bold flex items-center gap-2"><Store className="w-5 h-5 text-primary" /> Nome do Restaurante</h3>
            <input placeholder="Ex: Vision Mídia" value={settings.storeName} onChange={e => setSettings({ ...settings, storeName: e.target.value })} className="w-full px-3 py-3 bg-muted rounded-lg outline-none focus:ring-2 focus:ring-primary" maxLength={50} />
          </div>

          <div className="kiosk-card p-4 space-y-4">
            <h3 className="font-bold flex items-center gap-2"><Image className="w-5 h-5 text-primary" /> Categorias</h3>
            <p className="text-xs text-muted-foreground">Adicione, edite ou remova categorias. As alterações são salvas automaticamente.</p>
            {(settings.categories || DEFAULT_CATEGORIES).map((cat, idx) => (
              <div key={cat.key} className="space-y-2 border border-border rounded-xl p-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground font-semibold">Categoria #{idx + 1}</span>
                  <button onClick={() => removeCategory(cat.key)} className="p-1 text-muted-foreground hover:text-destructive">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
                <div className="flex gap-2 items-center">
                  <div className="w-16 h-16 rounded-full bg-muted border border-border flex items-center justify-center overflow-hidden flex-shrink-0">
                    {isImageUrl(cat.icon) ? (
                      <img src={cat.icon} alt={cat.label} className="w-full h-full object-cover" />
                    ) : (
                      <span className="text-3xl">{cat.icon || '❓'}</span>
                    )}
                  </div>
                  <div className="flex-1 space-y-2">
                    <input
                      placeholder="Nome da categoria"
                      value={cat.label}
                      onChange={e => updateCategory(idx, 'label', e.target.value)}
                      className="w-full px-3 py-2 bg-muted rounded-lg outline-none focus:ring-2 focus:ring-primary text-sm"
                      maxLength={30}
                    />
                    <div className="flex gap-2">
                      <label className={`flex-1 touch-btn flex items-center justify-center gap-2 py-2 rounded-lg cursor-pointer border-2 border-dashed border-border hover:border-primary transition-colors text-xs ${uploadingCategoryIcon === cat.key ? 'opacity-50 pointer-events-none' : ''}`}>
                        {uploadingCategoryIcon === cat.key ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                        <span>{uploadingCategoryIcon === cat.key ? 'Enviando...' : 'Subir Foto'}</span>
                        <input type="file" accept="image/*" onChange={e => handleCategoryIconUpload(e, cat.key)} className="hidden" disabled={uploadingCategoryIcon === cat.key} />
                      </label>
                      <input
                        placeholder="Emoji"
                        value={isImageUrl(cat.icon) ? '' : cat.icon}
                        onChange={e => updateCategory(idx, 'icon', e.target.value)}
                        className="w-16 px-2 py-2 bg-muted rounded-lg outline-none focus:ring-2 focus:ring-primary text-center text-xl"
                        maxLength={4}
                      />
                    </div>
                  </div>
                </div>
              </div>
            ))}
            <button onClick={addCategory} className="touch-btn w-full bg-muted text-muted-foreground py-3 rounded-xl flex items-center justify-center gap-2 border-2 border-dashed border-border">
              <Plus className="w-5 h-5" /> Adicionar Categoria
            </button>
          </div>

          <div className="kiosk-card p-4 space-y-4">
            <h3 className="font-bold flex items-center gap-2"><Image className="w-5 h-5 text-primary" /> Imagem de Capa do Totem</h3>
            <p className="text-xs text-muted-foreground">Suba uma foto do celular ou cole uma URL. A capa muda automaticamente após o envio.</p>
            <div className="flex gap-2">
              <label className={`flex-1 touch-btn flex items-center justify-center gap-2 py-3 rounded-lg cursor-pointer border-2 border-dashed border-border hover:border-primary transition-colors ${uploadingCover ? 'opacity-50 pointer-events-none' : ''}`}>
                {uploadingCover ? <Loader2 className="w-5 h-5 animate-spin" /> : <Upload className="w-5 h-5" />}
                <span className="text-sm">{uploadingCover ? 'Enviando...' : 'Subir Foto do Celular'}</span>
                <input type="file" accept="image/*" onChange={handleCoverImageUpload} className="hidden" disabled={uploadingCover} />
              </label>
            </div>
            <input placeholder="Ou cole o link da imagem" value={settings.coverImage || ''} onChange={e => setSettings({ ...settings, coverImage: e.target.value })} className="w-full px-3 py-3 bg-muted rounded-lg outline-none focus:ring-2 focus:ring-primary" />
            {settings.coverImage && (
              <div className="mt-2">
                <span className="text-xs text-muted-foreground">Preview:</span>
                <img
                  src={settings.coverImage}
                  alt="Capa preview"
                  className="w-full h-32 object-cover rounded-lg mt-1 filter-none opacity-100"
                  style={{ colorScheme: 'light', forcedColorAdjust: 'none', filter: 'none', mixBlendMode: 'normal', backgroundColor: 'transparent' } as React.CSSProperties}
                />
              </div>
            )}
          </div>

          <div className="kiosk-card p-4 space-y-4">
            <h3 className="font-bold flex items-center gap-2"><Zap className="w-5 h-5 text-accent" /> Configuração do Combo</h3>
            <div><label className="text-xs text-muted-foreground mb-1 block">Nome do Combo</label><input placeholder="Ex: Batata + Refri" value={settings.combo?.name || ''} onChange={e => setSettings({ ...settings, combo: { ...settings.combo, name: e.target.value } })} className="w-full px-3 py-3 bg-muted rounded-lg outline-none focus:ring-2 focus:ring-primary" maxLength={50} /></div>
            <div><label className="text-xs text-muted-foreground mb-1 block">Descrição</label><input placeholder="Ex: Batata + Refri" value={settings.combo?.description || ''} onChange={e => setSettings({ ...settings, combo: { ...settings.combo, description: e.target.value } })} className="w-full px-3 py-3 bg-muted rounded-lg outline-none focus:ring-2 focus:ring-primary" maxLength={100} /></div>
            <div><label className="text-xs text-muted-foreground mb-1 block">Preço (R$)</label><input type="number" step="0.01" placeholder="Ex: 15.00" value={settings.combo?.price || ''} onChange={e => setSettings({ ...settings, combo: { ...settings.combo, price: parseFloat(e.target.value) || 0 } })} className="w-full px-3 py-3 bg-muted rounded-lg outline-none focus:ring-2 focus:ring-primary" /></div>
            <div><label className="text-xs text-muted-foreground mb-1 block">Emoji do Combo</label><input placeholder="Ex: 🍟🥤" value={settings.combo?.emoji || ''} onChange={e => setSettings({ ...settings, combo: { ...settings.combo, emoji: e.target.value } })} className="w-full px-3 py-3 bg-muted rounded-lg outline-none focus:ring-2 focus:ring-primary" maxLength={10} /></div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block flex items-center gap-1"><Image className="w-3 h-3" /> Foto do Combo (opcional)</label>
              <p className="text-[11px] text-muted-foreground mb-2">Suba uma foto do celular. Quando definida, substituirá o emoji no popup.</p>
              <div className="flex gap-2 items-center">
                {settings.combo?.image && (
                  <img src={settings.combo.image} alt="Combo" className="w-16 h-16 object-cover rounded-lg flex-shrink-0" />
                )}
                <label className={`flex-1 touch-btn flex items-center justify-center gap-2 py-3 rounded-lg cursor-pointer border-2 border-dashed border-border hover:border-primary transition-colors ${uploadingComboImage ? 'opacity-50 pointer-events-none' : ''}`}>
                  {uploadingComboImage ? <Loader2 className="w-5 h-5 animate-spin" /> : <Upload className="w-5 h-5" />}
                  <span className="text-sm">{uploadingComboImage ? 'Enviando...' : 'Subir Foto do Celular'}</span>
                  <input type="file" accept="image/*" onChange={handleComboImageUpload} className="hidden" disabled={uploadingComboImage} />
                </label>
                {settings.combo?.image && (
                  <button onClick={async () => { const updated = { ...settings, combo: { ...settings.combo, image: '' } }; setSettings(updated); await saveSettingsToDb(updated); }} className="p-2 text-muted-foreground hover:text-destructive">
                    <Trash2 className="w-5 h-5" />
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="kiosk-card p-4 space-y-4">
            <div>
              <h3 className="font-bold">🌐 Redes sociais e contato</h3>
              <p className="text-xs text-muted-foreground mt-1">Os canais preenchidos aparecem na tela inicial da loja. Campos vazios ficam ocultos para o cliente.</p>
            </div>

            <div>
              <label className="text-xs text-muted-foreground mb-1 block">WhatsApp da loja</label>
              <input
                placeholder="Número com código do país (ex: 5562994995768)"
                value={settings.whatsappNumber}
                onChange={e => setSettings({ ...settings, whatsappNumber: e.target.value })}
                className="w-full px-3 py-3 bg-muted rounded-lg outline-none focus:ring-2 focus:ring-primary"
                maxLength={20}
              />
              <p className="text-[11px] text-muted-foreground mt-1">Também permanece sendo o número utilizado pela operação da cozinha onde esse campo já é usado.</p>
            </div>

            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Instagram</label>
              <input
                placeholder="https://instagram.com/seuperfil"
                value={settings.instagramUrl || ''}
                onChange={e => setSettings({ ...settings, instagramUrl: e.target.value })}
                className="w-full px-3 py-3 bg-muted rounded-lg outline-none focus:ring-2 focus:ring-primary"
                maxLength={200}
              />
              <p className="text-[11px] text-muted-foreground mt-1">Cole o link completo do perfil para exibir o atalho na home.</p>
            </div>
          </div>

          {/* Imagem de compartilhamento / Favicon */}
          <div className="kiosk-card p-4 space-y-4">
            <h3 className="font-bold flex items-center gap-2"><Share2 className="w-5 h-5 text-primary" /> Imagem de Compartilhamento / Favicon</h3>
            <p className="text-xs text-muted-foreground">Esta imagem aparece quando o link da sua loja é compartilhado no WhatsApp, Facebook, etc. Também é usada como ícone (favicon) na aba do navegador.</p>
            <div className="flex gap-2 items-center">
              {settings.shareImage && (
                <img src={settings.shareImage} alt="Share preview" className="w-16 h-16 object-cover rounded-lg flex-shrink-0 border border-border" />
              )}
              <label className={`flex-1 touch-btn flex items-center justify-center gap-2 py-3 rounded-lg cursor-pointer border-2 border-dashed border-border hover:border-primary transition-colors ${uploadingShare ? 'opacity-50 pointer-events-none' : ''}`}>
                {uploadingShare ? <Loader2 className="w-5 h-5 animate-spin" /> : <Upload className="w-5 h-5" />}
                <span className="text-sm">{uploadingShare ? 'Enviando...' : 'Subir Imagem'}</span>
                <input type="file" accept="image/*" onChange={handleShareImageUpload} className="hidden" disabled={uploadingShare} />
              </label>
              {settings.shareImage && (
                <button onClick={async () => { const updated = { ...settings, shareImage: '' }; setSettings(updated); await saveSettingsToDb(updated); }} className="p-2 text-muted-foreground hover:text-destructive">
                  <Trash2 className="w-5 h-5" />
                </button>
              )}
            </div>
            <input placeholder="Ou cole o link da imagem" value={settings.shareImage || ''} onChange={e => setSettings({ ...settings, shareImage: e.target.value })} className="w-full px-3 py-3 bg-muted rounded-lg outline-none focus:ring-2 focus:ring-primary text-sm" />
          </div>

          {/* Chave Pix manual exibida no totem */}
          <div className="kiosk-card p-4 space-y-3">
            <h3 className="font-bold flex items-center gap-2"><KeyRound className="w-5 h-5 text-accent" /> Chave Pix (exibida no pagamento)</h3>
            <p className="text-xs text-muted-foreground">Esta chave aparece em texto abaixo do QR Code para o cliente copiar.</p>
            <input
              placeholder="Ex: pagamento@minhaloja.com ou CPF/CNPJ"
              value={settings.pixKeyManual || ''}
              onChange={e => setSettings({ ...settings, pixKeyManual: e.target.value })}
              className="w-full px-3 py-3 bg-muted rounded-lg outline-none focus:ring-2 focus:ring-primary text-sm font-mono"
              maxLength={200}
            />
          </div>

          {/* Mercado Pago — credenciais por loja, criptografadas no Vault */}
          {activeOrgId && <MercadoPagoCard organizationId={activeOrgId} />}

          {/* Métodos de pagamento aceitos */}
          <div className="kiosk-card p-4 space-y-3">
            <h3 className="font-bold flex items-center gap-2"><CreditCard className="w-5 h-5 text-primary" /> Métodos de Pagamento Aceitos</h3>
            <p className="text-xs text-muted-foreground">Ative apenas as formas de pagamento que sua loja aceita. O cliente verá só essas opções no checkout.</p>

            {[
              { key: 'payCashEnabled' as const, label: '💵 Pagamento no Balcão (Dinheiro)', desc: 'Cliente paga em dinheiro ao retirar.' },
              { key: 'payPixEnabled' as const, label: '📲 Pix (QR Code)', desc: 'Gera QR Code para o cliente escanear.' },
              { key: 'payCardTerminalEnabled' as const, label: '💳 Cartão na Maquininha (Totem)', desc: 'Cliente passa o cartão na maquininha ao lado do totem.' },
              { key: 'payCardOnlineEnabled' as const, label: '🌐 Cartão Online (Web App)', desc: 'Cobrança via gateway no próprio celular do cliente.' },
            ].map(opt => (
              <label key={opt.key} className="flex items-start gap-3 p-3 rounded-lg bg-muted/40 cursor-pointer">
                <input
                  type="checkbox"
                  checked={Boolean(settings[opt.key])}
                  onChange={e => setSettings({ ...settings, [opt.key]: e.target.checked })}
                  className="mt-1 w-5 h-5 accent-primary"
                />
                <div className="flex-1">
                  <p className="text-sm font-semibold">{opt.label}</p>
                  <p className="text-[11px] text-muted-foreground">{opt.desc}</p>
                </div>
              </label>
            ))}
          </div>

          {/* ID da Maquininha */}
          <div className="kiosk-card p-4 space-y-3">
            <h3 className="font-bold flex items-center gap-2"><KeyRound className="w-5 h-5 text-accent" /> ID da Maquininha (Point / Terminal)</h3>
            <p className="text-xs text-muted-foreground">Informe o ID da maquininha física (ex: Mercado Pago Point) para envio automático do valor ao terminal. Deixe em branco se ainda não usa essa integração.</p>
            <input
              placeholder="Ex: PAX_A910__SMARTPOS1234567890"
              value={settings.mpTerminalId || ''}
              onChange={e => setSettings({ ...settings, mpTerminalId: e.target.value })}
              className="w-full px-3 py-3 bg-muted rounded-lg outline-none focus:ring-2 focus:ring-primary text-sm font-mono"
              maxLength={120}
            />
          </div>




          <button onClick={saveSettingsHandler} className="touch-btn w-full bg-primary text-primary-foreground py-3 rounded-xl flex items-center justify-center gap-2">
            <Save className="w-4 h-4" /> Salvar Configurações
          </button>
        </div>
      )}

      {tab === 'pdv_operadores' && (
        <OperadoresPdvPanel
          organizationId={activeOrgId}
          orgSlug={allOrgs.find(o => o.id === activeOrgId)?.slug || org?.slug || null}
        />
      )}

      {tab === 'fiscal' && (
        <div className="px-4 space-y-4">
          <FiscalExportCard organizationId={activeOrgId} />

          <div className="kiosk-card p-4 space-y-3 border border-orange-600/30">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full flex items-center justify-center bg-orange-600/15 text-orange-400">
                <FileText className="w-5 h-5" />
              </div>
              <div className="flex-1">
                <p className="font-semibold text-sm">Fiscal e Contabilidade</p>
                <p className="text-[11px] text-muted-foreground mt-1">
                  Atualmente o VisionFood gera comprovante interno e exportação CSV para a contabilidade.
                  Emissão automática de NFC-e/SEFAZ ainda não está habilitada.
                </p>
              </div>
            </div>
          </div>

          <div className="kiosk-card p-4 space-y-3">
            <h3 className="font-bold flex items-center gap-2">
              <Building2 className="w-5 h-5 text-primary" /> Dados Cadastrais da Empresa
            </h3>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">CNPJ</label>
              <input
                placeholder="00.000.000/0000-00"
                value={settings.fiscalCnpj || ''}
                onChange={e => setSettings({ ...settings, fiscalCnpj: e.target.value })}
                className="w-full px-3 py-3 bg-muted rounded-lg outline-none focus:ring-2 focus:ring-primary"
                maxLength={20}
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Razão Social</label>
              <input
                placeholder="Razão Social da empresa"
                value={settings.fiscalRazao || ''}
                onChange={e => setSettings({ ...settings, fiscalRazao: e.target.value })}
                className="w-full px-3 py-3 bg-muted rounded-lg outline-none focus:ring-2 focus:ring-primary"
                maxLength={120}
              />
            </div>
            <p className="text-[11px] text-muted-foreground">
              Esses dados são usados no comprovante interno. Eles não representam autorização de emissão fiscal.
            </p>
          </div>

          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-xs text-amber-200">
            A integração SEFAZ/NFC-e será tratada como um módulo separado. Enquanto ela não existir no backend,
            o sistema não solicita nem armazena CSC ou token da SEFAZ.
          </div>

          <button
            onClick={saveFiscalCompany}
            className="touch-btn w-full bg-primary text-primary-foreground py-3 rounded-xl flex items-center justify-center gap-2"
          >
            <Save className="w-4 h-4" /> Salvar Dados Cadastrais
          </button>
        </div>
      )}

      </>
      )}

      </Suspense>
      </RuntimeErrorBoundary>

      <footer className="mt-8 pb-28 md:pb-4 text-center text-[11px] text-muted-foreground">Desenvolvido by VisionTek</footer>

      {/* Bottom mobile nav */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-50 bg-[#0B0B0D]/95 backdrop-blur-xl border-t border-white/[0.06] px-4 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        <div className="flex items-end justify-around max-w-md mx-auto">
          {[
            { k: 'dashboard', l: 'Início', i: Zap },
            { k: 'orders', l: 'Pedidos', i: ClipboardList },
            { k: '__plus', l: '', i: Plus },
            { k: 'products', l: 'Produtos', i: Boxes },
            { k: 'leads', l: 'Clientes', i: Users },
          ].map((n) => {
            const Icon = n.i;
            const active = tab === n.k;
            if (n.k === '__plus') {
              return (
                <button
                  key="plus"
                  onClick={() => navigate('/pdv')}
                  aria-label="Novo pedido (PDV)"
                  className="-mt-5 w-14 h-14 rounded-full bg-gradient-to-tr from-[#FF7A00] to-[#FF9D42] text-white flex items-center justify-center shadow-[0_10px_30px_-6px_rgba(255,122,0,0.6)] active:scale-95 transition-transform"
                >
                  <Plus className="w-6 h-6" strokeWidth={2.6} />
                </button>
              );
            }
            return (
              <button
                key={n.k}
                onClick={() => setTab(n.k as any)}
                className="flex flex-col items-center gap-1 px-2 py-1.5 min-w-[56px] transition-colors"
              >
                <Icon className={`w-5 h-5 ${active ? 'text-[#FF7A00]' : 'text-zinc-500'}`} strokeWidth={2} />
                <span className={`text-[10px] font-bold ${active ? 'text-[#FF7A00]' : 'text-zinc-500'}`}>{n.l}</span>
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
};

const MasterUnlockGate = ({ masterPassword, setMasterPassword, masterError, unlockMaster }: { masterPassword: string; setMasterPassword: (v: string) => void; masterError: string; unlockMaster: () => void; }) => (
  <div className="px-4">
    <div className="kiosk-card p-6 max-w-sm mx-auto space-y-4 text-center">
      <div className="w-14 h-14 rounded-full bg-primary/20 flex items-center justify-center mx-auto">
        <Shield className="w-7 h-7 text-primary" />
      </div>
      <h2 className="font-bold text-lg">Acesso Master</h2>
      <p className="text-xs text-muted-foreground">Confirme sua senha Master para acessar esta área restrita.</p>
      <input type="password" autoComplete="new-password" placeholder="Senha Master"
        value={masterPassword} onChange={e => setMasterPassword(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && unlockMaster()}
        className="w-full px-4 py-3 bg-muted rounded-xl outline-none focus:ring-2 focus:ring-primary text-center" maxLength={50} />
      {masterError && <p className="text-secondary text-sm">{masterError}</p>}
      <button onClick={unlockMaster} className="touch-btn w-full bg-primary text-primary-foreground py-3 rounded-xl">Desbloquear</button>
    </div>
  </div>
);

export default AdminPage;

