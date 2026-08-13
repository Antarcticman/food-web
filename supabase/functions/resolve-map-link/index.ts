import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const allowedOrigins = new Set([
  "https://antarcticman.github.io",
  "http://127.0.0.1:4173",
  "http://localhost:4173",
]);
const googleHosts = new Set([
  "maps.app.goo.gl",
  "goo.gl",
  "maps.google.com",
  "www.google.com",
  "google.com",
]);

function corsHeaders(request: Request) {
  const origin = request.headers.get("origin") ?? "";
  return {
    "Access-Control-Allow-Origin": allowedOrigins.has(origin) ? origin : "https://antarcticman.github.io",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function json(request: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(request), "Content-Type": "application/json; charset=utf-8" },
  });
}

function parseAllowedUrl(value: string, base?: URL) {
  const parsed = base ? new URL(value, base) : new URL(value);
  if (parsed.protocol !== "https:" || !googleHosts.has(parsed.hostname.toLowerCase())) {
    throw new Error("只支援 Google 地圖分享網址");
  }
  return parsed;
}

function cleanText(value: string | null) {
  if (!value) return null;
  const cleaned = decodeURIComponent(value.replace(/\+/g, " ")).replace(/\s+/g, " ").trim();
  return cleaned || null;
}

function detailsFromUrls(urls: URL[]) {
  let name: string | null = null;
  let query: string | null = null;
  let latitude: number | null = null;
  let longitude: number | null = null;
  let externalId: string | null = null;

  for (const url of urls) {
    query ??= cleanText(url.searchParams.get("q"));
    externalId ??= url.searchParams.get("ftid");
    const place = url.pathname.match(/\/maps\/place\/([^/]+)/i)?.[1];
    name ??= cleanText(place ?? null);
    const coordinates = url.href.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),/);
    if (coordinates && latitude === null && longitude === null) {
      latitude = Number(coordinates[1]);
      longitude = Number(coordinates[2]);
    }
  }

  if (!name && query) {
    const addressPrefix = query.match(/^\d{3}[^A-Za-z]+?\d+(?:號|号)/)?.[0];
    name = cleanText(addressPrefix ? query.slice(addressPrefix.length) : query);
  }
  let address: string | null = null;
  if (query && name && query.endsWith(name)) address = cleanText(query.slice(0, -name.length));
  if (!address && query && /^\d{3}/.test(query)) {
    address = cleanText(query.match(/^\d{3}[^A-Za-z]+?\d+(?:號|号)/)?.[0] ?? null);
  }

  return { name, address, latitude, longitude, externalId };
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(request) });
  if (request.method !== "POST") return json(request, { error: "Method not allowed" }, 405);
  const origin = request.headers.get("origin") ?? "";
  if (origin && !allowedOrigins.has(origin)) return json(request, { error: "Origin not allowed" }, 403);

  const authorization = request.headers.get("Authorization");
  if (!authorization) return json(request, { error: "Authentication required" }, 401);
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    { global: { headers: { Authorization: authorization } } },
  );
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return json(request, { error: "Invalid session" }, 401);
  const { data: allowlisted, error: allowlistError } = await supabase.rpc("is_allowlisted");
  if (allowlistError || !allowlisted) return json(request, { error: "This beta is invite-only" }, 403);

  try {
    const { url } = await request.json() as { url?: string };
    if (!url || url.length > 1_200) return json(request, { error: "請貼上 Google 地圖分享網址" }, 400);
    const original = parseAllowedUrl(url.trim());
    const visited = [original];
    let current = original;

    for (let index = 0; index < 6; index += 1) {
      const response = await fetch(current, {
        method: "GET",
        redirect: "manual",
        headers: { "User-Agent": "Lueur/1.0 map-link-resolver" },
      });
      response.body?.cancel();
      if (response.status < 300 || response.status >= 400) break;
      const location = response.headers.get("location");
      if (!location) break;
      current = parseAllowedUrl(location, current);
      visited.push(current);
    }

    const details = detailsFromUrls([...visited].reverse());
    if (!details.name) return json(request, { error: "這個連結沒有可辨識的店名，仍可手動填寫" }, 422);
    return json(request, {
      ...details,
      originalUrl: original.href,
      finalUrl: current.href,
    });
  } catch (error) {
    return json(request, { error: error instanceof Error ? error.message : "無法解析這個連結" }, 400);
  }
});
