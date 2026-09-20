# jQuery Admin Dashboard

A customer operations dashboard built with atom.io, jQuery 4, TypeScript, and Vite. Search customers, filter by status, sort the directory, add customers, and update selected customers together. Summary cards and revenue by plan update from the same state. Undo and redo customer edits with an atom.io timeline.

## Run It

Use Node.js 24.12 or newer. After installing dependencies, run `npm run dev`. Run `npm run build` to create the production app and `npm run preview` to preview it.

From the atom.io repository, use `pnpm --filter @atom.io/template-jquery-admin-dashboard dev`.

## What It Shows

- Atoms hold customers, search, filters, sorting, and selection.
- Selectors derive visible customers, workspace totals, and monthly revenue by plan. Only active subscriptions contribute revenue; all amounts are USD.
- Transactions add customers and apply bulk status changes as a single undoable action.
- A timeline tracks customer edits independently of search and selection.
- jQuery renders the DOM and delegates events. A small subscription bridge renders initial values and subsequent atom.io updates, and unsubscribes when the app unmounts.

Selecting the checkbox in the table header selects the currently visible customers. Changing the search or status filter clears selection. Adding a customer clears filters so the new entry is visible. Customer data is inserted as text, including names and company names.

## Where To Look

- `src/data.ts`: sample customers, plans, and status types.
- `src/state.ts`: atoms, selectors, transactions, and the customer timeline.
- `src/dashboard.ts`: the jQuery view and atom.io subscriptions.
- `src/dashboard.html`: the page and accessible add-customer dialog.
- `src/style.css`: responsive layout and styling.
- `tests/dashboard.test.ts`: customer workflows, undo history, and rendering checks.

## Quality Checks

Run `npm test`, `npm run lint`, and `npm run fmt:check`. Use `npm run fmt` to apply the pinned dprint configuration.

## Make It Yours

This is a frontend demo with fictional customers. Changes live in memory and reset on reload; the displayed admin profile is sample content. Connect your customer API and authentication when adapting it for a real workspace. The state model is independent of jQuery, so it can also drive other views.
