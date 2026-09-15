# Deploying feedfusion to Vercel (Vercel Services)

## What was added/changed, and why

**`vercel.json` (new, root)** — uses Vercel's native **Services** feature
(public beta) to run the Vite frontend and the Express backend as two
services in one project, sharing one domain:

```json
{
    "services": {
        "frontend": { "root": "frontend", "framework": "vite" },
        "backend": { "root": "backend", "entrypoint": "src/server.ts" }
    },
    "rewrites": [
        { "source": "/api(/.*)?", "destination": { "type": "service", "service": "backend" } },
        { "source": "/(.*)", "destination": { "type": "service", "service": "frontend" } }
    ]
}
```

`entrypoint: "src/server.ts"` is required — Vercel detected "Express" but
still needs to be told which file to run for the Node runtime. Because it
points at the **source** file, Vercel bundles directly from TypeScript
source; it does not run `backend`'s own `npm run build`/`npm start`
scripts. (An earlier serverless-function-style approach using a hand-built
`api/[...path].ts` wrapper has been removed — this native Services support
replaces it entirely and is simpler.)

## Three real bugs found and fixed during verification

These were caught by actually running the real build/start commands in a
sandbox (not just reading the code), so they're fixed now rather than
surfacing later as confusing production failures:

1. **`backend/src/services/salesExcelReport.service.ts`** —
   `workbook.views = [{ activeTab: 0 }]` failed `tsc` because exceljs's
   `WorkbookView` type declares more required fields than the library
   actually needs at runtime (this exact partial-object form is standard
   usage per exceljs's own docs). Fixed with a type cast
   (`as any`) — no behavior change, purely a type-checking gap in
   exceljs's own type definitions.

2. **`backend/tests/integration/sales.service.test.ts`** — has real,
   pre-existing type errors against the current `CompleteSaleInput` type
   (missing `paymentMethod`, a `discountPin` property that doesn't exist
   on the type — possibly a typo for a renamed field). These are **not
   fixed** here — I don't know what values your tests are supposed to
   assert, and guessing would risk masking a real test bug rather than
   fixing it. What *is* fixed: `backend/tsconfig.build.json` (new) excludes
   `tests/` so the **production build** no longer depends on the test
   suite's health. `npm test` still type-checks tests the same way as
   before and will still show these errors — worth fixing separately when
   you have time, unrelated to this deployment.

3. **`backend/package.json`** — `"main"` and `"start"` pointed at
   `dist/server.js`, but with `rootDir: "."` in `tsconfig.json`, the real
   compiled output is `dist/src/server.js`. `npm start` was silently
   broken (only noticeable if you ever ran the compiled output directly —
   local dev always used `tsx watch src/server.ts`, which never touches
   `dist/`). Fixed both paths and confirmed by actually starting
   `dist/src/server.js` and hitting `/api/v1/health` — got back
   `200 {"status":"ok","service":"feedfusion-backend"}`. This fix doesn't
   affect the Vercel deploy itself (Vercel builds from `src/server.ts`
   directly per the entrypoint above, not via `dist/`), but matters if you
   ever run `npm start` locally or deploy to a host that does.

Also fixed a build failure caused by a version mismatch: `package.json` had
`"typescript": "^5.5.3"` (a range), so Vercel's install could resolve a
different patch version than the one tested locally, and one such patch
treats the `moduleResolution: "node"` deprecation warning as build-fatal.
Pinned to an exact `"typescript": "5.9.3"` so Vercel and local dev always
resolve the identical version. Verified with a fully clean install (no
cached `node_modules`, no lockfile carried over) — `npm run build` exits 0
with no warnings at all under 5.9.3.

## Two things that still need your decision (unchanged from before)

1. **Neon keep-alive**: the `setInterval` ping in `backend/src/server.ts`
   only works in a long-lived process. Whether it's meaningful under
   Vercel Services' Fluid compute (which can reuse warm instances across
   concurrent requests, unlike classic short-lived serverless) isn't
   something I could confirm in this sandbox — watch for the same
   "purchase looked like it failed" symptom in production, and if it
   recurs, switch `DATABASE_URL` to Neon's **pooled** connection string
   (hostname has `-pooler` in it).
2. **`pg` connection pooling** under serverless/Fluid compute — same
   pooled-connection-string mitigation applies if you see connection-count
   warnings on Neon's dashboard.

## Environment variables (Project Settings → Environment Variables)
- `DATABASE_URL` — Neon connection string (pooled, see above)
- `JWT_ACCESS_SECRET`
- `JWT_REFRESH_SECRET`
- `JWT_ACCESS_EXPIRES_IN` (e.g. `15m`)
- `JWT_REFRESH_EXPIRES_IN` (e.g. `7d`)
- `VITE_API_URL` = `/api/v1` (relative — same origin, no CORS needed)

Do **not** set `PORT` — Vercel manages this itself.

## Steps
1. `git init && git add . && git commit -m "ready for vercel"` from this
   folder root (the one with `vercel.json` in it).
2. Push to GitHub.
3. Vercel → Add New Project → Import. When Vercel detects multiple
   services, confirm/refresh the `services` config, set the project
   **Framework** to **Services**, and make sure Root Directory is `./`
   (not `frontend/`).
4. Add the environment variables above.
5. Deploy. Test `https://<your-app>.vercel.app/api/v1/health` first.
