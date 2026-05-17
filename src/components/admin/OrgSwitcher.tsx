import { useState } from 'react';
import { Check, ChevronsUpDown, Building2, ExternalLink, Pause } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface Org { id: string; name: string; slug: string; paused?: boolean }

interface Props {
  orgs: Org[];
  activeOrgId: string | null;
  onChange: (id: string) => void;
}

const OrgSwitcher = ({ orgs, activeOrgId, onChange }: Props) => {
  const [open, setOpen] = useState(false);
  const active = orgs.find(o => o.id === activeOrgId);

  const copyLink = (slug: string) => {
    navigator.clipboard.writeText(`${window.location.origin}/cardapio/${slug}`);
    toast.success('Link do totem copiado!');
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          role="combobox"
          aria-expanded={open}
          className="touch-btn flex items-center gap-2 bg-muted hover:bg-muted/70 px-3 py-2 rounded-lg text-sm flex-1 max-w-xs min-w-0 transition-colors"
        >
          <Building2 className="w-4 h-4 text-primary flex-shrink-0" />
          <span className="truncate font-semibold flex-1 text-left">
            {active?.name || 'Selecionar loja'}
          </span>
          {active?.paused && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-destructive/20 text-destructive flex items-center gap-1">
              <Pause className="w-2.5 h-2.5" />pausada
            </span>
          )}
          <ChevronsUpDown className="w-4 h-4 text-muted-foreground flex-shrink-0" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[320px] p-0 bg-popover border-border" align="start">
        <Command>
          <CommandInput placeholder="Buscar loja..." className="h-10" />
          <CommandList>
            <CommandEmpty>Nenhuma loja encontrada.</CommandEmpty>
            <CommandGroup heading={`${orgs.length} loja(s)`}>
              {orgs.map(o => (
                <CommandItem
                  key={o.id}
                  value={`${o.name} ${o.slug}`}
                  onSelect={() => { onChange(o.id); setOpen(false); }}
                  className="flex items-center gap-2 cursor-pointer"
                >
                  <Check className={cn('w-4 h-4', activeOrgId === o.id ? 'opacity-100 text-primary' : 'opacity-0')} />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate flex items-center gap-2">
                      {o.name}
                      {o.paused && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-destructive/20 text-destructive">pausada</span>}
                    </div>
                    <div className="text-xs text-muted-foreground truncate">/cardapio/{o.slug}</div>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); copyLink(o.slug); }}
                    className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-primary"
                    title="Copiar link do totem"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </button>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
};

export default OrgSwitcher;
