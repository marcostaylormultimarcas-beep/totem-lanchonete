import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Trash2, Plus, Users, Power, ExternalLink } from "lucide-react";

interface Operador {
  id: string;
  name: string;
  username: string;
  password: string;
  active: boolean;
}

export default function OperadoresPdvPanel({
  organizationId,
  orgSlug,
}: {
  organizationId: string | null;
  orgSlug: string | null;
}) {
  const [list, setList] = useState<Operador[]>([]);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ name: "", username: "", password: "" });

  const load = async () => {
    if (!organizationId) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("operadores_pdv")
      .select("id,name,username,password,active")
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false });
    setLoading(false);
    if (error) {
      toast.error("Erro ao carregar operadores");
      return;
    }
    setList((data as Operador[]) || []);
  };

  useEffect(() => {
    load();
  }, [organizationId]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!organizationId) return;
    if (!form.name.trim() || !form.username.trim() || form.password.length < 4) {
      toast.error("Preencha nome, usuário e senha (mín. 4 caracteres)");
      return;
    }
    const { error } = await supabase.from("operadores_pdv").insert({
      organization_id: organizationId,
      name: form.name.trim(),
      username: form.username.trim().toLowerCase(),
      password: form.password,
      active: true,
    });
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Operador cadastrado");
    setForm({ name: "", username: "", password: "" });
    load();
  };

  const toggle = async (op: Operador) => {
    const { error } = await supabase
      .from("operadores_pdv")
      .update({ active: !op.active })
      .eq("id", op.id);
    if (error) return toast.error(error.message);
    load();
  };

  const remove = async (op: Operador) => {
    if (!confirm(`Excluir operador ${op.name}?`)) return;
    const { error } = await supabase.from("operadores_pdv").delete().eq("id", op.id);
    if (error) return toast.error(error.message);
    toast.success("Operador removido");
    load();
  };

  return (
    <div className="p-4 space-y-6 max-w-5xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center">
            <Users className="w-5 h-5 text-amber-500" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-white">Operadores do PDV</h2>
            <p className="text-xs text-zinc-400">Usuários liberados para abrir o caixa do balcão</p>
          </div>
        </div>
        {orgSlug && (
          <a
            href={`/pdv/${orgSlug}`}
            target="_blank"
            rel="noreferrer"
            className="touch-btn px-4 py-2 rounded-xl text-sm font-semibold bg-amber-500 text-zinc-950 hover:bg-amber-400 inline-flex items-center gap-2"
          >
            <ExternalLink className="w-4 h-4" /> Abrir PDV
          </a>
        )}
      </div>

      <form
        onSubmit={submit}
        className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 grid grid-cols-1 md:grid-cols-4 gap-3"
      >
        <input
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          placeholder="Nome do operador"
          className="bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-zinc-500 focus:border-amber-500 outline-none"
        />
        <input
          value={form.username}
          onChange={(e) => setForm({ ...form, username: e.target.value })}
          placeholder="Usuário (login)"
          className="bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-zinc-500 focus:border-amber-500 outline-none"
        />
        <input
          value={form.password}
          onChange={(e) => setForm({ ...form, password: e.target.value })}
          placeholder="Senha"
          type="text"
          className="bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-zinc-500 focus:border-amber-500 outline-none"
        />
        <button
          type="submit"
          className="touch-btn rounded-lg bg-amber-500 text-zinc-950 font-bold text-sm inline-flex items-center justify-center gap-2 hover:bg-amber-400"
        >
          <Plus className="w-4 h-4" /> Adicionar
        </button>
      </form>

      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-zinc-950/60 text-zinc-400 text-xs uppercase">
            <tr>
              <th className="text-left px-4 py-2.5">Nome</th>
              <th className="text-left px-4 py-2.5">Usuário</th>
              <th className="text-left px-4 py-2.5">Senha</th>
              <th className="text-left px-4 py-2.5">Status</th>
              <th className="text-right px-4 py-2.5">Ações</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-zinc-500">
                  Carregando…
                </td>
              </tr>
            )}
            {!loading && list.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-zinc-500">
                  Nenhum operador cadastrado ainda.
                </td>
              </tr>
            )}
            {list.map((op) => (
              <tr key={op.id} className="border-t border-zinc-800/70">
                <td className="px-4 py-3 text-white font-medium">{op.name}</td>
                <td className="px-4 py-3 text-zinc-300">{op.username}</td>
                <td className="px-4 py-3 text-zinc-500 font-mono">{op.password}</td>
                <td className="px-4 py-3">
                  <span
                    className={`px-2 py-1 rounded-md text-xs font-semibold border ${
                      op.active
                        ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                        : "bg-zinc-800 text-zinc-400 border-zinc-700"
                    }`}
                  >
                    {op.active ? "Ativo" : "Inativo"}
                  </span>
                </td>
                <td className="px-4 py-3 text-right space-x-2">
                  <button
                    onClick={() => toggle(op)}
                    className="touch-btn p-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200"
                    title={op.active ? "Desativar" : "Ativar"}
                  >
                    <Power className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => remove(op)}
                    className="touch-btn p-2 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
