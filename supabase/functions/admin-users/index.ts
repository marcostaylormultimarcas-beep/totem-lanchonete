// Edge function: admin-users
// Master-only: criar, pausar, despausar, deletar e listar usuários.
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Missing auth" }, 401);

  // Validar o usuário pelo token recebido
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: userErr } = await userClient.auth.getUser();
  if (userErr || !user) return json({ error: "Invalid session" }, 401);

  // Cliente admin (service role)
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Verifica role master
  const { data: roleRow } = await admin
    .from("user_roles")
    .select("role")
    .eq("user_id", user.id)
    .eq("role", "master")
    .maybeSingle();
  if (!roleRow) return json({ error: "Forbidden — Master only" }, 403);

  const url = new URL(req.url);
  const action = url.searchParams.get("action") ?? "";

  try {
    if (req.method === "GET" && action === "list") {
      const { data: users, error } = await admin.auth.admin.listUsers({ perPage: 200 });
      if (error) throw error;
      const ids = users.users.map((u) => u.id);
      const { data: orgs } = await admin.from("organizations").select("*").in("owner_id", ids);
      const { data: roles } = await admin.from("user_roles").select("user_id, role").in("user_id", ids);
      const list = users.users.map((u) => ({
        id: u.id,
        email: u.email,
        created_at: u.created_at,
        banned_until: (u as any).banned_until ?? null,
        org: orgs?.find((o: any) => o.owner_id === u.id) ?? null,
        roles: roles?.filter((r: any) => r.user_id === u.id).map((r: any) => r.role) ?? [],
      }));
      return json({ users: list });
    }

    if (req.method === "POST" && action === "create") {
      const { email, password, is_master, store_name, slug: requestedSlug } = await req.json();
      if (!email || !password) return json({ error: "email/password required" }, 400);

      // Tenta criar; se já existe, busca o usuário e atualiza senha/metadata
      let userId: string | null = null;
      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: {
          display_name: store_name || email.split("@")[0],
          account_type: "admin",
        },
      });

      if (createErr) {
        const isDuplicate =
          (createErr as any).code === "email_exists" ||
          /already been registered|already exists/i.test(createErr.message || "");
        if (!isDuplicate) throw createErr;

        // Localiza usuário existente
        const { data: list, error: listErr } = await admin.auth.admin.listUsers({ perPage: 200 });
        if (listErr) throw listErr;
        const existing = list.users.find(
          (u) => (u.email || "").toLowerCase() === String(email).toLowerCase()
        );
        if (!existing) throw new Error("Usuário existe mas não foi possível localizá-lo.");
        userId = existing.id;

        // Atualiza senha e marca como admin
        const { error: updErr } = await admin.auth.admin.updateUserById(userId, {
          password,
          email_confirm: true,
          user_metadata: {
            ...(existing.user_metadata || {}),
            display_name: store_name || existing.user_metadata?.display_name || email.split("@")[0],
            account_type: "admin",
          },
        } as any);
        if (updErr) throw updErr;
      } else {
        userId = created.user?.id ?? null;
      }

      if (!userId) throw new Error("Falha ao obter ID do usuário.");

      // Garante role admin
      await admin.from("user_roles").upsert(
        { user_id: userId, role: "admin" },
        { onConflict: "user_id,role" } as any
      );

      // Garante organização (trigger não roda em update de usuário já existente)
      const { data: existingOrg } = await admin
        .from("organizations")
        .select("id")
        .eq("owner_id", userId)
        .maybeSingle();

      if (!existingOrg) {
        const base = (email.split("@")[0] || "loja")
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "") || `loja-${userId.slice(0, 8)}`;
        let slug = base;
        let i = 0;
        // garante slug único
        while (true) {
          const { data: clash } = await admin
            .from("organizations").select("id").eq("slug", slug).maybeSingle();
          if (!clash) break;
          i++;
          slug = `${base}-${i}`;
        }
        const { data: newOrg, error: orgErr } = await admin
          .from("organizations")
          .insert({ name: store_name || base, slug, owner_id: userId })
          .select().maybeSingle();
        if (orgErr) throw orgErr;
        if (newOrg) {
          await admin.from("settings").insert({
            organization_id: newOrg.id,
            store_name: store_name || base,
            whatsapp_number: "",
            instagram_url: "",
          });
        }
      }

      if (is_master) {
        await admin.from("user_roles").upsert(
          { user_id: userId, role: "master" },
          { onConflict: "user_id,role" } as any
        );
      }

      return json({ user: { id: userId, email } });
    }

    if (req.method === "POST" && (action === "pause" || action === "unpause")) {
      const { user_id } = await req.json();
      if (!user_id) return json({ error: "user_id required" }, 400);
      const ban_duration = action === "pause" ? "876000h" : "none"; // ~100 anos
      const { error } = await admin.auth.admin.updateUserById(user_id, { ban_duration } as any);
      if (error) throw error;
      // Sincroniza flag em organizations
      await admin.from("organizations").update({ paused: action === "pause" }).eq("owner_id", user_id);
      return json({ ok: true });
    }

    if (req.method === "POST" && action === "set_password") {
      const { user_id, password } = await req.json();
      if (!user_id || !password) return json({ error: "user_id/password required" }, 400);
      const { error } = await admin.auth.admin.updateUserById(user_id, { password });
      if (error) throw error;
      return json({ ok: true });
    }

    if (req.method === "POST" && action === "set_master") {
      const { user_id, is_master } = await req.json();
      if (!user_id) return json({ error: "user_id required" }, 400);
      if (is_master) {
        await admin.from("user_roles").upsert({ user_id, role: "master" });
      } else {
        await admin.from("user_roles").delete().eq("user_id", user_id).eq("role", "master");
      }
      return json({ ok: true });
    }

    if (req.method === "DELETE" && action === "delete") {
      const { user_id } = await req.json();
      if (!user_id) return json({ error: "user_id required" }, 400);
      if (user_id === user.id) return json({ error: "Não pode excluir você mesmo" }, 400);
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
