const encoder = new TextEncoder();

export function json(data: unknown, status = 200, extra: HeadersInit = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extra }
  });
}
export function randomHex(bytes = 32): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return [...arr].map(x => x.toString(16).padStart(2, "0")).join("");
}
export async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, "0")).join("");
}
export async function passwordHash(password: string, salt: string): Promise<string> {
  // Workers Web Crypto rejects PBKDF2 iteration counts above 100,000, so this is the maximum usable.
  // Must match scripts/create-admin-pbkdf2.ts.
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: encoder.encode(salt), iterations: 100000, hash: "SHA-256" }, key, 256);
  return [...new Uint8Array(bits)].map(x => x.toString(16).padStart(2, "0")).join("");
}
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
export function getCookie(request: Request, name: string): string | null {
  const cookie = request.headers.get("Cookie") || "";
  for (const item of cookie.split(";")) {
    const [key, ...rest] = item.trim().split("=");
    if (key === name) return rest.join("=") || null;
  }
  return null;
}
export function sessionCookie(value: string, maxAge: number): string {
  return `pp_session=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}
export function clearSessionCookie(): string {
  return "pp_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0";
}
export function validSameOrigin(request: Request): boolean {
  const origin = request.headers.get("Origin");
  if (!origin) return true; // non-browser clients still require the session token
  try { return new URL(origin).host === new URL(request.url).host; } catch { return false; }
}
export function validateTargetUrl(input: unknown): string | null {
  if (typeof input !== "string" || input.length > 2048) return null;
  try {
    const url = new URL(input);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (url.username || url.password) return null;
    const host = url.hostname.toLowerCase();
    // Reject localhost, private/local names and literal IPs. This is defense-in-depth, not a substitute for egress controls.
    if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return null;
    if (/^(127\.|10\.|192\.168\.|169\.254\.|0\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host)) return null;
    if (host === "::1" || host.startsWith("[fc") || host.startsWith("[fd") || host.startsWith("[fe80")) return null;
    if (!host.includes(".") && host !== "localhost") return null;
    return url.toString();
  } catch { return null; }
}
export function intervalAllowed(value: unknown): value is 1 | 5 | 15 | 30 | 60 {
  return value === 1 || value === 5 || value === 15 || value === 30 || value === 60;
}
export function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : "Request failed";
  return message.slice(0, 240);
}
