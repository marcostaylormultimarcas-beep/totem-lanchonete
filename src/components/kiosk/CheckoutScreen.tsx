import { useEffect, useState } from 'react';
import { ArrowLeft, User, Phone, MapPin, Navigation, UserCheck, FileText, Building, Search, Loader2, CheckCircle2, XCircle } from 'lucide-react';
import { maskCpf, isValidCpf } from '@/lib/cpf';
import { supabase } from '@/integrations/supabase/client';
import { useOrgId } from '@/contexts/OrgContext';
import { formatCurrency } from '@/data/store';
import { fetchViaCep, geocodeAddress, maskCep, normalizeCep } from '@/lib/cep';
import { toast } from 'sonner';

interface Bairro {
  id: string;
  nome_bairro: string;
  valor_taxa: number;
  tempo_estimado: number;
  ativo: boolean;
}

type DeliveryMode = 'bairros' | 'raio_km' | 'lista_ceps';


interface CheckoutScreenProps {
  name: string;
  phone: string;
  cpf: string;
  orderType: 'local' | 'viagem';
  deliveryAddress: string;
  deliveryReference: string;
  deliveryRecipient: string;
  bairroId: string;
  onBairroChange: (id: string, nome: string, taxa: number, tempo: number) => void;
  onNameChange: (v: string) => void;
  onPhoneChange: (v: string) => void;
  onCpfChange: (v: string) => void;
  onDeliveryAddressChange: (v: string) => void;
  onDeliveryReferenceChange: (v: string) => void;
  onDeliveryRecipientChange: (v: string) => void;
  onContinue: () => void;
  onBack: () => void;
}

const CheckoutScreen = ({
  name, phone, cpf, orderType,
  deliveryAddress, deliveryReference, deliveryRecipient,
  bairroId, onBairroChange,
  onNameChange, onPhoneChange, onCpfChange,
  onDeliveryAddressChange, onDeliveryReferenceChange, onDeliveryRecipientChange,
  onContinue, onBack,
}: CheckoutScreenProps) => {
  const orgId = useOrgId();
  const [bairros, setBairros] = useState<Bairro[]>([]);
  const [loadingBairros, setLoadingBairros] = useState(false);

  useEffect(() => {
    if (!orgId || orderType !== 'viagem') return;
    setLoadingBairros(true);
    supabase.from('taxas_entrega' as any)
      .select('id,nome_bairro,valor_taxa,tempo_estimado,ativo')
      .eq('organization_id', orgId)
      .eq('ativo', true)
      .order('nome_bairro', { ascending: true })
      .then(({ data }) => {
        setBairros(((data as any[]) || []) as Bairro[]);
        setLoadingBairros(false);
      });
  }, [orgId, orderType]);

  const selectedBairro = bairros.find(b => b.id === bairroId);
  const baseValid = name.trim().length >= 2 && phone.trim().length >= 8;
  const cpfValid = !cpf || isValidCpf(cpf);
  const bairroNeeded = orderType === 'viagem' && bairros.length > 0;
  const bairroValid = !bairroNeeded || !!selectedBairro;
  const deliveryValid = orderType === 'viagem'
    ? deliveryAddress.trim().length >= 5 && deliveryRecipient.trim().length >= 2 && bairroValid
    : true;
  const isValid = baseValid && deliveryValid && cpfValid;

  return (
    <div className="min-h-screen flex flex-col">
      <div className="flex items-center gap-4 p-4 border-b border-border">
        <button onClick={onBack} className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-7 h-7" />
        </button>
        <h2 className="text-xl font-bold">Seus Dados</h2>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center px-6 gap-6 max-w-md mx-auto w-full py-6">
        <div className="text-center space-y-2">
          <span className="text-5xl">👤</span>
          <h3 className="text-2xl font-bold">Quase lá!</h3>
          <p className="text-muted-foreground">Informe seus dados para o pedido</p>
        </div>

        <div className="w-full space-y-4">
          <div className="relative">
            <User className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
            <input
              type="text"
              placeholder="Seu nome"
              value={name}
              onChange={e => onNameChange(e.target.value)}
              className="w-full pl-12 pr-4 py-4 bg-muted rounded-xl text-lg outline-none focus:ring-2 focus:ring-primary transition-all"
              maxLength={100}
            />
          </div>
          <div className="relative">
            <Phone className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
            <input
              type="tel"
              placeholder="Seu telefone"
              value={phone}
              onChange={e => onPhoneChange(e.target.value)}
              className="w-full pl-12 pr-4 py-4 bg-muted rounded-xl text-lg outline-none focus:ring-2 focus:ring-primary transition-all"
              maxLength={20}
            />
          </div>

          <div className="relative">
            <FileText className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
            <input
              type="text"
              inputMode="numeric"
              placeholder="CPF na Nota (opcional)"
              value={cpf}
              onChange={e => onCpfChange(maskCpf(e.target.value))}
              className={`w-full pl-12 pr-4 py-4 bg-muted rounded-xl text-lg outline-none focus:ring-2 transition-all ${cpf && !cpfValid ? 'ring-2 ring-destructive' : 'focus:ring-primary'}`}
              maxLength={14}
            />
            {cpf && !cpfValid && (
              <p className="text-destructive text-xs mt-1 ml-1">CPF inválido</p>
            )}
            {!cpf && (
              <p className="text-muted-foreground text-[11px] mt-1 ml-1">Preencha para receber a Nota Fiscal vinculada ao pedido</p>
            )}
          </div>

          {orderType === 'viagem' && (
            <>
              <hr className="border-border" />
              <p className="text-sm font-bold text-primary flex items-center gap-2">
                <MapPin className="w-4 h-4" /> Dados de Entrega
              </p>

              {/* Seletor de bairro */}
              <div>
                <label className="text-xs font-bold text-muted-foreground mb-1 ml-1 block flex items-center gap-1">
                  <Building className="w-3 h-3" /> Selecione seu Bairro
                </label>
                {loadingBairros ? (
                  <div className="w-full py-4 bg-muted rounded-xl text-center text-sm text-muted-foreground">Carregando bairros...</div>
                ) : bairros.length === 0 ? (
                  <div className="w-full px-3 py-3 bg-destructive/10 border border-destructive/30 rounded-xl text-xs text-destructive">
                    A loja ainda não cadastrou bairros de entrega. Selecione "Comer no Local" ou entre em contato com a loja.
                  </div>
                ) : (
                  <select
                    value={bairroId}
                    onChange={e => {
                      const b = bairros.find(x => x.id === e.target.value);
                      if (b) onBairroChange(b.id, b.nome_bairro, Number(b.valor_taxa), b.tempo_estimado);
                      else onBairroChange('', '', 0, 0);
                    }}
                    className="w-full px-4 py-4 bg-muted rounded-xl text-lg outline-none focus:ring-2 focus:ring-primary"
                  >
                    <option value="">— Escolha o bairro —</option>
                    {bairros.map(b => (
                      <option key={b.id} value={b.id}>
                        {b.nome_bairro} — {formatCurrency(Number(b.valor_taxa))} ({b.tempo_estimado} min)
                      </option>
                    ))}
                  </select>
                )}
                {selectedBairro && (
                  <p className="text-xs text-success mt-1 ml-1 flex items-center gap-1">
                    ✓ Taxa: <span className="font-bold">{formatCurrency(Number(selectedBairro.valor_taxa))}</span>
                    <span className="text-muted-foreground">• Entrega em ~{selectedBairro.tempo_estimado} min</span>
                  </p>
                )}
              </div>

              <div className="relative">
                <MapPin className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Endereço completo (rua, nº)"
                  value={deliveryAddress}
                  onChange={e => onDeliveryAddressChange(e.target.value)}
                  className="w-full pl-12 pr-4 py-4 bg-muted rounded-xl text-lg outline-none focus:ring-2 focus:ring-primary transition-all"
                  maxLength={200}
                />
              </div>
              <div className="relative">
                <Navigation className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Ponto de referência (opcional)"
                  value={deliveryReference}
                  onChange={e => onDeliveryReferenceChange(e.target.value)}
                  className="w-full pl-12 pr-4 py-4 bg-muted rounded-xl text-lg outline-none focus:ring-2 focus:ring-primary transition-all"
                  maxLength={200}
                />
              </div>
              <div className="relative">
                <UserCheck className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Nome de quem vai receber"
                  value={deliveryRecipient}
                  onChange={e => onDeliveryRecipientChange(e.target.value)}
                  className="w-full pl-12 pr-4 py-4 bg-muted rounded-xl text-lg outline-none focus:ring-2 focus:ring-primary transition-all"
                  maxLength={100}
                />
              </div>
            </>
          )}
        </div>

        <button
          onClick={onContinue}
          disabled={!isValid}
          className={`touch-btn w-full py-4 rounded-xl text-lg ${
            isValid ? 'bg-primary text-primary-foreground cta-breath' : 'bg-muted text-muted-foreground cursor-not-allowed'
          }`}
        >
          Ir para Pagamento
        </button>
      </div>
    </div>
  );
};

export default CheckoutScreen;
