pnpm --filter @atom.io/water build
pnpm --filter @atom.io/water test:once
pnpm --filter @atom.io/water test:production
pnpm --filter @atom.io/water exec playwright install chromium
pnpm --filter @atom.io/water test:browser
pnpm --filter @atom.io/water size
pnpm --filter @atom.io/water readme:check
