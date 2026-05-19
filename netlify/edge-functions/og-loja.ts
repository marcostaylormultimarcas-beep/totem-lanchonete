// Netlify Edge Function: injeta tags Open Graph dinâmicas para rotas /loja/:slug
// Roda no edge (Deno) ANTES de servir o index.html do SPA — o crawler do WhatsApp/Facebook
// recebe HTML já com as metatags da loja específica.

import type { Context } from "https://edge.netlify.com/";

const SUPABASE_URL = "https://upwstbeimnlgohbqogzz.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVwd3N0YmVpbW5sZ29oYnFvZ3p6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUwOTQ4NDQsImV4cCI6MjA5MDY3MDg0NH0.jTK21_zbLLcqPWAVSjOJCwAVrGJ7L6iftFyoppmdtJE";

const DEFAULT_TITLE = "Vision Mídia Digital - Autoatendimento";
const DEFAULT_DESC = "Sistema de pedidos inteligente para lanchonetes e totens.";
const DEFAULT_IMAGE =
  "https://storage.googleapis.com/gpt-engineer-file-uploads/CjSEvxfoC6ZkT4Wl8xqLc2qxgrl2/social-images/social-1774985695387-1000712360.webp";

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

async function fetchStoreMeta(slug: string) {
  try {
    // 1) organização pelo slug
    const orgResp = await fetch(
      `${SUPABASE_URL}/rest/v1/organizations?slug=eq.${encodeURIComponent(slug)}&select=id,name&limit=1`,
      {
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        },
      },
    );
    if (!orgResp.ok) return null;
    const orgs = await orgResp.json();
    const org = Array.isArray(orgs) ? orgs[0] : null;
    if (!org?.id) return null;

    // 2) settings da organização
    const setResp = await fetch(
      `${SUPABASE_URL}/rest/v1/settings?organization_id=eq.${org.id}&select=store_name,share_image,cover_image&limit=1`,
      {
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        },
      },
    );
    const settings = setResp.ok ? (await setResp.json())[0] : null;

    const name = settings?.store_name || org.name || DEFAULT_TITLE;
    const image = settings?.share_image || settings?.cover_image || DEFAULT_IMAGE;
    const description = `Faça seu pedido em ${name}. Cardápio digital e autoatendimento.`;

    return { name, image, description };
  } catch (e) {
    console.error("[og-loja] fetch error:", e);
    return null;
  }
}

export default async (request: Request, context: Context) => {
  const url = new URL(request.url);
  const match = url.pathname.match(/^\/loja\/([^\/]+)/);
  if (!match) return context.next();

  const slug = decodeURIComponent(match[1]).trim().toLowerCase();
  if (!slug) return context.next();

  // Busca os dados da loja em paralelo com a resposta original do SPA
  const [response, meta] = await Promise.all([context.next(), fetchStoreMeta(slug)]);

  if (!meta) return response;

  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("text/html")) return response;

  const title = escapeHtml(meta.name);
  const description = escapeHtml(meta.description);
  const image = escapeHtml(meta.image);
  const pageUrl = escapeHtml(url.toString());

  let html = await response.text();

  // 1) <title>
  html = html.replace(/<title>[^<]*<\/title>/i, `<title>${title}</title>`);

  // 2) meta description
  html = html.replace(
    /<meta\s+name=["']description["'][^>]*>/i,
    `<meta name="description" content="${description}">`,
  );

  // 3) og:title / og:description / og:image / og:url
  const replaceOrInject = (
    propAttr: "property" | "name",
    propValue: string,
    contentValue: string,
  ) => {
    const re = new RegExp(
      `<meta\\s+${propAttr}=["']${propValue}["'][^>]*>`,
      "i",
    );
    const tag = `<meta ${propAttr}="${propValue}" content="${contentValue}">`;
    if (re.test(html)) {
      html = html.replace(re, tag);
    } else {
      html = html.replace("</head>", `  ${tag}\n  </head>`);
    }
  };

  replaceOrInject("property", "og:title", title);
  replaceOrInject("property", "og:description", description);
  replaceOrInject("property", "og:image", image);
  replaceOrInject("property", "og:url", pageUrl);
  replaceOrInject("property", "og:type", "website");
  replaceOrInject("name", "twitter:card", "summary_large_image");
  replaceOrInject("name", "twitter:title", title);
  replaceOrInject("name", "twitter:description", description);
  replaceOrInject("name", "twitter:image", image);

  // 4) favicon
  if (/<link[^>]+rel=["']icon["'][^>]*>/i.test(html)) {
    html = html.replace(
      /<link[^>]+rel=["']icon["'][^>]*>/i,
      `<link rel="icon" href="${image}">`,
    );
  } else {
    html = html.replace("</head>", `  <link rel="icon" href="${image}">\n  </head>`);
  }

  return new Response(html, {
    status: response.status,
    headers: {
      ...Object.fromEntries(response.headers),
      "content-type": "text/html; charset=utf-8",
      "cache-control": "public, max-age=0, must-revalidate",
    },
  });
};

export const config = {
  path: "/loja/*",
};
