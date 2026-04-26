# 🐴 Lili — Count, Share, Smile

A gentle counting and sharing game for ages 3-5. Lili the pony picks fruits with her friends and learns simple addition along the way.

**Features:** 6 hand-crafted levels (5 addition + 1 subtraction) · Bilingual read-aloud (English / Spanish) · Personalization (your child's name spoken aloud) · 3-star rating per level · Lifetime fruits collected · Color salon · Send-to-Grandma postcard · Ambient music · Parent dashboard · App Store-ready

---

## Quick start

```bash
npm install
npm run dev
```

Open http://localhost:5173 in your browser.

### Available scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start the dev server with hot reload |
| `npm run build` | Build production assets to `dist/` |
| `npm run preview` | Serve the built `dist/` locally to test |

---

## Project structure

```
.
├── index.html              ← Entry HTML (fonts, viewport, theme color)
├── package.json
├── vite.config.js
├── vercel.json             ← Vercel: SPA rewrite + cache headers
├── public/
│   └── favicon.svg         ← App icon (1024×1024 SVG)
└── src/
    ├── main.jsx            ← React entry
    └── App.jsx             ← The full game (single file, ~2,870 lines)
```

The game is a single React component (`LiliGame`, default export from `App.jsx`). All assets — characters, scenery, sounds, animations — are inline SVG and Tone.js. **No images needed.** Sound effects are synthesized at runtime; speech uses the browser's built-in Web Speech API.

---

## Deploy to Vercel

### Option 1: One-click via GitHub

1. Push this folder to a new GitHub repo:
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin git@github.com:YOUR_USERNAME/lili-game.git
   git push -u origin main
   ```

2. Go to [vercel.com/new](https://vercel.com/new) → Import the repo.

3. Vercel will auto-detect Vite. Click **Deploy**. That's it.

The `vercel.json` in this repo handles SPA routing (so refreshing on any URL works) and sets immutable cache headers on hashed assets.

### Option 2: Deploy from the command line

```bash
npm install -g vercel
vercel login
vercel        # preview deploy
vercel --prod # production deploy
```

---

## Deploy to GitHub Pages (alternative)

If you'd rather use GitHub Pages instead of Vercel:

1. In `vite.config.js`, add a `base` matching your repo name:
   ```js
   export default defineConfig({
     plugins: [react()],
     base: '/lili-game/',  // ← your repo name
   });
   ```

2. Install `gh-pages`:
   ```bash
   npm install --save-dev gh-pages
   ```

3. Add to `package.json` scripts:
   ```json
   "deploy": "npm run build && gh-pages -d dist"
   ```

4. Run `npm run deploy`. Then enable GitHub Pages on the `gh-pages` branch in repo settings.

---

## Native iOS / Android (Capacitor)

This repo is web-only. To wrap it as a native app for the App Store / Play Store, see the deployment guide in the launch kit doc.

Summary:
```bash
npm install @capacitor/core @capacitor/cli @capacitor/ios @capacitor/android
npx cap init Lili com.yourname.lili --web-dir=dist
npm run build && npx cap sync
npx cap add ios && npx cap open ios
```

---

## Privacy & data

The game stores nothing on any server. All progress (stars, fruits collected, child's name, language preference, Lili's color) is saved in `localStorage` on the device only. The game works fully offline once loaded.

---

## License

Built with love for a real four-year-old. Ship it, fork it, learn from it. ❤️
