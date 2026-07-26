# Resonance product page

This is the standalone browser-facing Resonance demo. It preserves the original
avatar, browser speech recognition, speech synthesis, transcript, and simulated
conversation experience independently from the desktop product UI in `../ui`.

## Development

```powershell
npm install
npm run dev
```

## Production build

```powershell
npm run check
```

The production output is written to `dist/index.html` as a self-contained page
that can be published through GitHub Pages. GitHub Pages deployment automation
is not configured yet.
