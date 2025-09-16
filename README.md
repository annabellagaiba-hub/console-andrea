# Console lavoro quotidiano

React + TypeScript + Vite. Deploy gratis su GitHub Pages.

## Sviluppo
```bash
npm i
npm run dev
```

## Build
```bash
npm run build
```

## Deploy manuale su GitHub Pages
```bash
npm run deploy
```

> Nota: cambia `base` in `vite.config.ts` se il repo non si chiama `console-andrea`.

## Deploy automatico (GitHub Actions)
Al push su `main`, la build viene pubblicata sul branch `gh-pages`.

Abilita Pages: Settings → Pages → Branch: `gh-pages`.
