pnpm --filter @atom.io/hydrogen build
pnpm --filter @atom.io/hydrogen cov
pnpm --filter @atom.io/hydrogen-devtools cov
pnpm exec turbo run test:breakage:peers --filter=@atom.io/hydrogen --filter=@atom.io/hydrogen-devtools
pnpm --filter @atom.io/hydrogen test:production
pnpm --filter @atom.io/hydrogen exec playwright install chromium
pnpm --filter @atom.io/hydrogen test:browser
pnpm --filter @atom.io/hydrogen size
pnpm --filter @atom.io/hydrogen readme:check
