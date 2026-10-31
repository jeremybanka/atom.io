npm install
npm run dev

# Build and serve the production output.
npm run build
npm run preview

# Install the test browser, then verify production and development.
npx playwright install chromium
npm test
