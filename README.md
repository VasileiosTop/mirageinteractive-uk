# mirageinteractive.uk

Company website for Mirage Interactive Ltd. Two products: Mirage Atlas and Mirage Lumen.

## Stack

- **Astro 5** (static output)
- **Tailwind CSS 3**
- **Cloudflare Pages** (hosting)

All free-tier. No backend, no database.

## Local development

```bash
npm install
npm run dev          # http://localhost:4321
npm run build        # static output to ./dist
npm run preview      # serve ./dist locally
```

## Deploying to Cloudflare Pages

1. Push to GitHub.
2. Cloudflare dashboard → **Workers & Pages** → **Create** → **Pages** → **Connect to Git** → select this repo.
3. Settings:
   - **Framework preset**: Astro
   - **Build command**: `npm run build`
   - **Build output directory**: `dist`
   - **Node version**: 20
4. **Custom domains** → add `mirageinteractive.uk` and `www.mirageinteractive.uk`.

## When Companies House issues the number

Open `src/pages/index.astro`, find the `<dd class="font-mono" id="company-number">pending issuance</dd>` line in the footer, and replace `pending issuance` with the 8-digit number. Push. Cloudflare Pages rebuilds automatically.

Also update the JSON-LD block in `src/layouts/Layout.astro` if you want to expose the company number to search-engine knowledge panels (`identifier` property on Organization).
