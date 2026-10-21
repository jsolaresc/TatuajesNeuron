# Tatuajes Neurón — sitio web

Sitio estático para GitHub Pages. No necesita hosting pago: solo el dominio.

- `index.html`, `assets/` — el sitio.
- `assets/js/config.js` — WhatsApp, mensaje predeterminado, usuario de Instagram y ubicación del mapa. **Para cambiar la dirección, editá `mapsQuery` acá.**
- `scripts/sync-instagram.mjs` — baja publicaciones e historias de Instagram.
- `.github/workflows/deploy.yml` — cada 30 minutos sincroniza Instagram y publica el sitio.

## Cómo se mantiene al día con Instagram

GitHub Pages solo sirve archivos estáticos, así que un workflow de GitHub Actions corre cada 30 minutos:

1. Consulta la API oficial de Instagram (últimas 24 publicaciones + historias activas).
2. Descarga fotos y videos (las URLs de Instagram vencen en pocos días) y genera `data/instagram.json`.
3. Publica el sitio en Pages. Nada de esto se commitea: el repo queda limpio.

Una historia nueva aparece en la web en un máximo de ~30 minutos y desaparece sola a las 24 h. Si la API falla, se mantiene la última versión buena. Mientras no haya token, la web muestra la galería local de `assets/img/trabajos/`.

> Las **historias destacadas** no están disponibles en la API de Instagram, solo las historias activas.

## Configuración (una sola vez)

### 1. Cuenta de Instagram profesional
En la app de Instagram: Configuración → Tipo de cuenta → cambiar a **cuenta profesional** (Empresa o Creador). Es gratis.

### 2. App de Meta y token
1. Entrá a <https://developers.facebook.com/apps> y creá una app (tipo *Business* / caso de uso *Instagram*).
2. Agregá el producto **Instagram** → *API setup with Instagram login*.
3. En *Generate access tokens*, agregá la cuenta `@tatuajesneuron` e iniciá sesión con ella. Copiá el token (dura 60 días; el workflow lo renueva solo cada semana).
   Permiso necesario: `instagram_business_basic`.
4. La app puede quedar en modo desarrollo: solo lee la cuenta propia.

### 3. Secretos del repo
En GitHub: **Settings → Secrets and variables → Actions → New repository secret**

| Nombre | Valor |
|---|---|
| `IG_TOKEN` | el token del paso anterior |
| `GH_PAT` | *(recomendado)* un [token fine-grained](https://github.com/settings/personal-access-tokens/new) con acceso solo a este repo y permiso **Secrets: Read and write**. Sirve para guardar el token de Instagram si Meta devuelve uno nuevo al renovarlo. |

### 4. Activar Pages
**Settings → Pages → Build and deployment → Source: GitHub Actions.**
Después, en la pestaña **Actions**, corré "Publicar sitio (con Instagram)" a mano una vez (*Run workflow*).

### 5. Dominio propio
1. **Settings → Pages → Custom domain**: escribí el dominio (ej. `tatuajesneuron.com.ar`) y guardá.
2. En el proveedor del dominio (NIC Argentina delega a donde tengas el DNS) cargá:
   - `A` → `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153` (para el dominio raíz)
   - `CNAME` `www` → `jsolaresc.github.io`
3. Cuando el DNS propague, tildá **Enforce HTTPS**.

## Mantenimiento

- GitHub pausa los workflows programados de repos públicos tras 60 días sin actividad; el workflow se reactiva solo una vez por día. Si igual se pausara, en **Actions** aparece un botón para reactivarlo.
- Si el token vence (por ejemplo, si se cambió la contraseña de Instagram), generá uno nuevo (paso 2) y reemplazá `IG_TOKEN`.
- Los errores de sincronización se ven en el resumen de cada ejecución en **Actions**.

## Probar localmente

```bash
python3 -m http.server 8000
# abrir http://localhost:8000
```
Para probar la sincronización: `IG_TOKEN=... OUT_DIR=. node scripts/sync-instagram.mjs` (genera `data/` y `media/` en la raíz; no los commitees).
