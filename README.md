# tupapers-assets

Content-addressed asset pipeline for the **TUpapers** notes CDN. Optimizes images, automatically applies watermark, hashes the optimized bytes, uploads them to a Cloudflare **R2** bucket (`tupapers`), and emits folder-structured `assets.json` manifests mirroring your exact source folder layout for scalable & effortless resource lookup.

Full design rationale lives in [`r2.md`](./r2.md) and [`docs/cdn.md`](./docs/cdn.md).

- **Serve from:** `https://cdn.tupapers.com`
- **Keys mirror the site:** `course/<program>/<semester>/<subject>/notes/<category>/<file>.<hash>.webp`
- **Folder Manifests:** `manifests/course/<program>/<semester>/<subject>/notes/<category>/assets.json`
- **Cache:** `public, max-age=31536000, immutable` (safe forever — the hash changes when bytes change)

---

## Requirements

- Node.js **20+**
- A Cloudflare R2 bucket named `tupapers` with `cdn.tupapers.com` connected (see `r2.md` §8)

## Setup

```bash
npm install
cp .env.example .env   # then fill in your R2 credentials
```

`.env` values:

| Var | Where to get it |
|---|---|
| `R2_ACCOUNT_ID` | R2 overview page (32-char hex) |
| `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | R2 → Manage API Tokens → Object Read & Write, scoped to `tupapers` |
| `R2_BUCKET` | `tupapers` |
| `R2_ENDPOINT` | `https://<ACCOUNT_ID>.r2.cloudflarestorage.com` (auto-derived if left as the placeholder) |
| `CDN_BASE` | `https://cdn.tupapers.com` |
| `TINIFY_API_KEY` | TinyPNG Developer API dashboard; keep this only in `.env` |

## Watermarking

By default, the pipeline automatically looks for `watermark.webp` in the root directory and overlays a subtle, scaled watermark image in the **bottom-right** corner of all raster images during processing (`.png`, `.jpg`, `.webp`, `.avif`, `.tiff`, `.gif`). SVG files are untouched.

- Adjust position: `--watermark-position bottom-right|bottom-left|top-right|top-left|center`
- Custom watermark file: `--watermark path/to/watermark.png`
- Disable watermarking: `--no-watermark`

## Workflow

1. Drop raw images into `source/`, mirroring the bucket taxonomy:

   ```
   source/course/bca/fifth-semester/computer-networking/notes/chapter-1/dda-vsbresenham-line.png
   ```

   To auto-scaffold all BCA folders:
   ```bash
   npm run scaffold:bca
   ```

2. Minify the generated subject folder with TinyPNG. Every chapter and nested folder is scanned recursively, while filenames and extensions stay unchanged:

   ```bash
   npm run tinify -- "source/course/bba/first-semester/english"
   ```

   The command processes all compatible images anywhere beneath the named subject folder. Each image is overwritten only after a successful API response. Unchanged files are skipped using a local checksum cache. Use `--all` only when you intentionally want to process every compatible image across the entire `source/` tree.

3. Run the CDN pipeline:

   ```bash
   npm run sync            # build + upload
   # or step by step:
   npm run build           # optimize → dist/, update folder assets.json manifests (offline, no creds needed)
   npm run upload          # upload dist/ → R2 (skips objects that already exist)
   ```

3. Folder-level manifests are created automatically:
   ```
   manifests/course/bca/fifth-semester/computer-networking/notes/chapter-1/assets.json
   ```
   Inside, it lists all asset CDN URLs, width, height, bytes, and keys for that chapter.

### Commands

| Command | What it does |
|---|---|
| `npm run build` | Optimize `source/` → `dist/`, auto-watermark, update folder `assets.json` manifests. No network. |
| `npm run upload` | Upload `dist/` objects to R2, skipping ones that already exist. |
| `npm run sync` | `build` then `upload`. |
| `npm run tinify -- <subject-folder>` | Recursively TinyPNG-compress every chapter and image under one subject; unchanged files are skipped. |
| `npm run minify:source -- <paths...>` | Longer alias that also accepts one or more files or folders. |
| `npm run scaffold:bca` | Create all BCA semester/subject folders under `source/course/bca/`. |
| `npm run prune` | List bucket objects no longer referenced by any folder manifest (dry-run). |
| `npm run typecheck` | `tsc --noEmit`. |
| `npm run lint` | ESLint over `src/`. |

### Useful flags

```bash
npm run build -- --mode photo                        # lossy WebP q78 (for photographs)
npm run tinify -- "source/course/bba/first-semester/english" # recursively minify a subject
npm run tinify -- --all --dry-run                     # preview a deliberate full-source pass
npm run build -- --max-width 1600                    # clamp very large images
npm run build -- --watermark-position bottom-left    # watermark position
npm run build -- --no-watermark                      # turn off watermarking
npm run sync  -- --publish-manifest                  # also upload folder assets.json manifests to bucket
npm run upload -- --dry-run -v                       # preview uploads
npm run prune -- --yes                               # actually delete orphans (default is dry-run)
```

## Eleventy integration

Copy the two files under [`eleventy/`](./eleventy) into your site:

- `eleventy/_data/cdn.js` → your site's `_src/_data/cdn.js`
- `eleventy/cdnImg.eleventy.cjs` → register it in `.eleventy.js`

Then in templates:

```njk
{% cdnImg "course/bca/fifth-semester/computer-networking/notes/chapter-1/dda-vsbresenham-line.webp",
          "DDA vs Bresenham Line", "rounded shadow" %}
```

## Project layout

```
src/
  index.ts      CLI (commander): build | upload | sync | prune
  config.ts     env loading + R2 client + constants
  discover.ts   walk source/ → image list
  optimize.ts   sharp (raster→webp + watermarking) / svgo (svg) → optimized bytes + dimensions
  hash.ts       sha256(bytes)[:8]
  keys.ts       source path → logical + hashed R2 keys
  upload.ts     HeadObject skip-check → PutObject w/ cache headers
  manifest.ts   read / write folder-structured assets.json manifests
  prune.ts      list & delete orphaned objects
source/         raw inputs (mirrors bucket taxonomy)
dist/           optimized outputs (gitignored)
manifests/      folder-structured assets.json manifests (commit these)
eleventy/       drop-in consumer files for the Eleventy site
watermark.webp  root watermark image (auto-applied on build)
```

## I used to manually generate images, minify it and name