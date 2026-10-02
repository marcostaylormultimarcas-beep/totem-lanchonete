from pathlib import Path
p=Path('src/components/kiosk/PaymentScreen.tsx')
s=p.read_text()
old="""      // Get next order number from DB count
      const { count } = await supabase.from('orders').select('*', { count: 'exact', head: true }).eq('organization_id', orgId);
      const num = ((count || 0) + 1).toString().padStart(3, '0');
      setGeneratedNumber(num);
"""
new="""      if (!orgId) throw new Error('Loja não identificada. Recarregue o cardápio e tente novamente.');

      // Reserva a senha de forma atômica no banco, isolada por organização.
      const { data: nextNumber, error: numberError } = await supabase.rpc('next_order_number' as any, {
        _organization_id: orgId,
      });
      if (numberError || !nextNumber) throw numberError || new Error('Não foi possível gerar a senha do pedido.');
      const num = String(nextNumber);
      setGeneratedNumber(num);
"""
if s.count(old)!=1: raise SystemExit(f'guard expected 1 old numbering block, got {s.count(old)}')
s=s.replace(old,new,1)
p.write_text(s)
print('atomic order numbering frontend cutover applied')
