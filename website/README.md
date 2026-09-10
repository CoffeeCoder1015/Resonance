# Resonance product page

This is the standalone browser-facing Resonance demo. It embeds the desktop
product's transcription pill and theme system, with browser speech recognition,
visible transcription history, and a simulated fallback when recognition is
unavailable.

## Development

```powershell
npm install
npm run dev
```

## Production build

```powershell
npm run check
```

The production output is written to `dist/index.html` as a self-contained page.
On every push to `main`, the repository's GitHub Pages workflow builds and
publishes that output. The generated `dist/` directory remains untracked;
GitHub Actions supplies it directly to Pages.
