import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be configured.");
}

export const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false }
});

export function corsHeaders(request: Request): Headers | null {
  const origin = request.headers.get("origin");
  const allowedOrigins = (Deno.env.get("APP_ORIGINS") || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  if (origin && !allowedOrigins.some((allowed) => {
    if (allowed === origin) return true;
    if (allowed === "https://*.vercel.app") return /^https:\/\/[a-z0-9-]+\.vercel\.app$/i.test(origin);
    if (allowed === "https://*.netlify.app") return /^https:\/\/[a-z0-9-]+\.netlify\.app$/i.test(origin);
    return false;
  })) return null;

  const headers = new Headers({
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin"
  });
  if (origin) headers.set("Access-Control-Allow-Origin", origin);
  return headers;
}

export function jsonResponse(
  body: Record<string, unknown>,
  status: number,
  cors: Headers
): Response {
  const headers = new Headers(cors);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  return new Response(JSON.stringify(body), { status, headers });
}

export function getBearerToken(request: Request): string | null {
  const authorization = request.headers.get("authorization") || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1] || null;
}

export async function getAuthenticatedUser(request: Request) {
  const token = getBearerToken(request);
  if (!token) return { user: null, error: "Sign-in is required." };
  const { data, error } = await serviceClient.auth.getUser(token);
  return { user: data.user, error: error?.message || null };
}

async function digest(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const hashed = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hashed)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function rateLimitSubject(request: Request, userId?: string): Promise<string> {
  if (userId) return `user:${userId}`;
  const ip = request.headers.get("cf-connecting-ip")
    || request.headers.get("x-real-ip")
    || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || "unknown";
  return `ip:${await digest(ip)}`;
}

export async function consumeRateLimit(
  subject: string,
  action: string,
  maximum: number,
  seconds: number
): Promise<boolean> {
  const { data, error } = await serviceClient.rpc("consume_edge_rate_limit", {
    p_subject: subject,
    p_action: action,
    p_max_requests: maximum,
    p_window_seconds: seconds
  });
  if (error) throw new Error(`Rate-limit check failed: ${error.message}`);
  return data === true;
}

export async function readJson(request: Request, maximumBytes = 65536): Promise<Record<string, unknown>> {
  const length = Number(request.headers.get("content-length") || 0);
  if (length > maximumBytes) throw new Error("Request body is too large.");
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maximumBytes) throw new Error("Request body is too large.");
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Request body must be a JSON object.");
  }
  return parsed as Record<string, unknown>;
}

export function isOptions(request: Request): boolean {
  return request.method === "OPTIONS";
}
