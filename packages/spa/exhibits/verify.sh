pnpm --filter @atom.io/spa build
pnpm --filter @atom.io/spa cov
pnpm --filter @atom.io/spa-devtools cov
pnpm exec turbo run test:breakage:peers --filter=@atom.io/spa --filter=@atom.io/spa-devtools
pnpm --filter @atom.io/spa test:production
pnpm --filter @atom.io/spa exec playwright install chromium
pnpm --filter @atom.io/spa test:browser
pnpm --filter @atom.io/spa size
pnpm --filter @atom.io/spa readme:check
