import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const allowedOrigin = Deno.env.get("APP_ORIGIN") ?? "";
const corsHeaders = {
  "Access-Control-Allow-Origin": allowedOrigin,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
  });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (allowedOrigin && request.headers.get("origin") !== allowedOrigin) return json({ error: "Origin not allowed" }, 403);

  const authorization = request.headers.get("Authorization");
  if (!authorization) return json({ error: "Authentication required" }, 401);
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    { global: { headers: { Authorization: authorization } } },
  );
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return json({ error: "Invalid session" }, 401);
  const { data: allowlisted, error: allowlistError } = await supabase.rpc("is_allowlisted");
  if (allowlistError || !allowlisted) return json({ error: "This beta is invite-only" }, 403);

  const { imageBase64, mimeType } = await request.json() as { imageBase64?: string; mimeType?: string };
  if (!imageBase64 || !mimeType?.startsWith("image/")) return json({ error: "A menu image is required" }, 400);
  if (imageBase64.length > 8_000_000) return json({ error: "Image is too large after compression" }, 413);

  const apiKey = Deno.env.get("GEMINI_API_KEY");
  const model = Deno.env.get("GEMINI_MODEL");
  if (!apiKey || !model) return json({ error: "OCR service is not configured" }, 503);

  const prompt = `你是餐桌菜單整理助手。讀取這張菜單、點餐截圖或消費明細，只提取這次可能點到的餐點。
請勿猜測看不清楚的內容。輸出 dish name、price、quantity、section、confidence；繁體中文原文優先，confidence 為 0 到 1。`;
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }, { inlineData: { mimeType, data: imageBase64 } }] }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: {
          type: "OBJECT",
          properties: {
            sourceType: { type: "STRING", enum: ["menu", "order_screenshot", "receipt", "unknown"] },
            dishes: {
              type: "ARRAY",
              items: {
                type: "OBJECT",
                properties: {
                  name: { type: "STRING" },
                  price: { type: "NUMBER", nullable: true },
                  quantity: { type: "INTEGER", nullable: true },
                  section: { type: "STRING", nullable: true },
                  confidence: { type: "NUMBER" },
                },
                required: ["name", "confidence"],
              },
            },
          },
          required: ["sourceType", "dishes"],
        },
      },
    }),
  });

  if (!response.ok) return json({ error: "Menu recognition failed", retryable: response.status >= 500 }, 502);
  const payload = await response.json();
  const text = payload?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) return json({ error: "No menu text was recognized" }, 422);

  try {
    return json({ result: JSON.parse(text), retainedImage: false });
  } catch {
    return json({ error: "Recognition returned an invalid structure" }, 502);
  }
});
