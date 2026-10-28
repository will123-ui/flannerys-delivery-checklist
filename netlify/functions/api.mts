import { getStore } from "@netlify/blobs";
import type { Config, Context } from "@netlify/functions";

// One site-wide store. Keys:
//   config/pin                    -> { salt, hash, secret }      (staff PIN, hashed)
//   item/<date>/<taskId>          -> { by, at }                  (exists only while ticked)
//   photo/<date>/<taskId>/<uuid>  -> image bytes, metadata { by, at, type }
const store = () => getStore({ name: "checklist", consistency: "strong" });

const COOKIE = "dsc";
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TASK_RE = /^t\d{1,2}(-[a-z])?$/;
const PHOTO_KEY_RE = /^photo\/\d{4}-\d{2}-\d{2}\/t\d{1,2}(-[a-z])?\/[0-9a-f-]{36}$/;
const IMG_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const MAX_PHOTO = 4 * 1024 * 1024;

const enc = new TextEncoder();
const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
const randHex = (n: number) => hex(crypto.getRandomValues(new Uint8Array(n)).buffer);

async function hashPin(pin: string, salt: string) {
  const key = await crypto.subtle.importKey("raw", enc.encode(pin), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: enc.encode(salt), iterations: 150000 }, key, 256);
  return hex(bits);
}
async function hmac(secret: string, msg: string) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, enc.encode(msg)));
}
function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...headers } });
const err = (message: string, status = 400) => json({ error: message }, status);
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

type PinRecord = { salt: string; hash: string; secret: string };
async function getPin(): Promise<PinRecord | null> {
  return (await store().get("config/pin", { type: "json" })) as PinRecord | null;
}
async function sessionCookie(rec: PinRecord) {
  const token = await hmac(rec.secret, "staff");
  return `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=31536000`;
}
async function isAuthed(context: Context, rec: PinRecord | null) {
  if (!rec) return false;
  const c = context.cookies.get(COOKIE);
  if (!c) return false;
  return safeEqual(c, await hmac(rec.secret, "staff"));
}
function cleanName(v: unknown) {
  return typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, 40) : "";
}
function validPin(p: unknown): p is string {
  return typeof p === "string" && /^\d{4,8}$/.test(p);
}

export default async (req: Request, context: Context) => {
  const url = new URL(req.url);
  const route = url.pathname.replace(/^\/api\/?/, "");
  const method = req.method;
  const s = store();

  try {
    // ---------- Auth ----------
    if (route === "status" && method === "GET") {
      const rec = await getPin();
      return json({ pinSet: !!rec, authed: await isAuthed(context, rec) });
    }

    if (route === "setup" && method === "POST") {
      const { pin } = await req.json().catch(() => ({}));
      if (!validPin(pin)) return err("The PIN must be 4 to 8 digits.");
      if (await getPin()) return err("A PIN has already been set. Log in with it instead.", 409);
      const salt = randHex(16);
      const rec = { salt, hash: await hashPin(pin, salt), secret: randHex(32) };
      const { modified } = await s.setJSON("config/pin", rec, { onlyIfNew: true });
      if (!modified) return err("A PIN has already been set. Log in with it instead.", 409);
      return json({ ok: true }, 200, { "set-cookie": await sessionCookie(rec) });
    }

    if (route === "login" && method === "POST") {
      const { pin } = await req.json().catch(() => ({}));
      const rec = await getPin();
      if (!rec) return err("No PIN has been set up yet.", 409);
      if (typeof pin !== "string" || !safeEqual(await hashPin(pin, rec.salt), rec.hash)) {
        await sleep(1500); // slow down guessing
        return err("That PIN isn't right. Try again.", 401);
      }
      return json({ ok: true }, 200, { "set-cookie": await sessionCookie(rec) });
    }

    if (route === "logout" && method === "POST") {
      return json({ ok: true }, 200, { "set-cookie": `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0` });
    }

    // Everything below needs a logged-in staff member
    const rec = await getPin();
    if (!(await isAuthed(context, rec))) return err("Please log in with the staff PIN.", 401);

    if (route === "change-pin" && method === "POST") {
      const { current, next } = await req.json().catch(() => ({}));
      if (typeof current !== "string" || !safeEqual(await hashPin(current, rec!.salt), rec!.hash)) {
        await sleep(1500);
        return err("The current PIN isn't right.", 401);
      }
      if (!validPin(next)) return err("The new PIN must be 4 to 8 digits.");
      const salt = randHex(16);
      const newRec = { salt, hash: await hashPin(next, salt), secret: randHex(32) };
      await s.setJSON("config/pin", newRec);
      // New secret logs every other device out; keep this one logged in.
      return json({ ok: true }, 200, { "set-cookie": await sessionCookie(newRec) });
    }

    // ---------- Checklist ----------
    if (route === "shift" && method === "GET") {
      const date = url.searchParams.get("date") || "";
      if (!DATE_RE.test(date)) return err("Invalid date.");
      const [items, photos] = await Promise.all([
        s.list({ prefix: `item/${date}/` }),
        s.list({ prefix: `photo/${date}/` }),
      ]);
      const itemOut: Record<string, unknown> = {};
      await Promise.all(items.blobs.map(async b => {
        const id = b.key.split("/")[2];
        const v = await s.get(b.key, { type: "json" });
        if (v) itemOut[id] = v;
      }));
      const photoOut: Record<string, { key: string; by: string; at: string }[]> = {};
      await Promise.all(photos.blobs.map(async b => {
        const id = b.key.split("/")[2];
        const m = await s.getMetadata(b.key);
        const meta = (m?.metadata || {}) as { by?: string; at?: string };
        (photoOut[id] ||= []).push({ key: b.key, by: meta.by || "", at: meta.at || "" });
      }));
      Object.values(photoOut).forEach(list => list.sort((a, b) => a.at.localeCompare(b.at)));
      return json({ date, items: itemOut, photos: photoOut });
    }

    if (route === "item" && method === "PUT") {
      const body = await req.json().catch(() => ({}));
      const { date, id, done } = body;
      if (!DATE_RE.test(date) || !TASK_RE.test(id)) return err("Invalid task.");
      const key = `item/${date}/${id}`;
      if (done) {
        const v = { by: cleanName(body.by), at: new Date().toISOString() };
        await s.setJSON(key, v);
        return json({ ok: true, item: v });
      }
      await s.delete(key);
      return json({ ok: true, item: null });
    }

    if (route === "photo" && method === "POST") {
      const date = url.searchParams.get("date") || "";
      const id = url.searchParams.get("id") || "";
      if (!DATE_RE.test(date) || !TASK_RE.test(id)) return err("Invalid task.");
      const type = (req.headers.get("content-type") || "").split(";")[0].trim();
      if (!IMG_TYPES.has(type)) return err("That photo format isn't supported. Use a JPG or PNG.", 415);
      const buf = await req.arrayBuffer();
      if (!buf.byteLength) return err("The photo was empty.");
      if (buf.byteLength > MAX_PHOTO) return err("That photo is too big. Try a smaller one.", 413);
      const by = cleanName(url.searchParams.get("by"));
      const at = new Date().toISOString();
      const key = `photo/${date}/${id}/${crypto.randomUUID()}`;
      await s.set(key, buf, { metadata: { by, at, type } });
      // Adding a photo also ticks the task if it isn't ticked yet.
      const itemKey = `item/${date}/${id}`;
      await s.setJSON(itemKey, { by, at }, { onlyIfNew: true });
      return json({ ok: true, photo: { key, by, at } });
    }

    if (route === "photo" && method === "GET") {
      const key = url.searchParams.get("key") || "";
      if (!PHOTO_KEY_RE.test(key)) return err("Invalid photo.");
      const res = await s.getWithMetadata(key, { type: "arrayBuffer" });
      if (!res) return err("Photo not found.", 404);
      const type = (res.metadata as { type?: string })?.type || "image/jpeg";
      return new Response(res.data as ArrayBuffer, {
        headers: { "content-type": IMG_TYPES.has(type) ? type : "image/jpeg", "cache-control": "private, max-age=86400", "x-content-type-options": "nosniff" },
      });
    }

    if (route === "photo" && method === "DELETE") {
      const key = url.searchParams.get("key") || "";
      if (!PHOTO_KEY_RE.test(key)) return err("Invalid photo.");
      await s.delete(key);
      return json({ ok: true });
    }

    if (route === "history" && method === "GET") {
      const [items, photos] = await Promise.all([s.list({ prefix: "item/" }), s.list({ prefix: "photo/" })]);
      const days: Record<string, { date: string; done: number; photos: number }> = {};
      const day = (d: string) => (days[d] ||= { date: d, done: 0, photos: 0 });
      items.blobs.forEach(b => { const d = b.key.split("/")[1]; if (DATE_RE.test(d)) day(d).done++; });
      photos.blobs.forEach(b => { const d = b.key.split("/")[1]; if (DATE_RE.test(d)) day(d).photos++; });
      return json({ days: Object.values(days).sort((a, b) => b.date.localeCompare(a.date)) });
    }

    return err("Not found.", 404);
  } catch (e) {
    console.error(e);
    return err("Something went wrong on the server. Try again in a moment.", 500);
  }
};

export const config: Config = { path: "/api/*" };
