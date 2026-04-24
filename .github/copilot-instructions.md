# Copilot Instructions for Dupli Products

- This is a Shopify React Router app with a server-side entry and Shopify CLI-driven development workflow.
- The core Shopify integration lives in `app/shopify.server.js`; it exports `authenticate`, `registerWebhooks`, `addDocumentResponseHeaders`, and `login` for route handlers.
- Route structure uses React Router loaders/actions. Key routes:
  - `app/routes/app.jsx` -> app shell, `authenticate.admin(request)` in loader, `AppProvider`, Shopify error boundary.
  - `app/routes/app._index.jsx` -> main dashboard and product duplication UI; this is the primary business logic surface.
  - `app/routes/auth.$.jsx` -> auth callback route for Shopify login flow.
  - `app/routes/webhooks.app.uninstalled.jsx` and `app/routes/webhooks.app.scopes_update.jsx` -> webhook endpoints using `authenticate.webhook(request)`.
- Server rendering is implemented in `app/entry.server.jsx`; it must call `addDocumentResponseHeaders(request, responseHeaders)` before streaming.
- The app uses Prisma session storage with SQLite by default. `prisma/schema.prisma` defines the `Session` model and `app/shopify.server.js` connects `PrismaSessionStorage(prisma)`.
- Workflow commands:
  - `npm run dev` -> `shopify app dev`
  - `npm run setup` -> `prisma generate && prisma migrate deploy`
  - `npm run build` -> `react-router build`
  - `npm run start` -> `react-router-serve ./build/server/index.js`
  - `npm run typecheck` -> `react-router typegen && tsc --noEmit`
  - `npm run lint` -> ESLint on repository files.
- Extension code lives under `extensions/dupli-products-ext/`; that workspace is separate from the main app and uses Shopify UI extension components.
- `shopify.app.toml` defines app metadata, access scopes, embedded mode, and app-specific webhook subscriptions.
- Keep Shopify-specific auth/webhook behavior consistent with the existing pattern: do not replace `authenticate.admin`/`authenticate.webhook` with custom auth unless you mirror the same boundary handling.
- Prefer the existing React Router route naming conventions such as `auth.$.jsx` and `webhooks.app.uninstalled.jsx` rather than introducing unconventional route file layouts.
- Avoid changing the Shopify CLI-managed configuration URLs unless updating `shopify.app.toml` and validating with `shopify app dev`.

> If you want, I can also add a second section that summarizes the dashboard GraphQL flow and the exact mutation/query patterns used in `app/routes/app._index.jsx`.