# ZORO FINDS — One-of-One Vintage Catalogue

A curated vintage jacket catalogue built as a single-page static website. Browse one-of-one vintage pieces, view detailed slides, measurements, and condition notes, and purchase directly via WhatsApp or Instagram.

---

## Technology Stack

| Layer | Technology |
|---|---|
| Structure | HTML5 |
| Styling | Vanilla CSS (embedded in HTML) |
| Logic | Vanilla JavaScript (embedded in HTML) |
| Fonts | Google Fonts (Big Shoulders Display, Inter, IBM Plex Mono) |
| Hosting | GitHub Pages (or any static host) |
| Build tool | **None** — pure static site, no build step required |

---

## Project Structure

```
zoro-finds-clips/
├── index.html          # Entire application (HTML + CSS + JS in one file)
├── images/             # All product images
│   ├── zf001-1.jpg
│   ├── zf001-2.jpg
│   └── ... (200 images, zf001 → zf029)
├── .gitignore
└── README.md
```

---

## Quick Start

### Clone the repository

```bash
git clone https://github.com/YOUR_USERNAME/YOUR_REPO_NAME.git
cd YOUR_REPO_NAME
```

### Run locally

No install step needed. Just open `index.html` in any browser:

```bash
# Option 1 — Double-click index.html in your file explorer
# Option 2 — Use VS Code Live Server extension (recommended)
# Option 3 — Python quick server
python -m http.server 8080
# Then open http://localhost:8080
```

### Build for production

No build step required. The repository **is** the production site.

---

## Environment Variables

This project has **no environment variables or secrets**. All configuration is in the `CONFIG` object at the top of the `<script>` block inside `index.html`.

| Variable | Location | Description |
|---|---|---|
| `instagramUsername` | `index.html` → CONFIG | Your Instagram handle |
| `whatsappNumber` | `index.html` → CONFIG | Your WhatsApp number (with country code) |

> **Before publishing:** Update `whatsappNumber` in the CONFIG section of `index.html` with your real WhatsApp number.

---

## Catalogue Images

- All images are stored in the `images/` folder.
- Images use **relative paths** (`images/zfXXX-N.jpg`) and work on any host.
- Naming convention: `zfXXX-N.jpg` where `XXX` is the product ID (e.g. `001`) and `N` is the slide number.

---

## How to Add / Update / Remove Products

All product data lives in the `PRODUCTS` array inside `index.html`. Find `SECTION 2 — PRODUCTS` in the `<script>` block.

### Add a new product

1. Copy an existing product block from the `PRODUCTS` array.
2. Change the `id` to the next sequential ID (e.g. `ZF-030`).
3. Add your images to the `images/` folder as `zf030-1.jpg`, `zf030-2.jpg`, etc.
4. Update `name`, `price`, `size`, `measurements`, `condition`, `description`.
5. Set `status: "available"`.

### Mark a product as sold

Change `status: "available"` to `status: "sold"`. **Do not delete sold items.**

### Slide order convention

1. Full front flat lay (cover / hero)
2. Upper chest / collar / primary branding detail
3. Neck tag / authenticity tag / size tag
4. Hardware / zipper / pocket / hem detail
5. Inner lining / wash care label
6. Full back flat lay
7. Sleeve / cuff / patch / secondary details

---

## Deployment to GitHub Pages

1. Push the repository to GitHub.
2. Go to your repository → **Settings** → **Pages**.
3. Under **Source**, select the `main` branch and `/ (root)` folder.
4. Click **Save**.
5. Your site will be live at: `https://YOUR_USERNAME.github.io/YOUR_REPO_NAME/`

> GitHub Pages serves `index.html` from the root automatically.

---

## Push to GitHub (First Time)

If Git is not installed, download it from [https://git-scm.com](https://git-scm.com).

```bash
# 1. Initialize Git in the project folder
git init

# 2. Add all files
git add .

# 3. First commit
git commit -m "Initial commit: Zoro Finds vintage catalogue"

# 4. Add your GitHub remote (create the repo on GitHub first)
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO_NAME.git

# 5. Push
git branch -M main
git push -u origin main
```

---

## Security Notes

- No API keys, passwords, tokens, or secrets are stored in this repository.
- The WhatsApp number in `CONFIG.whatsappNumber` is intentionally left as a placeholder (`91XXXXXXXXXX`). Replace it with your real number before deploying.
- No backend, database, or server-side code exists in this project.

---

## Credits

Designed and maintained by **ZORO FINDS**.  
Curated vintage — never repeated.

---
