# TUpapers CDN — Complete Setup & Operation Guide

**Purpose:** Single source of truth for the R2 asset pipeline. Build minifies raster images locally with Sharp and applies a bottom-right watermark.

---

## Quick Reference

| Aspect                       | Value                                                                                                  |
| ---------------------------- | ------------------------------------------------------------------------------------------------------ |
| **Bucket**                   | `tupapers` (Cloudflare R2)                                                                             |
| **CDN base**                 | `https://cdn.tupapers.com`                                                                             |
| **Key pattern**              | New: `course/<program>/<semester>/<subject>/notes/<category>/<file>.ext`; existing hashes remain valid |
| **Source root**              | `source/` (mirrors bucket taxonomy exactly)                                                            |
| **Build output**             | `dist/` (gitignored)                                                                                   |
| **Manifest**                 | `manifest.json` (commit this, generated at build time)                                                 |
| **Pipeline**                 | TypeScript Node 20 CLI via `tsx` + `commander`                                                         |
| **Source minifier**          | Sharp during `npm run build`                                                                           |
| **Cache headers (assets)**   | Normal: `public, max-age=300, must-revalidate`; hashed legacy: immutable for one year                  |
| **Cache headers (manifest)** | `public, max-age=60, must-revalidate` (short, so updates propagate)                                    |

---

## Architecture Overview

The pipeline consists of two fully decoupled pieces:

### 1. Asset Pipeline (this repo)

- **Runs:** Once per asset batch (when you add/update images).
- **Input:** Raw images in `source/` (PNG, JPG, WebP, GIF, AVIF, TIFF, SVG).
- **Output:** Exact source bytes in `dist/` + folder manifests.
- **Upload target:** R2 bucket `tupapers`.
- **No web framework needed.** It's a CLI tool.

### 2. Consuming Site (Eleventy, separate repo)

- **Runs:** At build time.
- **Input:** `manifest.json` (committed or fetched).
- **Output:** Image tags with manifest-resolved CDN URLs pre-built into HTML.
- **No coupling:** Site doesn't care how pipeline works; pipeline doesn't care about site framework.

---

## Filename and compression strategy

The build does not calculate new hashes. Sharp converts raster inputs to WebP at quality 82 and applies the configured watermark locally, without API limits.

The local `.sharp-build-cache.json` skips unchanged source files. Only new or changed images, or images affected by changed build settings, are processed again.

Existing `name.<hash>.webp` files have been copied from `dist/` into the same paths under `source/`, making those deployed filenames canonical inputs. Their old logical manifest names remain aliases, so existing site references do not break. The build never cleans old `dist/` files.

The migration can be audited at any time with `npm run migrate:hashed-source`. Add `--apply` to copy missing canonical files. Superseded raw files are ignored by build and are only removed when `--remove-originals` is explicitly included.

---

## Folder Structure

```
tupapers_cdn/
├─ src/                          # TypeScript pipeline source
│  ├─ index.ts                   # CLI entry (build/upload/sync/prune commands)
│  ├─ config.ts                  # Load .env, R2 client, constants
│  ├─ discover.ts                # Walk source/ → list of image files
│  ├─ optimize.ts                # Read dimensions without changing image bytes
│  ├─ keys.ts                    # Build output keys and recognize existing hash names
│  ├─ upload.ts                  # PutObject upload with cache headers
│  ├─ manifest.ts                # Read/merge/write manifest.json (sorted keys)
│  └─ prune.ts                   # List/delete orphaned bucket objects (dry-run default)
│
├─ source/                        # Raw input images (mirrors bucket taxonomy)
│  └─ course/
│     ├─ bca/
│     │  ├─ first-semester/
│     │  │  ├─ computer-fundamental/notes/diagram/*.png
│     │  │  ├─ digital-logics/notes/diagram/*.png
│     │  │  └─ ...
│     │  ├─ second-semester/
│     │  └─ ...
│     ├─ bbm/
│     ├─ bbs/
│     ├─ bhm/
│     ├─ bit/
│     ├─ bitm/
│     ├─ bsw/
│     ├─ bttm/
│     └─ csit/
│
├─ dist/                          # Optimized outputs → upload to R2 (gitignored)
│  └─ course/
│     └─ bca/first-semester/.../file.hash.webp
│
├─ eleventy/                       # Drop-in files for Eleventy site
│  ├─ _data/cdn.js               # Copy to site's _src/_data/cdn.js
│  └─ cdnImg.eleventy.cjs        # Register shortcode in site's .eleventy.js
│
├─ docs/
│  └─ cdn.md                      # This file
│
├─ package.json                   # Dependencies + scripts
├─ tsconfig.json                  # TypeScript config
├─ .env.example                   # Template (copy → .env, never commit .env)
├─ .env                           # [LOCAL] R2 credentials (gitignored)
├─ .eslintrc.js                   # Linting rules
├─ .prettierrc.json               # Code formatting
├─ .gitignore                     # dist/, node_modules/, .env, *.log
├─ r2.md                          # Detailed design rationale (reference only)
├─ README.md                       # Quick start + command reference
└─ manifest.json                  # [GENERATED] Commit this to site repo
```

---

## Environment Setup

### Prerequisites

- Node.js **20.x LTS or newer**.
- Cloudflare R2 bucket `tupapers` with custom domain `cdn.tupapers.com` **already created and connected**.
- Scoped API token (Object Read & Write, bucket `tupapers` only).

### Configuration

**File:** `.env` (copy from `.env.example`, never commit).

```dotenv
# Cloudflare R2 Account ID (32-char hex from R2 overview page).
R2_ACCOUNT_ID=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# From "Manage R2 API Tokens" → Object Read & Write, scoped to tupapers bucket only.
R2_ACCESS_KEY_ID=xxxxxxxxxxxxxxxxxxxxxxxx
R2_SECRET_ACCESS_KEY=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# Bucket name.
R2_BUCKET=tupapers

# S3 endpoint. Leave as-is; auto-derived from R2_ACCOUNT_ID if this placeholder remains.
R2_ENDPOINT=https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com

# Public CDN base.
CDN_BASE=https://cdn.tupapers.com

# Optional: parallel workers for copy/upload (default 6).
# CONCURRENCY=6

```

**To obtain credentials:**

1. Cloudflare dashboard → R2 → _Manage API Tokens_.
2. _Create API Token_ → permissions **Object Read & Write**, scope **apply to specific buckets only** → select **tupapers**.
3. Copy **Access Key ID** and **Secret Access Key** immediately (shown only once).
4. Account ID is shown on the R2 overview page.

---

## CLI Commands

### `npm run build`

Sharp-minify `source/` raster images to WebP, apply the watermark, and update folder manifests. **No network or credentials needed.**

```bash
npm run build                    # Sharp WebP minification + bottom-right watermark
npm run build -- -v              # verbose (list every file)
```

- Raster images become optimized WebP files with the watermark applied.
- SVG files remain vector files and are copied unchanged.
- Output written to `dist/`.
- Folder `assets.json` files are updated with URLs and dimensions.

### `npm run upload`

Upload manifest-referenced `dist/` objects to R2. The bucket is scanned once and every existing object key is skipped, so only new asset keys are uploaded. **Requires credentials.**

```bash
npm run upload                     # upload, skip existing
npm run upload -- --dry-run        # show what would upload (no actual upload)
npm run upload -- --publish-manifest # also upload manifest.json to bucket root
npm run upload -- -v               # verbose (list every upload)
```

### `npm run sync`

`build` + `upload` in one shot. **Most common operation.**

```bash
npm run sync                            # build graphic mode, upload
npm run sync -- --mode photo            # build photo mode, upload
npm run sync -- --publish-manifest      # also upload manifest.json
npm run sync -- --dry-run -v            # preview (no actual uploads)
```

### `npm run prune`

List (or delete) bucket objects no longer referenced by the manifest. **Dry-run by default.**

```bash
npm run prune              # list orphaned objects
npm run prune -- --yes     # actually delete orphans
npm run prune -- --prefix course/bca/ # limit scan to a prefix
```

---

## Workflow: Adding Course Assets

**Example: BCA 1st Semester Computer Fundamentals diagrams.**

### Step 1: Create folder structure

```
source/course/bca/first-semester/computer-fundamental/notes/diagram/
```

### Step 2: Drop raw images (PNG, JPG, SVG)

```
source/course/bca/first-semester/computer-fundamental/notes/diagram/
├─ addressing-modes.png
├─ memory-layout.jpg
├─ cpu-cycle.svg
└─ cache-hierarchy.png
```

**File naming:**

- Use **kebab-case** (lowercase, hyphens for spaces).
- Use **descriptive names** (e.g., `addressing-modes`, not `fig1`).
- Extensions: `.png`, `.jpg`, `.svg`, `.webp`, `.gif`, `.avif`, `.tiff`.

### Step 3: Run the pipeline

```bash
npm run build
npm run sync
```

Output:

```
✓ build: 4 written, 0 existing hashed image(s) preserved → dist/ (...KB).
✓ upload: 4 uploaded, 0 skipped.
```

### Step 4: Commit to site repo

```bash
git add manifest.json
git commit -m "Add BCA 1st sem computer-fundamental diagrams"
```

### Step 5: Eleventy site uses it

In a template:

```njk
{% cdnImg "course/bca/first-semester/computer-fundamental/notes/diagram/addressing-modes.png",
          "Direct vs indirect addressing modes", "rounded shadow" %}
```

The template references the manifest key. For a new normal-name image, `cdn.js` resolves it to:

```
https://cdn.tupapers.com/course/bca/first-semester/computer-fundamental/notes/diagram/addressing-modes.png
```

---

## BCA Faculty Folder Setup

**Auto-scaffold all BCA subjects/semesters.** Create this folder structure:

```
source/course/bca/
├─ first-semester/
│  ├─ computer-fundamental/notes/diagram/
│  ├─ digital-logics/notes/diagram/
│  ├─ programming-in-c/notes/diagram/
│  ├─ fundamentals-of-it/notes/diagram/
│  ├─ communication-skills/notes/diagram/
│  └─ mathematics-i/notes/diagram/
├─ second-semester/
│  ├─ object-oriented-programming/notes/diagram/
│  ├─ web-technologies/notes/diagram/
│  ├─ database-management-systems/notes/diagram/
│  ├─ computer-networks/notes/diagram/
│  ├─ operating-systems/notes/diagram/
│  └─ mathematics-ii/notes/diagram/
├─ third-semester/
│  ├─ data-structures/notes/diagram/
│  ├─ algorithms/notes/diagram/
│  ├─ system-software/notes/diagram/
│  ├─ microprocessors/notes/diagram/
│  ├─ software-engineering/notes/diagram/
│  └─ discrete-mathematics/notes/diagram/
├─ fourth-semester/
│  ├─ advanced-algorithms/notes/diagram/
│  ├─ database-design/notes/diagram/
│  ├─ web-development/notes/diagram/
│  ├─ computer-graphics/notes/diagram/
│  ├─ artificial-intelligence/notes/diagram/
│  └─ formal-languages/notes/diagram/
├─ fifth-semester/
│  ├─ compiler-design/notes/diagram/
│  ├─ distributed-systems/notes/diagram/
│  ├─ machine-learning/notes/diagram/
│  ├─ network-security/notes/diagram/
│  ├─ mobile-development/notes/diagram/
│  └─ numerical-methods/notes/diagram/
├─ sixth-semester/
│  ├─ cloud-computing/notes/diagram/
│  ├─ data-mining/notes/diagram/
│  ├─ cryptography/notes/diagram/
│  ├─ information-retrieval/notes/diagram/
│  ├─ software-testing/notes/diagram/
│  └─ parallel-computing/notes/diagram/
├─ seventh-semester/
│  ├─ advanced-web-technologies/notes/diagram/
│  ├─ big-data/notes/diagram/
│  ├─ advanced-ai/notes/diagram/
│  ├─ blockchain/notes/diagram/
│  ├─ iot-systems/notes/diagram/
│  └─ advanced-databases/notes/diagram/
└─ eighth-semester/
   ├─ capstone-project/notes/diagram/
   ├─ emerging-technologies/notes/diagram/
   ├─ business-intelligence/notes/diagram/
   ├─ quantum-computing/notes/diagram/
   ├─ advanced-security/notes/diagram/
   └─ industry-practices/notes/diagram/
```

**To auto-generate these folders**, run:

```bash
# PowerShell on Windows
$semesters = @(1..8)
$subjects = @{
  1 = @("computer-fundamental", "digital-logics", "programming-in-c", "fundamentals-of-it", "communication-skills", "mathematics-i")
  2 = @("object-oriented-programming", "web-technologies", "database-management-systems", "computer-networks", "operating-systems", "mathematics-ii")
  # ... etc for all 8 semesters
}

foreach ($sem in $semesters) {
  foreach ($subj in $subjects[$sem]) {
    $path = "source/course/bca/semester-$sem/$subj/notes/diagram"
    mkdir -p $path -Force | Out-Null
  }
}
```

Or manually create via your IDE's file explorer (most efficient for one-time setup).

---

## Manifest Schema

**The manifest system is sharded.** One JSON file per `program/semester`. The flat `manifest.json` at the root is a backwards-compat mirror — never the primary source.

### Directory Layout

```
manifests/
├── index.json                          ← lists all shards + their filenames
├── course.bca.first-semester.json      ← all BCA 1st-sem assets
├── course.bca.second-semester.json
├── course.bca.third-semester.json
├── ...
├── course.csit.first-semester.json
└── course.csit.eighth-semester.json

manifest.json                           ← flat mirror of all shards (backwards compat)
```

**Shard naming:** `<prefix>.<program>.<semester>.json` — slashes become dots. Always a flat file, never nested directories.

### `manifests/index.json`

Tiny file. Only grows when a new program/semester is encountered for the first time.

```json
{
  "version": 1,
  "generatedAt": "2026-07-21T10:57:56.366Z",
  "cdnBase": "https://cdn.tupapers.com",
  "shards": {
    "course/bca/first-semester": "course.bca.first-semester.json",
    "course/bca/fifth-semester": "course.bca.fifth-semester.json",
    "course/csit/third-semester": "course.csit.third-semester.json"
  }
}
```

### `manifests/course.bca.fifth-semester.json`

One file per semester. Each asset entry contains the **pre-built full CDN URL** — no assembly needed at query time.

```json
{
  "version": 1,
  "generatedAt": "2026-07-21T10:57:56.363Z",
  "cdnBase": "https://cdn.tupapers.com",
  "shard": "course/bca/fifth-semester",
  "assets": {
    "course/bca/fifth-semester/computer-networking/notes/diagram/mp-8085.webp": {
      "key": "course/bca/fifth-semester/computer-networking/notes/diagram/mp-8085.2a8f8426.webp",
      "url": "https://cdn.tupapers.com/course/bca/fifth-semester/computer-networking/notes/diagram/mp-8085.2a8f8426.webp",
      "contentType": "image/webp",
      "width": 1536,
      "height": 1024,
      "bytes": 1149618
    }
  }
}
```

**Key fields:**

- **Logical key** (the dict key): stable `course/<program>/<semester>/<subject>/notes/<category>/<filename>.ext` — never changes.
- **`key`**: actual R2 object key with content hash. Changes when image bytes change.
- **`url`**: full pre-built CDN URL. Use this directly in `<img src>`. Changes when `key` changes.
- **`width`**, **`height`**: stored at build time — use as HTML `width`/`height` attributes to eliminate layout shift.
- **`bytes`**: copied file size.

### Why sharding, not a flat file

| Problem                  | Flat manifest.json                | Sharded manifests/                       |
| ------------------------ | --------------------------------- | ---------------------------------------- |
| Git diff readability     | Every sync = one giant diff       | Diff scoped to one semester              |
| Site startup time        | Parse entire file for every build | Load only the shard(s) needed            |
| Scale                    | Degrades linearly                 | Bounded: each shard ≤ ~50 entries        |
| Finding a specific asset | Search entire file                | Open `course.<prog>.<sem>.json` directly |
| Adding a new program     | Adds entries to one file          | Creates one new shard file               |

### How the Eleventy consumer uses shards

`cdn.resolve("course/bca/first-semester/computer-fundamental/notes/diagram/addressing-modes.webp")`

1. Derives shard id: `"course/bca/first-semester"`.
2. Loads `manifests/course.bca.first-semester.json` (lazy, cached in memory).
3. Looks up the logical key in `assets`.
4. Returns `entry.url` — already the full CDN URL.

No R2 calls, no hash assembly, no CDN base string concatenation at runtime.

---

## Eleventy Integration

### 1. Copy files from `eleventy/` into your site

```
your-site/
├─ _src/_data/
│  └─ cdn.js              # From eleventy/_data/cdn.js
├─ .eleventy.js           # Register the shortcode (see below)
└─ manifest.json          # Commit the generated manifest
```

### 2. Register the shortcode in `.eleventy.js`

```javascript
const registerCdnImg = require("./eleventy/cdnImg.eleventy.cjs");

module.exports = function (eleventyConfig) {
  registerCdnImg(eleventyConfig);

  // ... rest of your config
};
```

### 3. Use in templates

```njk
{% cdnImg "course/bca/first-semester/computer-fundamental/notes/diagram/addressing-modes.webp",
          "Direct vs indirect addressing modes", "rounded shadow" %}
```

**Output:**

```html
<img
  src="https://cdn.tupapers.com/course/bca/first-semester/computer-fundamental/notes/diagram/addressing-modes.7e8d3c41.webp"
  alt="Direct vs indirect addressing modes"
  class="rounded shadow"
  width="1200"
  height="640"
  loading="lazy"
  decoding="async"
/>
```

---

## Cloudflare R2 Configuration

### One-time Setup (already done; verify)

1. **Bucket created:** `tupapers`
2. **Custom domain connected:** `cdn.tupapers.com` → Cloudflare auto-creates DNS CNAME + TLS cert.
3. **API token created:** Object Read & Write, scoped to `tupapers` bucket only.

### Cache Rules (optional, belt-and-suspenders)

Set a Cloudflare Cache Rule for `cdn.tupapers.com`:

- **Match:** Hostname equals `cdn.tupapers.com`
- **Action:** **Eligible for cache**, Edge TTL **1 year**.
- Rationale: Pipeline already sets `Cache-Control: public, max-age=31536000, immutable` per object; this reinforces it at the CDN edge.

### CORS (only if needed)

CORS is **not needed** for plain `<img>` tags. Enable it only if you later use `<canvas>`, WebGL, or JS `fetch()` on images:

Bucket → Settings → CORS Policy:

```json
[
  {
    "allowedOrigins": ["https://tupapers.com", "https://www.tupapers.com"],
    "allowedMethods": ["GET"],
    "allowedHeaders": []
  }
]
```

---

## Optimization Details

### Image Mode Selection

| Mode                | Quality       | Best for                          | Output                               |
| ------------------- | ------------- | --------------------------------- | ------------------------------------ |
| `graphic` (default) | Near-lossless | Diagrams, figures, UI screenshots | `.webp` (sharp quality 90)           |
| `photo`             | Lossy q78     | Photographs, rendered scenes      | `.webp` (sharp quality 78, effort 5) |

### Processing Pipeline

1. **Raster images** (PNG, JPG, WebP, GIF, AVIF, TIFF):
   - Auto-orient via EXIF.
   - Strip metadata.
   - Clamp max-width (optional).
   - Convert → WebP.

2. **SVG:**
   - Optimize with `svgo` (multipass).
   - **Never rasterized.**
   - Kept as `.svg`.

3. **Output:** `<filename>.<hash>.<ext>`

### Size Reduction Example

```
Input:   addressing-modes.png (215 KB)
↓ sharp graphic mode
Output:  addressing-modes.7e8d3c41.webp (41 KB) — 81% smaller
↓ upload
Cached:  public, max-age=31536000, immutable
```

---

## Troubleshooting

### Build fails: "source/ is empty"

**Fix:** Ensure your course folders and images exist under `source/course/<program>/<semester>/...`.

### Upload fails: "Missing or placeholder env var"

**Fix:** Copy `.env.example` → `.env` and fill in real R2 credentials.

### Upload skips everything: "object already exists"

**Normal behavior.** Existing R2 object keys are skipped. To replace an asset at the same key, delete that object from R2 first and then run upload again.

### Manifest.json not updating

**Fix:** Run `npm run build` first (no credentials needed). If that fails, check Node version (`node --version` ≥ 20.x).

### Eleventy template can't resolve image

**Fix:** Ensure the logical path in `{% cdnImg %}` matches exactly an entry in `manifest.json`. Use an editor search to verify.

---

## Git Workflow

### Asset Pipeline Repo

```bash
# Local
npm run sync
git add manifest.json
git commit -m "Add BCA 1st sem diagrams"
git push

# CI (optional GitHub Actions in asset repo)
# On push to main, auto-run npm run sync, commit manifest.json
```

### Eleventy Site Repo

```bash
# Pull in the updated manifest
git pull

# Site rebuilds against it
npm run build

# Deploy
git push
```

---

## Maintenance

### Monthly: Check orphans

```bash
npm run prune
```

If orphans exist, review them (from old image updates). Delete after confirming no active links:

```bash
npm run prune -- --yes
```

### Quarterly: Review cache stats

- Cloudflare dashboard → Analytics → `cdn.tupapers.com`.
- Monitor cache hit ratio (target: >95%).
- If HIT rate is low, verify cache rules are active.

### Yearly: Archive old manifest

Keep a backup of `manifest.json` in version control (Git already does this), but no special action needed. Assets are immutable and live forever.

---

## Agent Instructions (When Tagging This File)

When you tag `#cdn.md` in a prompt, the agent can:

1. **Replicate the entire setup** from scratch (folders, Node modules, configs).
2. **Populate BCA faculty folders** with the standard semester/subject structure.
3. **Answer how the pipeline works** (hashing, manifest, upload strategy).
4. **Troubleshoot issues** (missing envs, build failures, upload errors).
5. **Integrate the CDN** into a new Eleventy site (copy `eleventy/` files, register shortcode).

**Example prompts:**

- "Set up the BCA folder structure for all 8 semesters in source/"
- "Help me debug why upload is failing"
- "Integrate the CDN into my Eleventy site"
- "Explain how existing hashed source filenames and new normal filenames coexist"
- "Update manifest.json and push to R2"

---

## Summary

| Step         | Command                             | Time      | Credentials?      |
| ------------ | ----------------------------------- | --------- | ----------------- |
| **Setup**    | `npm install; cp .env.example .env` | 2 min     | Yes (fill `.env`) |
| **Build**    | `npm run build`                     | 10–30 sec | No                |
| **Upload**   | `npm run upload`                    | 5–30 sec  | Yes               |
| **Combined** | `npm run sync`                      | 20–60 sec | Yes               |
| **Maintain** | `npm run prune`                     | 5 sec     | Yes               |

**Typical workflow:** Drop 5–10 images in `source/` → `npm run sync` (45 sec) → commit `manifest.json` → site rebuilds.
