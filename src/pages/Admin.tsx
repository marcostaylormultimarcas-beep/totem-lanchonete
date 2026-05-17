import { getKioskHomePath } from '@/lib/kioskHome';
import { useState, useEffect } from 'react';
import { ArrowLeft, Plus, Pencil, Trash2, Save, Settings, Lock, Image, Store, Zap, Megaphone, Upload, Loader2, ClipboardList, Shield, Pause, Play, LogOut, Building2 } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { Product, BannerItem, StoreSettings, CategoryItem, formatCurrency } from '@/data/store';
import { uploadProductImage } from '@/lib/imageUpload';
import { supabase } from '@/integrations/supabase/client';
import { useOrg } from '@/contexts/OrgContext';
import { signOutCompletely } from '@/lib/auth';
import OrdersPanel from '@/components/admin/OrdersPanel';
import DashboardPanel from '@/components/admin/DashboardPanel';
import MasterPanel from '@/components/admin/MasterPanel';
import OrgSwitcher from '@/components/admin/OrgSwitcher';
import ChangePasswordCard from '@/components/admin/ChangePasswordCard';

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
  is_master: boolean;
  organization_id: string | null;
}

const AdminPage = () => {
  const navigate = useNavigate();
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
  });
  const [settingsId, setSettingsId] = useState<string | null>(null);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [tab, setTab] = useState<'orders' | 'dashboard' | 'products' | 'banners' | 'settings' | 'admins'>('orders');
  const [masterUnlocked, setMasterUnlocked] = useState(false);
  const [masterPassword, setMasterPassword] = useState('');
  const [masterError, setMasterError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadingBannerIdx, setUploadingBannerIdx] = useState<number | null>(null);

  // Load products from Supabase (scoped by activeOrgId)
  useEffect(() => {
    if (!activeOrgId) { setProducts([]); return; }
    const fetch = async () => {
      const { data } = await supabase.from('products').select('*').eq('organization_id', activeOrgId);
      if (data) {
        setProducts(data.map((p: any) => ({
          id: p.id, name: p.name, price: Number(p.price), category: p.category as Product['category'],
          image: p.image, removableIngredients: (p.removable_ingredients as string[]) || [],
          extras: (p.extras as { name: string; price: number }[]) || [], isCombo: p.is_combo || false,
          ingredients: (p.ingredients as string[]) || [], description: p.description || '',
        })));
      }
    };
    fetch();
  }, [activeOrgId]);

  // Load settings from Supabase (scoped by activeOrgId)
  useEffect(() => {
    if (!activeOrgId) return;
    const fetch = async () => {
      const { data } = await supabase.from('settings').select('*').eq('organization_id', activeOrgId).maybeSingle();
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
        });
      } else {
        setSettingsId(null);
      }
    };
    fetch();
  }, [activeOrgId]);

  // Save settings to Supabase (scoped by activeOrgId)
  const saveSettingsToDb = async (s: StoreSettings) => {
    if (!activeOrgId) return;
    const payload: any = {
      organization_id: activeOrgId,
      store_name: s.storeName,
      whatsapp_number: s.whatsappNumber,
      cover_image: s.coverImage,
      combo: s.combo as any,
      banners: s.banners as any,
      category_icons: s.categoryIcons as any,
      categories: s.categories as any,
      instagram_url: s.instagramUrl || '',
    };
    if (settingsId) {
      await supabase.from('settings').update(payload).eq('id', settingsId);
    } else {
      const { data } = await supabase.from('settings').insert(payload).select().maybeSingle();
      if (data) setSettingsId(data.id);
    }
  };


  const handleBannerImageUpload = async (e: React.ChangeEvent<HTMLInputElement>, idx: number) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingBannerIdx(idx);
    try {
      const url = await uploadProductImage(file);
      const banners = [...settings.banners];
      banners[idx] = { ...banners[idx], image: url };
      const updated = { ...settings, banners };
      setSettings(updated);
      await saveSettingsToDb(updated);
    } catch (err) {
      alert('Erro ao enviar imagem do banner. Tente novamente.');
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
    try {
      const url = await uploadProductImage(file);
      const cats = (settings.categories || DEFAULT_CATEGORIES).map(c => c.key === key ? { ...c, icon: url } : c);
      const updated = { ...settings, categories: cats, categoryIcons: { ...settings.categoryIcons, [key]: url } };
      setSettings(updated);
      await saveSettingsToDb(updated);
    } catch (err) {
      alert('Erro ao enviar ícone. Tente novamente.');
      console.error(err);
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
      const url = await uploadProductImage(file);
      const updated = { ...settings, combo: { ...settings.combo, image: url } };
      setSettings(updated);
      await saveSettingsToDb(updated);
    } catch (err) {
      alert('Erro ao enviar imagem do combo. Tente novamente.');
    } finally {
      setUploadingComboImage(false);
    }
  };

  const updateCategory = async (idx: number, field: 'label' | 'icon' | 'key', value: string) => {
    const cats = [...(settings.categories || DEFAULT_CATEGORIES)];
    cats[idx] = { ...cats[idx], [field]: value };
    const updated = { ...settings, categories: cats };
    setSettings(updated);
    await saveSettingsToDb(updated);
  };

  const addCategory = async () => {
    const key = 'cat_' + Math.random().toString(36).slice(2, 8);
    const cats = [...(settings.categories || DEFAULT_CATEGORIES), { key, label: 'Nova Categoria', icon: '🍽️' }];
    const updated = { ...settings, categories: cats };
    setSettings(updated);
    await saveSettingsToDb(updated);
  };

  const removeCategory = async (key: string) => {
    if (!confirm('Remover esta categoria? Os produtos vinculados a ela ficarão sem categoria visível.')) return;
    const cats = (settings.categories || DEFAULT_CATEGORIES).filter(c => c.key !== key);
    const updated = { ...settings, categories: cats };
    setSettings(updated);
    await saveSettingsToDb(updated);
  };

  const [uploadingCover, setUploadingCover] = useState(false);

  const handleCoverImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingCover(true);
    try {
      const url = await uploadProductImage(file);
      const updated = { ...settings, coverImage: url };
      setSettings(updated);
      await saveSettingsToDb(updated);
    } catch (err) {
      alert('Erro ao enviar imagem de capa. Tente novamente.');
      console.error(err);
    } finally {
      setUploadingCover(false);
    }
  };

  const [form, setForm] = useState({
    name: '', price: '', category: 'hamburgueres' as string,
    image: '🍔', removableIngredients: '', extras: '',
    ingredients: '', description: '',
  });

  // Carrega sessão atual e contexto do admin
  const bootstrapSession = async () => {
    setAuthLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setAuthenticated(false);
      setCurrentAdmin(null);
      setActiveOrgId(null);
      setAllOrgs([]);
      setAuthLoading(false);
      return;
    }
    // Verifica role master
    const { data: masterRow } = await supabase
      .from('user_roles' as any)
      .select('role')
      .eq('user_id', user.id)
      .eq('role', 'master')
      .maybeSingle();
    const isMaster = !!masterRow;
    // Verifica role admin
    const { data: adminRow } = await supabase
      .from('user_roles' as any)
      .select('role')
      .eq('user_id', user.id)
      .eq('role', 'admin')
      .maybeSingle();
    const isAdmin = !!adminRow;
    // Org do usuário
    const { data: ownOrg } = await supabase
      .from('organizations')
      .select('*')
      .eq('owner_id', user.id)
      .maybeSingle();

    // Bloqueia acesso de contas que não são ADM nem Master (ex.: clientes via Google)
    if (!isMaster && !isAdmin) {
      await supabase.auth.signOut();
      setAuthenticated(false);
      setCurrentAdmin(null);
      setActiveOrgId(null);
      setAuthLoading(false);
      setError('Esta conta não tem permissão de administrador. Peça ao Master para criar seu acesso.');
      return;
    }

    const adminCtx: AdminUser = {
      id: user.id,
      username: user.email || '',
      is_master: isMaster,
      organization_id: ownOrg?.id ?? null,
    };
    setCurrentAdmin(adminCtx);
    const initialOrg = ownOrg?.id ?? null;
    setActiveOrgId(initialOrg);
    if (initialOrg) await setOrgId(initialOrg);
    if (isMaster) {
      const { data: orgs } = await supabase.from('organizations').select('id, name, slug').order('name');
      setAllOrgs((orgs as any) || []);
    }
    setAuthenticated(true);
    setAuthLoading(false);
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
    if (!currentAdmin.is_master) { setMasterError('Acesso restrito ao Master.'); return; }
    // Re-valida com a senha atual do usuário
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
    setForm({ name: '', price: '', category: 'hamburgueres', image: '🍔', removableIngredients: '', extras: '', ingredients: '', description: '' });
    setEditingProduct(null);
    setShowForm(false);
  };

  const editProduct = (p: Product) => {
    setForm({
      name: p.name, price: p.price.toString(), category: p.category,
      image: p.image, removableIngredients: p.removableIngredients.join(', '),
      extras: p.extras.map(e => `${e.name}:${e.price}`).join(', '),
      ingredients: (p.ingredients || []).join('\n'),
      description: p.description || '',
    });
    setEditingProduct(p);
    setShowForm(true);
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const url = await uploadProductImage(file);
      setForm(prev => ({ ...prev, image: url }));
    } catch (err) {
      alert('Erro ao enviar imagem. Tente novamente.');
      console.error(err);
    } finally {
      setUploading(false);
    }
  };

  const saveProduct = async () => {
    if (!form.name.trim() || !form.price) return;
    if (!activeOrgId) { alert('Selecione uma loja primeiro.'); return; }
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
      category: form.category,
      image: form.image.trim() || '🍔',
      removable_ingredients: removable,
      extras: parsedExtras,
      ingredients: ingredientsList,
      description: form.description.trim(),
    };

    if (editingProduct) {
      await supabase.from('products').update(dbPayload).eq('id', editingProduct.id);
      setProducts(prev => prev.map(p => p.id === editingProduct.id ? {
        ...p, ...dbPayload, removableIngredients: removable, ingredients: ingredientsList, description: dbPayload.description,
      } as Product : p));
    } else {
      const { data } = await supabase.from('products').insert(dbPayload).select().maybeSingle();
      if (data) {
        setProducts(prev => [...prev, {
          id: data.id, name: data.name, price: Number(data.price),
          category: data.category as Product['category'], image: data.image,
          removableIngredients: (data.removable_ingredients as string[]) || [],
          extras: (data.extras as { name: string; price: number }[]) || [],
          isCombo: data.is_combo || false,
          ingredients: ((data as any).ingredients as string[]) || [],
          description: (data as any).description || '',
        }]);
      }
    }
    resetForm();
  };

  const deleteProduct = async (id: string) => {
    if (!confirm('Tem certeza que deseja excluir este produto?')) return;
    await supabase.from('products').delete().eq('id', id);
    setProducts(prev => prev.filter(p => p.id !== id));
  };

  const saveSettingsHandler = async () => {
    await saveSettingsToDb(settings);
    alert('Configurações salvas com sucesso!');
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
    <div className="min-h-screen pb-8">
      <div className="flex items-center justify-between p-4 border-b border-border">
        <div className="flex items-center gap-3 min-w-0">
          <Link to={getKioskHomePath()} className="text-muted-foreground hover:text-foreground"><ArrowLeft className="w-6 h-6" /></Link>
          <h1 className="text-xl font-bold">Painel Admin</h1>
          {currentAdmin && (
            <span className="text-xs px-2 py-1 rounded-full bg-muted text-muted-foreground">
              {currentAdmin.is_master ? '👑 ' : ''}{currentAdmin.username}
            </span>
          )}
        </div>
        <button onClick={handleLogout} className="text-muted-foreground hover:text-destructive flex items-center gap-1 text-sm">
          <LogOut className="w-4 h-4" /> Sair
        </button>
      </div>

      {/* Active org indicator + switcher (Master only) */}
      <div className="flex items-center gap-2 px-4 pt-3">
        {currentAdmin?.is_master ? (
          <OrgSwitcher orgs={allOrgs as any} activeOrgId={activeOrgId} onChange={switchOrg} />
        ) : (
          <>
            <Building2 className="w-4 h-4 text-primary flex-shrink-0" />
            <span className="text-sm text-muted-foreground">Loja: <span className="text-foreground font-semibold">{org?.name || '—'}</span></span>
          </>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-2 p-4 overflow-x-auto">
        {[
          { key: 'orders' as const, label: 'Pedidos', icon: ClipboardList, master: false },
          { key: 'dashboard' as const, label: 'Dashboard', icon: Zap, master: false },
          { key: 'products' as const, label: 'Produtos', icon: null, master: false },
          { key: 'banners' as const, label: 'Banners', icon: Megaphone, master: false },
          { key: 'settings' as const, label: 'Config', icon: Settings, master: false },
          { key: 'admins' as const, label: 'Master', icon: Shield, master: true },
        ].filter(t => !t.master || currentAdmin?.is_master).map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`touch-btn px-5 py-3 rounded-xl text-sm whitespace-nowrap flex items-center gap-1 ${tab === t.key ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>
            {t.icon && <t.icon className="w-4 h-4" />} {t.label}
          </button>
        ))}
      </div>

      {tab === 'orders' && <OrdersPanel organizationId={activeOrgId} />}
      {tab === 'dashboard' && <DashboardPanel organizationId={activeOrgId} />}
      {tab === 'admins' && currentAdmin?.is_master && (
        masterUnlocked ? (
          <MasterPanel currentAdminId={currentAdmin.id} />
        ) : (
          <MasterUnlockGate masterPassword={masterPassword} setMasterPassword={setMasterPassword} masterError={masterError} unlockMaster={unlockMaster} />
        )
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
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Preço (R$)</label>
                <input placeholder="Ex: 25.90" type="number" step="0.01" value={form.price} onChange={e => setForm({ ...form, price: e.target.value })} className="w-full px-3 py-3 bg-muted rounded-lg outline-none focus:ring-2 focus:ring-primary" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Categoria</label>
                <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} className="w-full px-3 py-3 bg-muted rounded-lg outline-none focus:ring-2 focus:ring-primary">
                  {(settings.categories || DEFAULT_CATEGORIES).map(c => <option key={c.key} value={c.key}>{c.icon} {c.label}</option>)}
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
                  <input placeholder="Ou emoji: 🍔" value={isImageUrl(form.image) ? '' : form.image} onChange={e => setForm({ ...form, image: e.target.value })} className="w-24 px-3 py-3 bg-muted rounded-lg outline-none focus:ring-2 focus:ring-primary text-center text-2xl" maxLength={4} />
                </div>
                {form.image && (
                  <div className="mt-2 flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">Preview:</span>
                    {isImageUrl(form.image) ? (
                      <img src={form.image} alt="Preview" className="w-16 h-16 object-cover rounded-lg" />
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
                <h3 className="font-bold text-sm text-muted-foreground mb-2">{cat.icon} {cat.label}</h3>
                <div className="space-y-2">
                  {catProducts.map(p => (
                    <div key={p.id} className="kiosk-card p-3 flex items-center gap-3">
                      {isImageUrl(p.image) ? (
                        <img src={p.image} alt={p.name} className="w-12 h-12 object-cover rounded-lg flex-shrink-0" />
                      ) : (
                        <span className="text-2xl flex-shrink-0">{p.image}</span>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="font-bold text-sm truncate">{p.name}</p>
                        <p className="text-primary font-bold text-sm">{formatCurrency(p.price)}</p>
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
                      <img src={banner.image} alt="Preview" className="w-16 h-16 object-cover rounded-lg" />
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
                <img src={settings.coverImage} alt="Capa preview" className="w-full h-32 object-cover rounded-lg mt-1" />
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
            <h3 className="font-bold">📱 WhatsApp da Cozinha</h3>
            <input placeholder="Número com código do país (ex: 5562994995768)" value={settings.whatsappNumber} onChange={e => setSettings({ ...settings, whatsappNumber: e.target.value })} className="w-full px-3 py-3 bg-muted rounded-lg outline-none focus:ring-2 focus:ring-primary" maxLength={20} />
            <p className="text-xs text-muted-foreground">Este número também é usado no ícone do WhatsApp do rodapé do totem.</p>
          </div>

          <div className="kiosk-card p-4 space-y-4">
            <h3 className="font-bold">📷 Link do Instagram (rodapé)</h3>
            <input placeholder="https://instagram.com/seuperfil" value={settings.instagramUrl || ''} onChange={e => setSettings({ ...settings, instagramUrl: e.target.value })} className="w-full px-3 py-3 bg-muted rounded-lg outline-none focus:ring-2 focus:ring-primary" maxLength={200} />
            <p className="text-xs text-muted-foreground">Cole o link completo do perfil. Aparecerá no rodapé da tela inicial.</p>
          </div>

          <button onClick={saveSettingsHandler} className="touch-btn w-full bg-primary text-primary-foreground py-3 rounded-xl flex items-center justify-center gap-2">
            <Save className="w-4 h-4" /> Salvar Configurações
          </button>
        </div>
      )}
      <footer className="mt-8 pb-4 text-center text-[11px] text-muted-foreground">Desenvolvido by VisionTek</footer>
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

