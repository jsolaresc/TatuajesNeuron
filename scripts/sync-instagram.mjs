// Sincroniza publicaciones e historias de Instagram para el sitio.
// Corre en GitHub Actions (Node 20+, sin dependencias).
//
// Variables de entorno:
//   IG_TOKEN    token de larga duración (Instagram API con inicio de sesión de Instagram)
//   OUT_DIR     carpeta de salida (por defecto .ig-cache). Se generan:
//                 OUT_DIR/data/instagram.json
//                 OUT_DIR/media/...  (fotos y videos descargados)
//   POSTS_LIMIT cuántas publicaciones mostrar (por defecto 24)
//   NEW_TOKEN_FILE  si se refresca el token, se escribe acá para que el workflow lo guarde
//
// Las URLs de Instagram vencen a los pocos días, por eso todo se descarga y se sirve
// desde el propio sitio. Si algo falla, se conserva la última versión buena.

import fs from "node:fs/promises";
import path from "node:path";

const TOKEN = process.env.IG_TOKEN;
const OUT = process.env.OUT_DIR || ".ig-cache";
const LIMIT = Number(process.env.POSTS_LIMIT || 24);
const API = process.env.IG_API_BASE || "https://graph.instagram.com";
const MAX_VIDEO_BYTES = 60 * 1024 * 1024;

const DATA_FILE = path.join(OUT, "data", "instagram.json");
const MEDIA_DIR = path.join(OUT, "media");
const STATE_FILE = path.join(OUT, "state.json");

// Instagram devuelve "2026-10-20T12:00:00+0000"; Safari no lo entiende, lo pasamos a ISO.
const iso = t => { const d = new Date(String(t).replace(/([+-]\d\d)(\d\d)$/, "$1:$2")); return isNaN(d) ? t : d.toISOString(); };

const log = (...a) => console.log("[ig]", ...a);

async function api(endpoint, params = {}) {
  const url = new URL(`${API}/${endpoint}`);
  for (const [k, v] of Object.entries({ ...params, access_token: TOKEN })) url.searchParams.set(k, v);
  const res = await fetch(url);
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.error) {
    const msg = body.error ? `${body.error.type || ""} ${body.error.code || ""}: ${body.error.message}` : res.status;
    throw new Error(`${endpoint} → ${msg}`);
  }
  return body;
}

async function readJSON(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, "utf8")); } catch { return fallback; }
}

async function exists(f) { try { await fs.access(f); return true; } catch { return false; } }

function extFor(type, contentType = "") {
  if (type === "VIDEO" || contentType.includes("video")) return ".mp4";
  if (contentType.includes("png")) return ".png";
  if (contentType.includes("webp")) return ".webp";
  return ".jpg";
}

// Descarga a media/<sub>/<id><ext>. Si ya existe, la reutiliza.
async function download(url, sub, id, type) {
  if (!url) return null;
  const dir = path.join(MEDIA_DIR, sub);
  await fs.mkdir(dir, { recursive: true });
  for (const ext of [".jpg", ".mp4", ".png", ".webp"]) {
    const f = path.join(dir, id + ext);
    if (await exists(f)) return { rel: `media/${sub}/${id}${ext}`, file: f };
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`descarga ${id}: HTTP ${res.status}`);
  const len = Number(res.headers.get("content-length") || 0);
  if (type === "VIDEO" && len > MAX_VIDEO_BYTES) { log(`video ${id} muy pesado (${len} bytes), se omite`); return null; }
  const buf = Buffer.from(await res.arrayBuffer());
  const ext = extFor(type, res.headers.get("content-type") || "");
  const f = path.join(dir, id + ext);
  await fs.writeFile(f, buf);
  return { rel: `media/${sub}/${id}${ext}`, file: f };
}

async function mediaItem(m, sub) {
  const isVideo = m.media_type === "VIDEO";
  const main = await download(m.media_url, sub, m.id, m.media_type).catch(e => (log(e.message), null));
  const poster = isVideo
    ? await download(m.thumbnail_url, sub, `${m.id}-poster`, "IMAGE").catch(e => (log(e.message), null))
    : null;
  if (!main && !poster) return null;
  // Si el video no se pudo bajar (p. ej. tiene música con derechos), mostramos la portada como foto.
  if (isVideo && !main) return { id: m.id, type: "IMAGE", src: poster.rel };
  return { id: m.id, type: m.media_type, src: main.rel, ...(poster ? { poster: poster.rel } : {}) };
}

async function maybeRefreshToken(state) {
  const DAY = 864e5;
  const last = state.tokenRefreshedAt ? Date.parse(state.tokenRefreshedAt) : 0;
  if (Date.now() - last < 7 * DAY) return;
  try {
    const r = await api("refresh_access_token", { grant_type: "ig_refresh_token" });
    state.tokenRefreshedAt = new Date().toISOString();
    log(`token renovado, vence en ${Math.round(r.expires_in / 86400)} días`);
    if (r.access_token && r.access_token !== TOKEN && process.env.NEW_TOKEN_FILE) {
      await fs.writeFile(process.env.NEW_TOKEN_FILE, r.access_token);
      log("el token cambió; el workflow va a actualizar el secreto IG_TOKEN");
    }
  } catch (e) {
    log("no se pudo renovar el token:", e.message);
  }
}

async function prune(keepRel) {
  for (const sub of ["posts", "stories"]) {
    const dir = path.join(MEDIA_DIR, sub);
    let files = [];
    try { files = await fs.readdir(dir); } catch { continue; }
    for (const f of files) {
      const rel = `media/${sub}/${f}`;
      if (!keepRel.has(rel)) await fs.rm(path.join(dir, f));
    }
  }
}

async function main() {
  await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
  const previous = await readJSON(DATA_FILE, null);
  const state = await readJSON(STATE_FILE, {});

  if (!TOKEN) {
    log("falta IG_TOKEN: el sitio va a mostrar la galería local.");
    if (!previous) await fs.writeFile(DATA_FILE, JSON.stringify({ updated: null, posts: [], stories: [] }));
    return;
  }

  await maybeRefreshToken(state);

  const me = await api("me", { fields: "user_id,username,name,profile_picture_url,followers_count,media_count" });
  const igId = me.user_id || me.id;
  log(`cuenta @${me.username}`);

  // Publicaciones
  const fields = "id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,children{id,media_type,media_url,thumbnail_url}";
  const media = await api(`${igId}/media`, { fields, limit: LIMIT });
  const posts = [];
  for (const m of media.data || []) {
    let item;
    let children;
    if (m.media_type === "CAROUSEL_ALBUM") {
      children = [];
      for (const c of m.children?.data || []) {
        const ci = await mediaItem(c, "posts");
        if (ci) children.push(ci);
      }
      if (!children.length) continue;
      item = { ...children[0], id: m.id, type: "CAROUSEL_ALBUM", children };
      if (children[0].type === "VIDEO") item.src = children[0].poster || children[0].src;
    } else {
      item = await mediaItem(m, "posts");
      if (!item) continue;
    }
    posts.push({ ...item, permalink: m.permalink, caption: m.caption || "", timestamp: iso(m.timestamp) });
  }

  // Historias (solo las activas, últimas 24 h)
  let stories = [];
  try {
    const s = await api(`${igId}/stories`, { fields: "id,media_type,media_url,thumbnail_url,permalink,timestamp" });
    for (const m of s.data || []) {
      const item = await mediaItem(m, "stories");
      if (item) stories.push({ ...item, permalink: m.permalink, timestamp: iso(m.timestamp) });
    }
  } catch (e) {
    log("no se pudieron leer las historias:", e.message);
    stories = (previous?.stories || []).filter(x => Date.now() - Date.parse(x.timestamp) < 864e5);
  }

  const keep = new Set();
  const collect = it => { keep.add(it.src); if (it.poster) keep.add(it.poster); (it.children || []).forEach(collect); };
  posts.forEach(collect);
  stories.forEach(collect);
  await prune(keep);

  const out = {
    updated: new Date().toISOString(),
    profile: { username: me.username, name: me.name || "", followers: me.followers_count, posts: me.media_count },
    posts,
    stories
  };
  await fs.writeFile(DATA_FILE, JSON.stringify(out, null, 1));
  await fs.writeFile(STATE_FILE, JSON.stringify(state));
  log(`${posts.length} publicaciones, ${stories.length} historias`);
}

main().catch(async e => {
  console.error("[ig] error:", e.message);
  console.error("[ig] se mantiene la última versión publicada.");
  if (!(await exists(DATA_FILE))) {
    await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
    await fs.writeFile(DATA_FILE, JSON.stringify({ updated: null, posts: [], stories: [] }));
  }
  // No cortamos el deploy: el sitio sigue funcionando con lo último que tenía.
  if (process.env.GITHUB_STEP_SUMMARY) {
    await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, `⚠️ Instagram: ${e.message}\n`);
  }
});
