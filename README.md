# tupapers-assets

Asset pipeline for the **TUpapers** notes CDN. Build uses local Sharp processing to minify raster images to WebP and apply a small bottom-right watermark, then uploads them to Cloudflare **R2** and writes folder-structured `assets.json` manifests.

Full design rationale lives in [`r2.md`](./r2.md) and [`docs/cdn.md`](./docs/cdn.md).

- **Serve from:** `https://cdn.tupapers.com`
- **Keys mirror the site:** `course/<program>/<semester>/<subject>/notes/<category>/<file>.<ext>`
- **Folder Manifests:** `manifests/course/<program>/<semester>/<subject>/notes/<category>/assets.json`
- **Cache:** normal filenames use a 5-minute revalidating cache; preserved hashed files remain immutable

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

| Var                                         | Where to get it                                                                           |
| ------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `R2_ACCOUNT_ID`                             | R2 overview page (32-char hex)                                                            |
| `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | R2 → Manage API Tokens → Object Read & Write, scoped to `tupapers`                        |
| `R2_BUCKET`                                 | `tupapers`                                                                                |
| `R2_ENDPOINT`                               | `https://<ACCOUNT_ID>.r2.cloudflarestorage.com` (auto-derived if left as the placeholder) |
| `CDN_BASE`                                  | `https://cdn.tupapers.com`                                                                |

## Source filenames and migration

The build never creates a new content hash. Raster images are locally minified to WebP with Sharp (default quality: 82) and receive the existing `watermark.webp` at the bottom-right. SVG files remain unchanged.

Build keeps a local `.sharp-build-cache.json`. Unchanged images are skipped entirely, so Sharp runs only for new or changed source images (or when quality, maximum width, or watermark settings change).

The one-time migration command copies every manifest-referenced hashed file from `dist/` into the matching location under `source/` and verifies the bytes. It is safe to preview or rerun:

```bash
npm run migrate:hashed-source
npm run migrate:hashed-source -- --apply
```

Old raw files may remain beside their canonical hashed replacements; build automatically ignores those superseded copies. After reviewing the migration, they can be removed with `--apply --remove-originals`.

## Workflow

1. Drop raw images into `source/`, mirroring the bucket taxonomy:

   ```
   source/course/bca/fifth-semester/computer-networking/notes/chapter-1/dda-vsbresenham-line.png
   ```

   To auto-scaffold all BCA folders:

   ```bash
   npm run scaffold:bca
   ```

2. Run the CDN pipeline:

   ```bash
   npm run sync            # build + upload
   # or step by step:
   npm run build           # exact copy → dist/, update folder assets.json manifests
   npm run upload          # upload dist/ → R2; normal filenames are safely replaced
   ```

3. Folder-level manifests are created automatically:
   ```
   manifests/course/bca/fifth-semester/computer-networking/notes/chapter-1/assets.json
   ```
   Inside, it lists all asset CDN URLs, width, height, bytes, and keys for that chapter.

### Commands

| Command                         | What it does                                                                                        |
| ------------------------------- | --------------------------------------------------------------------------------------------------- |
| `npm run build`                 | Sharp-minify raster source files to WebP, apply the watermark, and update folder manifests.         |
| `npm run upload`                | Upload `dist/` objects to R2. Hashed objects are skipped when present; normal objects are replaced. |
| `npm run sync`                  | `build` then `upload`.                                                                              |
| `npm run migrate:hashed-source` | Preview the one-time `dist` hashed-file migration into `source`; add `--apply` to copy.             |
| `npm run scaffold:bca`          | Create all BCA semester/subject folders under `source/course/bca/`.                                 |
| `npm run prune`                 | List bucket objects no longer referenced by any folder manifest (dry-run).                          |
| `npm run typecheck`             | `tsc --noEmit`.                                                                                     |
| `npm run lint`                  | ESLint over `src/`.                                                                                 |

### Useful flags

```bash
npm run build -- --quality 78                         # smaller raster WebP output
npm run build -- --max-width 1600                     # clamp oversized raster images
npm run build -- --no-watermark                       # build without watermark
npm run build -- --force                              # reprocess every image deliberately
npm run migrate:hashed-source                        # verify migration status (preview)
npm run migrate:hashed-source -- --apply             # copy any missing canonical hashed files
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
  optimize.ts   Sharp WebP minification + watermarking
  keys.ts       source path → output key; recognize existing hashed filenames
  upload.ts     immutable-hash skip / normal-name replacement + correct cache headers
  manifest.ts   read / write folder-structured assets.json manifests
  prune.ts      list & delete orphaned objects
source/         canonical inputs: existing hash names + new normal names
dist/           build outputs (gitignored); old hashed files are not cleaned by build
manifests/      folder-structured assets.json manifests (commit these)
eleventy/       drop-in consumer files for the Eleventy site
```

## I used to manually generate images, minify it and name
