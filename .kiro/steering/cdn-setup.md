---
inclusion: manual
---

# TUpapers CDN Setup Guide

This is a steering file for Kiro agents. Tag this file when onboarding agents to replicate the asset pipeline setup or populate course folders.

## Quick Context

- **R2 bucket:** `tupapers` (already created, connected to `cdn.tupapers.com`).
- **Pipeline:** TypeScript Node 20 CLI (`sharp` + `svgo` + `@aws-sdk/client-s3`).
- **Purpose:** Optimize course images → content-hash → upload to R2 → emit `manifest.json` for Eleventy site to consume.
- **Key concept:** Filenames include content hash (`addressing-modes.7e8d3c41.webp`), folders are stable + human-readable.

## For Agents: Complete Reference

Full design and operation details live in `#[[file:docs/cdn.md]]`.

### What This Pipeline Does

1. **Input:** Raw images (PNG, JPG, SVG) dropped into `source/course/<program>/<semester>/<subject>/notes/<category>/`.
2. **Process:** Optimize (WebP for raster, svgo for SVG) → hash optimized bytes (SHA-256[:8]) → rename with hash.
3. **Output:** Optimized files in `dist/` + `manifest.json` (logical → hashed key mappings).
4. **Upload:** Ship to R2 bucket `tupapers` with immutable cache headers.

### Common Agent Tasks

#### Task 1: Set up from scratch
- `npm install` → install dependencies.
- `cp .env.example .env` → fill in R2 credentials.
- `npm run build` → test offline (no credentials needed).

#### Task 2: Scaffold BCA folder structure
```bash
npm run scaffold:bca
```
Creates 48 folders (6 subjects × 8 semesters) ready for images.

#### Task 3: Build + optimize images
```bash
npm run build -- --mode graphic -v
```
Reads `source/`, optimizes to `dist/`, updates `manifest.json`.

#### Task 4: Upload to R2
```bash
npm run sync  # build + upload in one shot
```

#### Task 5: Integrate into Eleventy site
- Copy `eleventy/_data/cdn.js` → site's `_src/_data/cdn.js`.
- Copy `eleventy/cdnImg.eleventy.cjs` → register shortcode in site's `.eleventy.js`.
- Commit `manifest.json` into site repo.
- Use `{% cdnImg "course/bca/first-semester/..." %}` in templates.

### Key Files

| File | Purpose |
|------|---------|
| `src/index.ts` | CLI entry (build/upload/sync/prune) |
| `src/config.ts` | R2 client + env loading |
| `src/optimize.ts` | Image optimization (sharp + svgo) |
| `src/hash.ts` | Content hashing |
| `src/keys.ts` | Logical + hashed key generation |
| `src/manifest.ts` | Read/write manifest.json |
| `src/upload.ts` | R2 upload logic |
| `scripts/scaffold-bca.ts` | BCA folder scaffolding |
| `manifest.json` | Generated (commit to site repo) |
| `.env` | R2 credentials (do not commit) |

### Environment Variables

`.env` (copy from `.env.example`, never commit):
```dotenv
R2_ACCOUNT_ID=<32-char hex from R2 overview>
R2_ACCESS_KEY_ID=<from API token>
R2_SECRET_ACCESS_KEY=<from API token>
R2_BUCKET=tupapers
R2_ENDPOINT=https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com
CDN_BASE=https://cdn.tupapers.com
```

### Typical Workflow

1. Drop 5–10 images into `source/course/bca/first-semester/computer-fundamental/notes/diagram/`.
2. Run `npm run sync`.
3. Commit updated `manifest.json`.
4. Eleventy site rebuilds against it.

### Troubleshooting

- **"source/ is empty"** → Ensure folders exist or run `npm run scaffold:bca` first.
- **"Missing env var"** → Fill in `.env` with real R2 credentials.
- **"object already exists"** → Normal (content-addressed). Delete from R2 if you need to re-upload.
- **Build hangs** → Check Node version (`node --version` ≥ 20.x).

---

**Full reference:** `#[[file:docs/cdn.md]]`
