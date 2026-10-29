pnpm --filter @atom.io/water build
pnpm --filter @atom.io/water cov
pnpm --filter @atom.io/water-devtools cov
pnpm exec turbo run test:breakage:peers --filter=@atom.io/water --filter=@atom.io/water-devtools
pnpm --filter @atom.io/water test:production
pnpm --filter @atom.io/water exec playwright install chromium
pnpm --filter @atom.io/water test:browser
pnpm --filter @atom.io/water size
pnpm --filter @atom.io/water readme:check
