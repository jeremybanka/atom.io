pnpm --filter hydrogen build
pnpm --filter hydrogen cov
pnpm --filter @atom.io/hydrogen-devtools cov
pnpm exec turbo run test:breakage:peers --filter=hydrogen --filter=@atom.io/hydrogen-devtools
pnpm --filter hydrogen test:production
pnpm --filter hydrogen exec playwright install chromium
pnpm --filter hydrogen test:browser
pnpm --filter hydrogen size
pnpm --filter hydrogen readme:check
