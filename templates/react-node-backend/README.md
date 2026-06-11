# React Node Backend

A React + Vite starter with a tiny Node API, a mock auth service, and `atom.io`
state on the client.

## What It Shows

- loadable atoms for remote todo data
- atom families for individual records
- optimistic create, update, and delete flows
- selectors for derived todo stats
- cookie-based auth against a backend-shaped local service

## Run It

```sh
npm run dev
```

The dev script starts three processes:

- Vite app at `http://localhost:5173`
- Todo API at `http://localhost:3000`
- Mock authenticator at `http://localhost:4000`

Build and preview the frontend with the same local services:

```sh
npm run build
npm run preview
```

## Where To Look

- `src/App.tsx`: the React UI, loadable atoms, atom families, optimistic writes, and derived stats.
- `node/server.ts`: in-memory todo API, auth cookie handling, and a server-side atom for slow-load toggles.
- `node/authenticator.ts`: mock login service that redirects back to the API.

## Next Ideas

- Swap the in-memory SQLite database for a file-backed one.
- Move the auth token validation into middleware.
- Add a timeline to inspect todo changes while developing.
