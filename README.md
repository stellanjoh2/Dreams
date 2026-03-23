# Candy Lands (Dreams)

Three.js / Vite game.

## GitHub Pages

The live site is **[stellanjoh2.github.io/Dreams](https://stellanjoh2.github.io/Dreams/)**.

### If you see a blank white page

GitHub Pages must publish the **built** site from the **`gh-pages`** branch (not `main`).  
`main` only has dev `index.html` (`/src/main.ts`), which does not run on Pages.

1. Open the repo on GitHub → **Settings** → **Pages**
2. Under **Build and deployment** → **Branch**, choose **`gh-pages`** and folder **`/ (root)`**
3. Save and wait ~1 minute, then hard-refresh the site

Pushes to **`main`** run [Deploy GitHub Pages](.github/workflows/deploy-gh-pages.yml), which rebuilds and updates **`gh-pages`** automatically.

### Local

```bash
npm install
npm run dev
```

```bash
npm run build
```
