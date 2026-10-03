# Nafath Login — Design Spec

**Date:** 2026-10-03
**Status:** Draft — awaiting review
**Source docs:** `Nafath-integration-guide.pdf` (Elm / Rabet, Product Integration Guide), plus lessons from open-source integrations (see References).

## 1. Goal

Add **Nafath as a second login method next to phone OTP**. A user enters their national ID / Iqama number, approves the request in the Nafath app, and receives the same Aqar JWT that `verify-otp` returns today.

### Decisions already made

| Topic | Decision |
|---|---|
| Role of Nafath | Alternative login method. Phone OTP stays unchanged. |
| Role enforcement | None. Any user may log in with Nafath; no role requires it. |
| First Nafath login for an unlinked national ID | Phone OTP once to link the national ID to the phone's account (existing or new). Later Nafath logins are one step. `users.phone` stays required. |
| Service key | `Login` (60 s decision window, no biometrics). Configurable via env. |
| Stored identity data | Minimal now: national ID, `nafathVerifiedAt`, `isVerified = true`. Decoded JWT claims are kept temporarily on the request record so we can inspect the real payload in sandbox; the final set of identity columns is decided after the first sandbox call. |
| Hosting | Backend runs inside KSA (regulatory requirement for the callback). |
| Credentials | APP-ID / APP-KEY obtained from Rabet. |

### Out of scope

- Persisting identity attributes (names, DOB, address…) on the user — decided after sandbox.
- Requiring Nafath for any role or action.
- Push of the result over socket.io (client polls instead).
- Nafath's OIDC web-redirect flow (different API; not in our guide).
- Mobile-side work (number display, deep links) beyond the API contract in §8.

## 2. Prerequisites (operational, not code)

1. **Fixed outbound IP registered with Elm.** Integrators report Elm allow-lists the SP's egress IP; every instance must leave through it (e.g., NAT gateway). The same IP is sent as the "server IP" in `X-Forwarded-For`. *Open: confirm we have one and it is registered on Rabet.*
2. **Callback URL registered with Elm:** `https://<api-domain>/api/v1/integrations/nafath/callback`.
3. **Firewall / ingress** accepts inbound traffic from `195.170.180.7` and `195.170.180.6`; outbound to the same.
4. **Separate APP-ID/APP-KEY per environment** (sandbox, staging, production). A mismatched pair fails with a 403 indistinguishable from bad credentials.
5. **SP name registered on Rabet** — the JWT `aud` claim must equal it.

## 3. How Nafath works (summary of the guide)

- `POST {base}/api/v1/mfa/request?local={ar|en}&requestId={uuid}` body `{ nationalId, service }` → `{ transId, random }`.
- `POST {base}/api/v1/mfa/request/status` body `{ nationalId, transId, random }` → `{ status: WAITING|COMPLETED|REJECTED|EXPIRED }`.
- `GET {base}/api/v1/mfa/jwk` → `{ keys: [{ kty, e, use, kid, alg: "RS256", n }] }`.
- Callback (SP-hosted) `POST` body `{ token, transId, requestId }`; `token` is an RS256 JWT signed by Elm.
- All outbound calls carry headers `APP-ID`, `APP-KEY`, `X-Forwarded-For: <endUserIp>,<serverIp>`, `Content-Type: application/json`.
- One active transaction per national ID (`400-034-050` otherwise). Lifetime 200 s with a 180 s decision interval per the general rules; the service table says `Login` has a 60 s window. We treat `Login` as 60 s + 20 s grace (configurable).
- Base URLs: sandbox `https://rabet-nafath.api.elm.sa/nafath-sandbox`, staging `https://rabet-nafath.api.elm.sa/stg`, production `https://rabet-nafath.api.elm.sa`.

**JWT payload shape.** The guide's decoded example shows only `aud, nbf, transId, iss, exp, iat, status`. Two independent open-source integrations read identity attributes as **top-level claims** using the appendix names (`nin` | `iqamaNumber` | `visaNumber` | `borderNumber`, `firstName`, `fatherName`/`secondName`, …). We assume top-level and verify on the first sandbox callback.

## 4. Architecture

New module `src/modules/nafath/`, imported by `AppModule`. It imports `AuthModule` (for `AuthService.generateToken` / `sanitize` and `JwtGuard`). `AuthModule` does **not** import Nafath — no circular dependency, and the OTP flow is untouched.

```
src/modules/nafath/
├── nafath.module.ts
├── nafath.config.ts                 # typed env loader + validation
├── nafath-auth.controller.ts        # /auth/nafath/start | status/:requestId | link
├── nafath-callback.controller.ts    # /integrations/nafath/callback
├── nafath.service.ts                # orchestration: start, status, callback, link
├── nafath.client.ts                 # HTTP calls to Elm (request, status, jwk)
├── nafath-jwt.verifier.ts           # JWK cache + RS256 verification
├── nafath-link-token.service.ts     # sign/verify short-lived link tokens
├── nafath-ip.guard.ts               # callback source-IP allow-list
├── nafath.cron.ts                   # expire stale requests, purge old rows
├── entities/nafath-request.entity.ts
├── dto/start-nafath.dto.ts
├── dto/link-nafath.dto.ts
├── dto/nafath-callback.dto.ts
└── nafath.errors.ts                 # NafathApiError + code constants
```

Each unit has one job:

| Unit | Responsibility | Depends on |
|---|---|---|
| `NafathClient` | Builds headers, calls Elm, parses `{ code, reference }` errors into `NafathApiError`, timeouts. No DB. | config, `fetch` |
| `NafathJwtVerifier` | Fetch + cache JWKS, select key by `kid`, verify RS256 + `aud` + time claims. Returns payload. | `NafathClient`, `JwtService` |
| `NafathLinkTokenService` | Sign/verify link tokens with a dedicated secret. | `JwtService`, config |
| `NafathService` | Request lifecycle and state transitions; issues login tokens. | repos, client, verifier, link-token service, `AuthService` |
| `NafathIpGuard` | Rejects callback requests not from allow-listed IPs. | config |
| `NafathCron` | Marks stale `WAITING` rows `EXPIRED`; deletes rows past retention. | repo |

## 5. Data model

### 5.1 New table `nafath_requests`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | **Is** the `requestId` sent to Nafath and returned to the client. Generated by us (`uuid` v4). |
| `nationalId` | varchar(10) not null | Needed for the status API body. |
| `transId` | varchar null, unique | From Send Request. Null only if Send Request failed. |
| `random` | varchar(4) null | Number shown to the user. |
| `service` | varchar not null | e.g. `Login`. |
| `status` | varchar not null default `WAITING` | CHECK in (`WAITING`,`COMPLETED`,`REJECTED`,`EXPIRED`,`FAILED`). `FAILED` = Send Request errored. |
| `statusSource` | varchar null | `callback` or `poll` — which channel set the terminal status. |
| `claims` | jsonb null | Verified JWT payload (temporary, for sandbox inspection; purged by retention). |
| `clientIp` | varchar not null | End-user IP used in `X-Forwarded-For`. |
| `expiresAt` | timestamp not null | `createdAt + NAFATH_DECISION_SECONDS`. Returned to client. |
| `lastPolledAt` | timestamp null | Throttles fallback status polling. |
| `completedAt` | timestamp null | When a terminal status was recorded. |
| `consumedAt` | timestamp null | When a `COMPLETED` result was redeemed (login token or link token issued). Single use. |
| `linkedUserId` | uuid null FK → users(id) ON DELETE SET NULL | User the national ID was linked to via this request. |
| `createdAt`, `updatedAt` | timestamp | |

Indexes: `(nationalId, createdAt)`, unique `transId`, `(status, expiresAt)`, `(createdAt)`.

Entity does not extend `BaseEntity` (no soft delete needed; rows are purged).

### 5.2 `users` changes

| Column | Type | Notes |
|---|---|---|
| `nationalId` | varchar(10) null, unique | Linked national ID / Iqama. |
| `nafathVerifiedAt` | timestamp null | Set on link; refreshed on each Nafath login. |

`isVerified` (exists, currently never set) becomes `true` when a national ID is linked.

One migration creates the table and alters `users` (raw SQL, matching existing migration style; `migrationsRun: true` applies it on boot).

## 6. Flows

### 6.1 Start — `POST /api/v1/auth/nafath/start` (public)

Body: `{ nationalId: string, lang?: 'ar' | 'en' }`.

1. Validate `nationalId` matches `^[1-6]\d{9}$` (citizen 1, resident 2, visitor 3–6).
2. Per-IP throttle: `ThrottlerGuard` with 5 req / 60 s on this route.
3. Per-national-ID limit: if ≥ 5 `nafath_requests` rows for this ID in the last 10 min → 429. (Prevents spamming someone else's Nafath app.)
4. If a row for this ID is `WAITING` and `now < expiresAt + grace` → 409 `NAFATH_REQUEST_PENDING`. **Never** return the existing request to the caller (it would let a stranger claim someone else's approval).
5. Insert row (`status=WAITING`, `id=uuid()`, `clientIp=req.ip`).
6. Call Send Request with `requestId=row.id`, `local=lang ?? NAFATH_LOCALE`, `service=NAFATH_SERVICE`.
7. Success → store `transId`, `random`; respond `{ requestId, random, expiresAt }`.
8. Failure → mark row `FAILED`, map error (§7).

### 6.2 Status — `GET /api/v1/auth/nafath/status/:requestId` (public)

The `requestId` is an unguessable UUID known only to the initiating client.

1. Load row (404 if missing). If `WAITING` and `now > expiresAt + grace` → mark `EXPIRED`.
2. **Fallback poll:** if still `WAITING`, `now - createdAt ≥ 10 s` and `lastPolledAt` is null or ≥ 5 s ago → call Nafath status API, update `lastPolledAt`. `COMPLETED`/`REJECTED`/`EXPIRED` → record with `statusSource='poll'`. Errors `400-034-051` / `400-034-053` → `EXPIRED`. Other errors are logged and ignored (client keeps polling). A `COMPLETED` from this server-to-server call is sufficient to authenticate; it just carries no claims.
3. Respond:
   - `WAITING` → `{ status: 'WAITING', expiresAt }`
   - `REJECTED` / `EXPIRED` / `FAILED` → `{ status }`
   - `COMPLETED` → atomically set `consumedAt` (`UPDATE … WHERE id = :id AND consumedAt IS NULL`). If 0 rows updated → 410 `NAFATH_RESULT_ALREADY_USED`. Otherwise:
     - User with `users.nationalId = row.nationalId` exists and is active → refresh `nafathVerifiedAt`; respond `{ status: 'COMPLETED', token, isNewUser: false, user }` (same shape as `verify-otp`).
     - User exists but inactive → 403.
     - No user → respond `{ status: 'COMPLETED', linkRequired: true, linkToken }`.

### 6.3 Callback — `POST /api/v1/integrations/nafath/callback` (public + `NafathIpGuard`)

1. `NafathIpGuard`: `req.ip` must be in `NAFATH_CALLBACK_ALLOWED_IPS` → else 403.
2. Body is received as a plain object (`@Body() body: Record<string, unknown>`) and validated inside the controller with `plainToInstance(NafathCallbackDto, body)` + `validate(dto, { whitelist: true, forbidNonWhitelisted: false })`. Reason: the global `ValidationPipe` uses `forbidNonWhitelisted: true` and runs *before* any route-level pipe, so a DTO-typed body would reject every callback the moment Nafath adds a field. The global pipe skips non-class metatypes, so a plain-object param passes through untouched. Missing `token`/`transId`/`requestId` → 400.
3. Verify `token` with `NafathJwtVerifier` (§6.5). Failure → 400, log `transId` + reason.
4. Find row by `id = requestId`. Unknown → 200 + warn log (avoid retry storms).
5. Require `payload.transId === body.transId === row.transId` → else 400.
6. Status is taken **from the JWT payload**, not the body. If row already terminal → 200 no-op (idempotent). Else update `WHERE status = 'WAITING'`: set `status`, `statusSource='callback'`, `completedAt`, and `claims = payload` when `COMPLETED`.
7. Respond 200 immediately; no downstream work on this path.

### 6.4 Link — `POST /api/v1/auth/nafath/link` (`JwtGuard`)

Called by the app right after a normal `send-otp` / `verify-otp` login when status returned `linkRequired`.

Body: `{ linkToken }`.

1. Verify link token (§6.6) → `requestId`. Invalid/expired → 401.
2. Load row: must be `COMPLETED`, `consumedAt` set, `linkedUserId` null → else 409 `NAFATH_LINK_INVALID`.
3. In a transaction:
   - Another user already has this `nationalId` → 409 `NAFATH_ID_LINKED_TO_OTHER_ACCOUNT`.
   - Current user has a different `nationalId` → 409 `NAFATH_ACCOUNT_HAS_OTHER_ID`.
   - Else set `user.nationalId`, `nafathVerifiedAt = now`, `isVerified = true`; set `row.linkedUserId = user.id`.
   - Unique constraint on `users.nationalId` is the final race guard (map violation → 409).
4. Respond `{ user }` (sanitized).

### 6.5 JWT verification (`NafathJwtVerifier`)

- Decode header without verifying; require `alg === 'RS256'` and a `kid`.
- Keys cached in memory (`Map<kid, KeyObject>`) with 24 h TTL. Unknown `kid` → refetch JWKS once (concurrent refetches share one in-flight promise), then fail if still unknown.
- Convert JWK → PEM via `crypto.createPublicKey({ key: jwk, format: 'jwk' }).export({ type: 'spki', format: 'pem' })`.
- Verify with `JwtService.verify(token, { publicKey: pem, algorithms: ['RS256'], audience: NAFATH_AUDIENCE, clockTolerance: 60 })`.
- `iss` is not enforced (guide shows `"Nafath App"` but does not commit to it); logged on mismatch for observation.
- No new npm dependencies (`crypto` is built in; `JwtService` from `@nestjs/jwt` is already installed).

### 6.6 Link token (`NafathLinkTokenService`)

- Payload `{ purpose: 'nafath-link', rid: <requestId> }`, `expiresIn: 10m`, signed with **`NAFATH_LINK_TOKEN_SECRET`** (must differ from `JWT_SECRET`).
- Rationale: `JwtStrategy.validate` does `findOne({ where: { id: payload.sub, isActive: true } })`; TypeORM drops `undefined` keys from `where`, so a sub-less token signed with `JWT_SECRET` would authenticate as the first active user. A separate secret makes link tokens unusable as access tokens.
- Verify checks signature, expiry and `purpose === 'nafath-link'`.

## 7. Error handling

### Outbound Nafath errors → our API

| Nafath | Our response |
|---|---|
| `400-034-050` (active trx exists) | 409 `NAFATH_REQUEST_PENDING` |
| `422-031-046` (invalid data / unknown service) | 400 `NAFATH_INVALID_REQUEST` |
| `403` (bad APP-ID/KEY or env mismatch) | 503 `NAFATH_UNAVAILABLE` + error log (config problem) |
| `404`, `500`, `503`, network error, timeout | 503 `NAFATH_UNAVAILABLE` |

`NafathApiError` carries `httpStatus`, `code`, `reference`. Logs include `code`, `reference`, `requestId`, `transId` — **never** national IDs, tokens or claims. Timeouts: 10 s for request/status, 10 s for JWK.

### Our error codes (client-facing)

`NAFATH_REQUEST_PENDING` (409), `NAFATH_RATE_LIMITED` (429), `NAFATH_INVALID_REQUEST` (400), `NAFATH_UNAVAILABLE` (503), `NAFATH_RESULT_ALREADY_USED` (410), `NAFATH_LINK_INVALID` (409), `NAFATH_ID_LINKED_TO_OTHER_ACCOUNT` (409), `NAFATH_ACCOUNT_HAS_OTHER_ID` (409).

Thrown as `new XxxException({ message: '<human text>', error: '<CODE>' })`; the existing `HttpExceptionFilter` already emits both, so the client gets `{ success: false, message, error: 'NAFATH_…' }` with no filter changes.

## 8. Client contract (mobile)

1. `POST /auth/nafath/start { nationalId }` → `{ requestId, random, expiresAt }`.
2. Show `random` prominently; offer "Open Nafath" button → `nafath://home` (iOS) / `nic://nafath` (Android).
3. Poll `GET /auth/nafath/status/:requestId` every 2–3 s until a non-`WAITING` status or `expiresAt` passes.
4. `COMPLETED` + `token` → logged in (same as OTP).
5. `COMPLETED` + `linkRequired` → run normal phone OTP (`send-otp`, `verify-otp`), then `POST /auth/nafath/link { linkToken }` with the new bearer token. If `verify-otp` says `isNewUser`, continue to `complete-profile` as today.
6. `REJECTED` → "Request was rejected in Nafath". `EXPIRED` → "Request expired, try again". 409 `NAFATH_REQUEST_PENDING` → "A Nafath request is already open — approve it or try again in about a minute". Switch on the `error` field, not `message`.

## 9. Infrastructure changes

- `main.ts`: `app.set('trust proxy', TRUST_PROXY)` (create app as `NestExpressApplication`). Required so `req.ip` is the real client IP for `X-Forwarded-For`, throttling, and the callback IP guard. Default: not trusted (local dev). Misconfiguration fails closed for the callback guard.
- `AppModule`: register `ThrottlerModule.forRoot(...)` (no global guard — only routes that opt in are throttled, so existing behaviour is unchanged) and `NafathModule`.
- `.env.example`: add Nafath vars.
- `JwtStrategy.validate`: reject payloads without a string `sub` (defence in depth for the TypeORM `undefined`-in-`where` behaviour described in §6.6). One-line guard; no behaviour change for valid tokens.

### Environment variables

| Var | Example / default | Notes |
|---|---|---|
| `NAFATH_BASE_URL` | `https://rabet-nafath.api.elm.sa/nafath-sandbox` | Per environment. |
| `NAFATH_APP_ID` | — | Required. |
| `NAFATH_APP_KEY` | — | Required. Never logged. |
| `NAFATH_SERVICE` | `Login` | |
| `NAFATH_AUDIENCE` | — | Required. SP name registered on Rabet. |
| `NAFATH_SERVER_IP` | — | Required. Our registered egress IP. |
| `NAFATH_CALLBACK_ALLOWED_IPS` | `195.170.180.7,195.170.180.6` | Comma-separated. |
| `NAFATH_LOCALE` | `ar` | |
| `NAFATH_DECISION_SECONDS` | `60` | `Login` window. |
| `NAFATH_GRACE_SECONDS` | `20` | After decision window. |
| `NAFATH_LINK_TOKEN_SECRET` | — | Required; must differ from `JWT_SECRET`. |
| `NAFATH_RETENTION_DAYS` | `30` | Rows (incl. claims) deleted after this. |
| `NAFATH_ENABLED` | `false` | When false, Nafath endpoints return 503 and config is not validated (lets other envs boot without creds). |
| `TRUST_PROXY` | unset | e.g. `1` behind one load balancer. |

`nafath.config.ts` validates required vars at boot when `NAFATH_ENABLED=true` (fail fast).

## 10. Scheduled jobs (`NafathCron`)

- Every 5 min: `UPDATE nafath_requests SET status='EXPIRED', completedAt=now() WHERE status='WAITING' AND expiresAt + grace < now()`.
- Daily 03:00: `DELETE FROM nafath_requests WHERE createdAt < now() - retention`.

## 11. Security & privacy summary

- APP-KEY server-side only; never logged.
- Callback: IP allow-list + mandatory RS256 signature verification + `aud` + `transId` match. No option to skip verification.
- National IDs, tokens and claims never written to logs.
- Single-use redemption of `COMPLETED` results; link tokens scoped by dedicated secret and purpose.
- Per-IP and per-national-ID rate limits on start.
- Claims retained ≤ `NAFATH_RETENTION_DAYS`.

## 12. Testing

Unit tests (Jest, `*.spec.ts` beside sources, mocking repos/fetch as existing specs do):

- **`NafathJwtVerifier`** — generate an RSA key pair in-test, serve its JWK from a mocked client: valid token passes; unknown `kid` triggers one refetch; bad signature, wrong `aud`, expired beyond tolerance, `alg: none` / `HS256` all rejected; concurrent refetch shares one request.
- **`NafathClient`** — header names and exact `X-Forwarded-For` format; query params; `{ code, reference }` error parsing; timeout → `NafathApiError`.
- **`NafathService`** — start: format, local-pending 409, upstream `400-034-050` → 409, per-ID limit 429, failure marks `FAILED`; status: lazy expiry, fallback poll throttling and outcomes, linked user → token, unlinked → link token, second redemption → 410, inactive user → 403; callback: idempotency, transId mismatch, unknown requestId, status from JWT; link: happy path, conflicts, already-linked request.
- **`NafathLinkTokenService`** — rejects tokens signed with `JWT_SECRET` and wrong `purpose`.
- **`NafathIpGuard`** — allow / deny.

Manual sandbox checklist (before staging):

1. Start with the Elm-provided sandbox test ID; confirm `transId`/`random`.
2. Approve (sandbox app or Elm's simulator, if Elm confirms it — integrators reference `…/nafath-test-app/api/v1/mfa/request/update`).
3. Confirm callback arrives, signature verifies, `aud` matches; **inspect stored `claims`** to confirm top-level attribute layout → decide identity columns.
4. Confirm `X-Forwarded-For` format accepted (guide: no space after comma).
5. Exercise reject, expiry, duplicate-request paths.

## 13. Open questions for Elm / Rabet

1. Exact lifetime for `Login`: 60 s decision + ? (guide contradicts itself: 180/200 s vs 60 s).
2. Confirm JWT attributes are top-level claims and which are sent for the `Login` service.
3. `nbf == exp` in the sample JWT — expected validity window and clock skew?
4. Is the sandbox simulator endpoint supported, and which test IDs to use?
5. Is our egress IP registered, and is the callback URL registered for each environment?
6. `X-Forwarded-For` — confirm comma without space.

## References

- Elm/Rabet — *Nafath Application Service, Product Integration Guide* (`Nafath-integration-guide.pdf`).
- [hamada-emam-tech/nafath-php](https://github.com/hamada-emam-tech/nafath-php) — claim mapping, JWK path, environment notes, onboarding guide.
- [DevMahmoudMustafa/laravel-nafath](https://github.com/DevMahmoudMustafa/laravel-nafath) — endpoints incl. sandbox simulator, security notes.
- [mohamad-zatar/saudi-nafath-integration](https://github.com/mohamad-zatar/saudi-nafath-integration).
