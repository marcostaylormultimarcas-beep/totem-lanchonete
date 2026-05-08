import { useState, useEffect } from 'react';
import { ArrowLeft, Plus, Pencil, Trash2, Save, Settings, Lock, Image, Store, Zap, Megaphone, Upload, Loader2, ClipboardList } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Product, BannerItem, StoreSettings, CategoryItem, formatCurrency } from '@/data/store';
import { uploadProductImage } from '@/lib/imageUpload';
import { supabase } from '@/integrations/supabase/client';
import OrdersPanel from '@/components/admin/OrdersPanel';

const DEFAULT_CATEGORIES: CategoryItem[] = [
  { key: 'hamburgueres', label: 'Hambúrgueres', icon: '🍔' },
  { key: 'pizzas', label: 'Pizzas', icon: '🍕' },
  { key: 'bebidas', label: 'Bebidas', icon: '🥤' },
];
const BADGE_COLORS: BannerItem['badgeColor'][] = ['primary', 'secondary', 'accent'];
const BADGE_COLOR_LABELS = { primary: '🟠 Laranja', secondary: '🔴 Vermelho', accent: '🟡 Amarelo' };

const AdminPage = () => {
  const [authenticated, setAuthenticated] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [products, setProducts] = useState<Product[]>([]);
  const [settings, setSettings] = useState<StoreSettings>({
    whatsappNumber: '', storeName: 'Vision Mídia', coverImage: '',
    combo: { name: 'Batata + Refri', description: 'Batata + Refri', price: 15, emoji: '🍟🥤', image: '' },
    banners: [],
    categoryIcons: { hamburgueres: '🍔', pizzas: '🍕', bebidas: '🥤' },
    categories: DEFAULT_CATEGORIES,
  });
  const [settingsId, setSettingsId] = useState<string | null>(null);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [tab, setTab] = useState<'products' | 'settings' | 'banners' | 'orders'>('orders');
  const [uploading, setUploading] = useState(false);
  const [uploadingBannerIdx, setUploadingBannerIdx] = useState<number | null>(null);

  // Load products from Supabase
  useEffect(() => {
    const fetch = async () => {
      const { data } = await supabase.from('products').select('*');
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
  }, []);

  // Load settings from Supabase
  useEffect(() => {
    const fetch = async () => {
      const { data } = await supabase.from('settings').select('*').limit(1).maybeSingle();
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
        });
      }
    };
    fetch();
  }, []);

  // Save settings to Supabase
  const saveSettingsToDb = async (s: StoreSettings) => {
    const payload: any = {
      store_name: s.storeName,
      whatsapp_number: s.whatsappNumber,
      cover_image: s.coverImage,
      combo: s.combo as any,
      banners: s.banners as any,
      category_icons: s.categoryIcons as any,
      categories: s.categories as any,
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

  const handleLogin = () => {
    if (password === '1234') {
      setAuthenticated(true);
      setError('');
    } else {
      setError('Senha incorreta');
    }
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
    const parsedExtras = form.extras.split(',').map(s => s.trim()).filter(Boolean).map(s => {
      const [name, price] = s.split(':');
      return { name: name?.trim() || '', price: parseFloat(price) || 0 };
    });
    const removable = form.removableIngredients.split(',').map(s => s.trim()).filter(Boolean);

    const ingredientsList = form.ingredients.split(/\r?\n|,/).map(s => s.trim()).filter(Boolean);

    const dbPayload: any = {
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

  if (!authenticated) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-6 px-6">
        <div className="w-16 h-16 rounded-full bg-primary/20 flex items-center justify-center">
          <Lock className="w-8 h-8 text-primary" />
        </div>
        <h1 className="text-2xl font-bold">Painel Administrativo</h1>
        <div className="w-full max-w-xs space-y-3">
          <input type="password" placeholder="Senha de acesso" value={password}
            onChange={e => setPassword(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleLogin()}
            className="w-full px-4 py-4 bg-muted rounded-xl text-lg outline-none focus:ring-2 focus:ring-primary text-center" maxLength={20} />
          {error && <p className="text-secondary text-sm text-center">{error}</p>}
          <button onClick={handleLogin} className="touch-btn w-full bg-primary text-primary-foreground py-4 rounded-xl">Entrar</button>
          <a href="mailto:rufinomahado@gmail.com?subject=Recuperação de Senha - Painel Admin&body=Olá, esqueci a senha do painel administrativo. Por favor, envie a senha de acesso." className="text-primary text-sm text-center block hover:underline">Esqueceu a senha?</a>
        </div>
        <Link to="/" className="text-muted-foreground text-sm hover:text-foreground">← Voltar ao Totem</Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-8">
      <div className="flex items-center justify-between p-4 border-b border-border">
        <div className="flex items-center gap-3">
          <Link to="/" className="text-muted-foreground hover:text-foreground"><ArrowLeft className="w-6 h-6" /></Link>
          <h1 className="text-xl font-bold">Painel Admin</h1>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 p-4 overflow-x-auto">
        {[
          { key: 'orders' as const, label: 'Pedidos', icon: ClipboardList },
          { key: 'products' as const, label: 'Produtos', icon: null },
          { key: 'banners' as const, label: 'Banners', icon: Megaphone },
          { key: 'settings' as const, label: 'Config', icon: Settings },
        ].map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`touch-btn px-5 py-3 rounded-xl text-sm whitespace-nowrap flex items-center gap-1 ${tab === t.key ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>
            {t.icon && <t.icon className="w-4 h-4" />} {t.label}
          </button>
        ))}
      </div>

      {tab === 'orders' && <OrdersPanel />}

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
          <div className="kiosk-card p-4 space-y-4">
            <h3 className="font-bold flex items-center gap-2"><Store className="w-5 h-5 text-primary" /> Nome do Restaurante</h3>
            <input placeholder="Ex: Vision Mídia" value={settings.storeName} onChange={e => setSettings({ ...settings, storeName: e.target.value })} className="w-full px-3 py-3 bg-muted rounded-lg outline-none focus:ring-2 focus:ring-primary" maxLength={50} />
          </div>

          <div className="kiosk-card p-4 space-y-4">
            <h3 className="font-bold flex items-center gap-2"><Image className="w-5 h-5 text-primary" /> Ícones das Categorias</h3>
            <p className="text-xs text-muted-foreground">Suba uma foto ou use um emoji para cada categoria exibida na tela inicial.</p>
            {(['hamburgueres','pizzas','bebidas'] as const).map(key => {
              const value = settings.categoryIcons?.[key] || '';
              const label = key === 'hamburgueres' ? 'Hambúrgueres' : key === 'pizzas' ? 'Pizzas' : 'Bebidas';
              return (
                <div key={key} className="space-y-2">
                  <label className="text-xs text-muted-foreground block font-semibold">{label}</label>
                  <div className="flex gap-2 items-center">
                    <div className="w-16 h-16 rounded-full bg-muted border border-border flex items-center justify-center overflow-hidden flex-shrink-0">
                      {isImageUrl(value) ? (
                        <img src={value} alt={label} className="w-full h-full object-cover" />
                      ) : (
                        <span className="text-3xl">{value || '❓'}</span>
                      )}
                    </div>
                    <label className={`flex-1 touch-btn flex items-center justify-center gap-2 py-3 rounded-lg cursor-pointer border-2 border-dashed border-border hover:border-primary transition-colors ${uploadingCategoryIcon === key ? 'opacity-50 pointer-events-none' : ''}`}>
                      {uploadingCategoryIcon === key ? <Loader2 className="w-5 h-5 animate-spin" /> : <Upload className="w-5 h-5" />}
                      <span className="text-sm">{uploadingCategoryIcon === key ? 'Enviando...' : 'Subir Foto'}</span>
                      <input type="file" accept="image/*" onChange={e => handleCategoryIconUpload(e, key)} className="hidden" disabled={uploadingCategoryIcon === key} />
                    </label>
                    <input
                      placeholder="Emoji"
                      value={isImageUrl(value) ? '' : value}
                      onChange={e => {
                        const updated = { ...settings, categoryIcons: { ...settings.categoryIcons, [key]: e.target.value } };
                        setSettings(updated);
                        saveSettingsToDb(updated);
                      }}
                      className="w-20 px-3 py-3 bg-muted rounded-lg outline-none focus:ring-2 focus:ring-primary text-center text-2xl"
                      maxLength={4}
                    />
                  </div>
                </div>
              );
            })}
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
          </div>

          <div className="kiosk-card p-4 space-y-4">
            <h3 className="font-bold">📱 WhatsApp da Cozinha</h3>
            <input placeholder="Número com código do país (ex: 5562994995768)" value={settings.whatsappNumber} onChange={e => setSettings({ ...settings, whatsappNumber: e.target.value })} className="w-full px-3 py-3 bg-muted rounded-lg outline-none focus:ring-2 focus:ring-primary" maxLength={20} />
          </div>

          <button onClick={saveSettingsHandler} className="touch-btn w-full bg-primary text-primary-foreground py-3 rounded-xl flex items-center justify-center gap-2">
            <Save className="w-4 h-4" /> Salvar Configurações
          </button>
        </div>
      )}
    </div>
  );
};

export default AdminPage;
