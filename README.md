# Cloud Flight

Presentation page for **Cloud Flight**, the realtime cloud generator in VIOSO Exaplay 3:
the live shader running in the browser (WebGL), how it works, and how it can be used
in cabins and presentations. Prepared for AIRBUS (Michael Lüdtke). German and English.

## Files

- `index.html` – the finished page, self-contained (shader, ground image and logo inlined). Open it in a browser or serve it with GitHub Pages.
- `src/template.html` – page layout, styles, text and controls.
- `src/cloud-flight.frag` – the GLSL fragment shader, exported unchanged from Exaplay's generator library (`exaplay_frontend/src/utils/realtimeSources.js`, id `cloud-flight`).
- `src/landsat_farmland_poland.jpg` – ground image, Landsat 9 (NASA Earth Observatory / USGS, public domain, see `src/LICENSE-landsat.txt`).
- `src/vioso-logo.png` – VIOSO logo.
- `build.py` – rebuilds `index.html` from `src/` (`python3 build.py`).

## Password

The page asks for a password before it shows anything. The check runs entirely in the
browser (SHA-256 compare), so it is only a curtain: anyone who can read this repository
or the page source can get past it. It is not access control.

## Deploy with Coolify

The repository carries a `Dockerfile` (nginx, port 80), so Coolify can deploy it directly:

1. In Coolify: **+ New → Resource → Public Repository** (or a private one via the GitHub App) and enter `https://github.com/fritscherman/cloudrender`, branch `main`.
2. **Build Pack:** `Dockerfile`. **Ports Exposes:** `80`.
3. Under **Domains**, enter the domain, e.g. `https://cloudflight.example.com`. Coolify issues the TLS certificate itself. HTTPS is required: the page's password check uses the browser's crypto API, which only exists on secure origins.
4. Optional, for a real server-side password: under **Environment Variables** set `BASIC_AUTH_USER` and `BASIC_AUTH_PASSWORD` (runtime, not build-time). nginx then asks for them before serving anything; `/healthz` stays open for the health check.
5. **Deploy.** Health check path: `/healthz`.

After a change to `src/`, run `python3 build.py`, commit `index.html` and push; with Coolify's auto-deploy webhook the new version goes live on its own.

Local test:

```bash
docker build -t cloudflight .
docker run --rm -p 8080:80 -e BASIC_AUTH_USER=airbus -e BASIC_AUTH_PASSWORD=secret cloudflight
# http://localhost:8080
```
