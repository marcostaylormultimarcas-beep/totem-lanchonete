from pathlib import Path
p=Path('src/components/kiosk/PaymentScreen.tsx')
s=p.read_text()
old="""        await supabase.from('orders').update({
          nfe_url: nfeUrl,
          nfe_status: 'issued',
          nfe_numero: `NFE-${data.id.replace(/-/g, '').slice(0, 16).toUpperCase()}`,
        }).eq('id', data.id);

        // Impressão automática no totem (após confirmação de pagamento)
        setTimeout(() => {
          try { window.open(nfeUrl, '_blank', 'noopener'); } catch {}
        }, 800);
"""
new="""        const { error: fiscalError } = await supabase.from('orders').update({
          nfe_url: nfeUrl,
          nfe_status: 'issued',
          nfe_numero: `NFE-${data.id.replace(/-/g, '').slice(0, 16).toUpperCase()}`,
        }).eq('id', data.id);

        if (fiscalError) {
          console.error('Error linking fiscal document to order:', fiscalError);
          toast.warning('Pedido registrado, mas o documento fiscal não foi vinculado.', {
            description: 'O pedido continua válido. Verifique a emissão fiscal no administrativo.',
          });
        } else {
          // Abre o documento somente depois de confirmar que o vínculo fiscal foi salvo.
          setTimeout(() => {
            try { window.open(nfeUrl, '_blank', 'noopener'); } catch {}
          }, 800);
        }
"""
if s.count(old)!=1: raise SystemExit(f'guard expected 1 fiscal block, got {s.count(old)}')
s=s.replace(old,new,1)
p.write_text(s)
print('fiscal update error handling applied')
