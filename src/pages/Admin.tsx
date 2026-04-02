import { useState } from 'react';
import { ArrowLeft, Plus, Pencil, Trash2, Save, Settings, Lock, Image, Store, Zap, Megaphone, Upload, Loader2, ClipboardList } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Product, BannerItem, getProducts, saveProducts, getSettings, saveSettings, formatCurrency } from '@/data/store';
import { uploadProductImage } from '@/lib/imageUpload';
import OrdersPanel from '@/components/admin/OrdersPanel';

const CATEGORIES: Product['category'][] = ['hamburgueres', 'pizzas', 'bebidas'];
const CATEGORY_LABELS = { hamburgueres: '🍔 Hambúrgueres', pizzas: '🍕 Pizzas', bebidas: '🥤 Bebidas' };
const BADGE_COLORS: BannerItem['badgeColor'][] = ['primary', 'secondary', 'accent'];
const BADGE_COLOR_LABELS = { primary: '🟠 Laranja', secondary: '🔴 Vermelho', accent: '🟡 Amarelo' };

const AdminPage = () => {
  const [authenticated, setAuthenticated] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [products, setProducts] = useState<Product[]>(getProducts());
  const [settings, setSettings] = useState(getSettings());
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [tab, setTab] = useState<'products' | 'settings' | 'banners' | 'orders'>('orders');
  const [uploading, setUploading] = useState(false);

  const [form, setForm] = useState({
    name: '', price: '', category: 'hamburgueres' as Product['category'],
    image: '🍔', removableIngredients: '', extras: '',
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
    setForm({ name: '', price: '', category: 'hamburgueres', image: '🍔', removableIngredients: '', extras: '' });
    setEditingProduct(null);
    setShowForm(false);
  };

  const editProduct = (p: Product) => {
    setForm({
      name: p.name, price: p.price.toString(), category: p.category,
      image: p.image, removableIngredients: p.removableIngredients.join(', '),
      extras: p.extras.map(e => `${e.name}:${e.price}`).join(', '),
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

  const saveProduct = () => {
    if (!form.name.trim() || !form.price) return;
    const parsedExtras = form.extras.split(',').map(s => s.trim()).filter(Boolean).map(s => {
      const [name, price] = s.split(':');
      return { name: name?.trim() || '', price: parseFloat(price) || 0 };
    });
    const newProduct: Product = {
      id: editingProduct?.id || crypto.randomUUID(),
      name: form.name.trim(), price: parseFloat(form.price) || 0,
      category: form.category, image: form.image.trim() || '🍔',
      removableIngredients: form.removableIngredients.split(',').map(s => s.trim()).filter(Boolean),
      extras: parsedExtras,
    };
    let updated: Product[];
    if (editingProduct) {
      updated = products.map(p => p.id === editingProduct.id ? newProduct : p);
    } else {
      updated = [...products, newProduct];
    }
    setProducts(updated);
    saveProducts(updated);
    resetForm();
  };

  const deleteProduct = (id: string) => {
    if (!confirm('Tem certeza que deseja excluir este produto?')) return;
    const updated = products.filter(p => p.id !== id);
    setProducts(updated);
    saveProducts(updated);
  };

  const saveSettingsHandler = () => {
    saveSettings(settings);
    alert('Configurações salvas com sucesso!');
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
          <input
            type="password" placeholder="Senha de acesso" value={password}
            onChange={e => setPassword(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleLogin()}
            className="w-full px-4 py-4 bg-muted rounded-xl text-lg outline-none focus:ring-2 focus:ring-primary text-center"
            maxLength={20}
          />
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
                <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value as Product['category'] })} className="w-full px-3 py-3 bg-muted rounded-lg outline-none focus:ring-2 focus:ring-primary">
                  {CATEGORIES.map(c => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
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

              <div className="flex gap-2 pt-2">
                <button onClick={saveProduct} className="touch-btn flex-1 bg-primary text-primary-foreground py-3 rounded-xl flex items-center justify-center gap-2"><Save className="w-4 h-4" /> Salvar</button>
                <button onClick={resetForm} className="touch-btn flex-1 bg-muted text-muted-foreground py-3 rounded-xl">Cancelar</button>
              </div>
            </div>
          )}

          {CATEGORIES.map(cat => {
            const catProducts = products.filter(p => p.category === cat);
            if (catProducts.length === 0) return null;
            return (
              <div key={cat}>
                <h3 className="font-bold text-sm text-muted-foreground mb-2">{CATEGORY_LABELS[cat]}</h3>
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
          <p className="text-xs text-muted-foreground">Banners promocionais exibidos na tela inicial.</p>
          {(settings.banners || []).map((banner, idx) => (
            <div key={banner.id} className="kiosk-card p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="font-bold text-sm">Banner #{idx + 1}</h4>
                <button onClick={() => { const updated = { ...settings, banners: settings.banners.filter(b => b.id !== banner.id) }; setSettings(updated); saveSettings(updated); }} className="p-1 text-muted-foreground hover:text-destructive"><Trash2 className="w-4 h-4" /></button>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Título</label>
                <input value={banner.title} onChange={e => { const banners = [...settings.banners]; banners[idx] = { ...banners[idx], title: e.target.value }; setSettings({ ...settings, banners }); }} className="w-full px-3 py-3 bg-muted rounded-lg outline-none focus:ring-2 focus:ring-primary" maxLength={50} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Subtítulo</label>
                <input value={banner.subtitle} onChange={e => { const banners = [...settings.banners]; banners[idx] = { ...banners[idx], subtitle: e.target.value }; setSettings({ ...settings, banners }); }} className="w-full px-3 py-3 bg-muted rounded-lg outline-none focus:ring-2 focus:ring-primary" maxLength={100} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Imagem (Emoji ou URL)</label>
                <input value={banner.image} onChange={e => { const banners = [...settings.banners]; banners[idx] = { ...banners[idx], image: e.target.value }; setSettings({ ...settings, banners }); }} className="w-full px-3 py-3 bg-muted rounded-lg outline-none focus:ring-2 focus:ring-primary" placeholder="🍔🍟 ou https://..." />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Texto Badge</label>
                  <input value={banner.badgeText} onChange={e => { const banners = [...settings.banners]; banners[idx] = { ...banners[idx], badgeText: e.target.value }; setSettings({ ...settings, banners }); }} className="w-full px-3 py-3 bg-muted rounded-lg outline-none focus:ring-2 focus:ring-primary" placeholder="🔥 PROMO" maxLength={20} />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Cor Badge</label>
                  <select value={banner.badgeColor} onChange={e => { const banners = [...settings.banners]; banners[idx] = { ...banners[idx], badgeColor: e.target.value as BannerItem['badgeColor'] }; setSettings({ ...settings, banners }); }} className="w-full px-3 py-3 bg-muted rounded-lg outline-none focus:ring-2 focus:ring-primary">
                    {BADGE_COLORS.map(c => <option key={c} value={c}>{BADGE_COLOR_LABELS[c]}</option>)}
                  </select>
                </div>
              </div>
            </div>
          ))}

          <button onClick={() => {
            const newBanner: BannerItem = { id: crypto.randomUUID(), title: 'Novo Banner', subtitle: 'Descrição da promoção', image: '🎉', badgeText: '🔥 NOVO', badgeColor: 'primary' };
            setSettings({ ...settings, banners: [...(settings.banners || []), newBanner] });
          }} className="touch-btn w-full bg-muted text-muted-foreground py-3 rounded-xl flex items-center justify-center gap-2 border-2 border-dashed border-border">
            <Plus className="w-5 h-5" /> Adicionar Banner
          </button>

          <button onClick={() => { saveSettings(settings); alert('Banners salvos!'); }} className="touch-btn w-full bg-primary text-primary-foreground py-3 rounded-xl flex items-center justify-center gap-2">
            <Save className="w-4 h-4" /> Salvar Banners
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
            <h3 className="font-bold flex items-center gap-2"><Image className="w-5 h-5 text-primary" /> URL da Imagem de Capa</h3>
            <input placeholder="Cole aqui o link da imagem de fundo do totem" value={settings.coverImage || ''} onChange={e => setSettings({ ...settings, coverImage: e.target.value })} className="w-full px-3 py-3 bg-muted rounded-lg outline-none focus:ring-2 focus:ring-primary" />
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
