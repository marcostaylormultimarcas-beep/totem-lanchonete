// Edge function: admin-users
// Hierarquia: super_admin > master_admin > admin (lojista)
// - super_admin: CRUD em master_admin e admin (sem restrição)
// - master_admin: CRUD apenas em admin cuja organização.master_id = master.id
// - admin: somente leitura do próprio registro
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, DELETE, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const slugify = (s: string) =>
  (s || "").toString().toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Missing auth" }, 401);

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: userErr } = await userClient.auth.getUser();
  if (userErr || !user) return json({ error: "Invalid session" }, 401);

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Determina o tier do caller
  const { data: callerRoles } = await admin
    .from("user_roles").select("role").eq("user_id", user.id);
  const roles = (callerRoles || []).map((r: any) => r.role);
  const isSuper = roles.includes("super_admin") || roles.includes("master"); // legado
  const isMaster = roles.includes("master_admin");
  if (!isSuper && !isMaster) return json({ error: "Forbidden" }, 403);

  const url = new URL(req.url);
  const action = url.searchParams.get("action") ?? "";

  try {
    if (req.method === "GET" && action === "list") {
      const { data: users, error } = await admin.auth.admin.listUsers({ perPage: 500 });
      if (error) throw error;
      const ids = users.users.map((u) => u.id);
      const { data: orgs } = await admin.from("organizations").select("*").in("owner_id", ids);
      const { data: allRoles } = await admin.from("user_roles").select("user_id, role").in("user_id", ids);

      let list = users.users.map((u) => ({
        id: u.id,
        email: u.email,
        created_at: u.created_at,
        banned_until: (u as any).banned_until ?? null,
        org: orgs?.find((o: any) => o.owner_id === u.id) ?? null,
        roles: allRoles?.filter((r: any) => r.user_id === u.id).map((r: any) => r.role) ?? [],
      }));

      // Filtro por escopo
      const scope = url.searchParams.get("scope"); // 'masters' | 'stores' | undefined
      if (isSuper && scope === "masters") {
        list = list.filter((u) => u.roles.includes("master_admin"));
      } else if (isSuper && scope === "stores") {
        list = list.filter((u) => u.org); // qualquer loja
      } else if (isMaster && !isSuper) {
        // master_admin só vê lojistas vinculados a ele
        list = list.filter((u) => u.org && (u.org as any).master_id === user.id);
      }
      return json({ users: list });
    }

    if (req.method === "POST" && action === "create") {
      const body = await req.json();
      const { email, password, store_name, slug: requestedSlug } = body;
      let role: "master_admin" | "admin" = body.role || "admin";
      const isMasterCreation = role === "master_admin";

      if (!email || !password) return json({ error: "email/password required" }, 400);
      if (isMasterCreation && !isSuper) return json({ error: "Apenas Super Admin cria Masters" }, 403);
      if (!isMasterCreation && !isSuper && !isMaster) return json({ error: "Forbidden" }, 403);

      // Cria ou atualiza usuário
      let userId: string | null = null;
      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email, password, email_confirm: true,
        user_metadata: {
          display_name: store_name || email.split("@")[0],
          account_type: "admin",
        },
      });
      if (createErr) {
        const isDup = (createErr as any).code === "email_exists" ||
          /already been registered|already exists/i.test(createErr.message || "");
        if (!isDup) throw createErr;
        const { data: list } = await admin.auth.admin.listUsers({ perPage: 500 });
        const existing = list.users.find((u) => (u.email || "").toLowerCase() === String(email).toLowerCase());
        if (!existing) throw new Error("Usuário existe mas não foi possível localizá-lo.");
        userId = existing.id;
        await admin.auth.admin.updateUserById(userId, { password, email_confirm: true } as any);
      } else {
        userId = created.user?.id ?? null;
      }
      if (!userId) throw new Error("Falha ao obter ID do usuário.");

      // Grava role
      await admin.from("user_roles").upsert(
        { user_id: userId, role },
        { onConflict: "user_id,role" } as any,
      );

      if (isMasterCreation) {
        // Master Admin não recebe loja automaticamente
        return json({ user: { id: userId, email, role } });
      }

      // Admin (lojista): garante organização e vincula master_id se criado por master
      const { data: existingOrg } = await admin
        .from("organizations").select("id").eq("owner_id", userId).maybeSingle();

      if (!existingOrg) {
        const cleanReq = slugify(requestedSlug || "");
        const base = cleanReq || slugify(email.split("@")[0]) || `loja-${userId.slice(0, 8)}`;
        let slug = base;
        let i = 0;
        while (true) {
          const { data: clash } = await admin
            .from("organizations").select("id").eq("slug", slug).maybeSingle();
          if (!clash) break;
          i++;
          slug = `${base}-${i}`;
        }
        const master_id = isMaster && !isSuper ? user.id : (body.master_id ?? null);
        const { data: newOrg, error: orgErr } = await admin
          .from("organizations")
          .insert({ name: store_name || base, slug, owner_id: userId, master_id })
          .select().maybeSingle();
        if (orgErr) throw orgErr;
        if (newOrg) {
          await admin.from("settings").insert({
            organization_id: newOrg.id,
            store_name: store_name || base,
            whatsapp_number: "", instagram_url: "",
          });
        }
      } else if (isMaster && !isSuper) {
        // Se loja já existir, garante vínculo ao master atual
        await admin.from("organizations")
          .update({ master_id: user.id })
          .eq("id", existingOrg.id);
      }

      return json({ user: { id: userId, email, role } });
    }

    // Helper: garante que o caller tem permissão sobre target user
    const canActOn = async (target_id: string) => {
      if (isSuper) return true;
      if (!isMaster) return false;
      const { data: org } = await admin
        .from("organizations").select("master_id").eq("owner_id", target_id).maybeSingle();
      return !!org && (org as any).master_id === user.id;
    };

    if (req.method === "POST" && (action === "pause" || action === "unpause")) {
      const { user_id } = await req.json();
      if (!user_id) return json({ error: "user_id required" }, 400);
      if (!(await canActOn(user_id))) return json({ error: "Forbidden" }, 403);
      const ban_duration = action === "pause" ? "876000h" : "none";
      const { error } = await admin.auth.admin.updateUserById(user_id, { ban_duration } as any);
      if (error) throw error;
      await admin.from("organizations").update({ paused: action === "pause" }).eq("owner_id", user_id);
      return json({ ok: true });
    }

    if (req.method === "POST" && action === "set_password") {
      const { user_id, password } = await req.json();
      if (!user_id || !password) return json({ error: "user_id/password required" }, 400);
      if (!(await canActOn(user_id))) return json({ error: "Forbidden" }, 403);
      const { error } = await admin.auth.admin.updateUserById(user_id, { password });
      if (error) throw error;
      return json({ ok: true });
    }

    if (req.method === "POST" && action === "set_master") {
      // Apenas super pode (promover/rebaixar para super_admin)
      if (!isSuper) return json({ error: "Forbidden" }, 403);
      const { user_id, is_master } = await req.json();
      if (!user_id) return json({ error: "user_id required" }, 400);
      if (is_master) {
        await admin.from("user_roles").upsert({ user_id, role: "super_admin" } as any);
      } else {
        await admin.from("user_roles").delete().eq("user_id", user_id).in("role", ["super_admin", "master"] as any);
      }
      return json({ ok: true });
    }

    if (req.method === "DELETE" && action === "delete") {
      const { user_id } = await req.json();
      if (!user_id) return json({ error: "user_id required" }, 400);
      if (user_id === user.id) return json({ error: "Não pode excluir você mesmo" }, 400);
      if (!(await canActOn(user_id))) return json({ error: "Forbidden" }, 403);
      const { error } = await admin.auth.admin.deleteUser(user_id);
      if (error) throw error;
      return json({ ok: true });
    }

    return json({ error: "Unknown action" }, 404);
  } catch (e: any) {
    console.error("admin-users error", e);
    return json({ error: e?.message ?? "Internal error" }, 500);
  }
});
