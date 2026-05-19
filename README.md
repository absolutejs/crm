# @absolutejs/crm

Multi-vendor CRM adapter framework for the AbsoluteJS stack.

> **Status: alpha.** API surface is in flux. Targeting `0.1.0` once all 9 vendor adapters and bidirectional sync ship.

## What it is

A unified CRM contract (`CRMAdapter`) plus vendor adapters for the major CRMs, designed to be:

- **Type-safe end-to-end** — generic `CRMContact` / `CRMLead` / `CRMDeal` types are what the rest of your framework sees; vendor-specific shapes are confined to one adapter.
- **Auth-integrated** — OAuth2 flows ride on `@absolutejs/auth` + `citra`. No bespoke per-vendor login code in your app.
- **Bring-your-own-store** — `CRMTokenStore` and `CRMSyncQueue` are interfaces with shipped implementations for in-memory, Redis, SQLite, and Neon/Postgres.
- **Bidirectional-ready** — outbound mutations + inbound webhook intake are plumbed through the same queue from day one. v1 ships push-at-call-end + on-demand pull; v2 activates full sync via config.
- **Voice-aware** — drop-in bridge to `@absolutejs/voice` agents via `VoiceCRMContract`. Lead-capture and disposition-logging pathway templates included.

## Vendor coverage roadmap

| Vendor | Status | Auth | Adapter | Webhooks |
|---|---|---|---|---|
| Salesforce | planned | citra (shipped) | TBD | TBD |
| HubSpot | planned | citra (shipped 0.26.0) | TBD | TBD |
| Pipedrive | planned | citra (pending) | TBD | TBD |
| Zoho CRM | planned | citra (pending) | TBD | TBD |
| Attio | planned | citra (pending) | TBD | TBD |
| Close | planned | citra (pending) | TBD | TBD |
| monday CRM | planned | citra (pending) | TBD | TBD |
| GoHighLevel | planned | citra (pending) | TBD | TBD |

## Design

- **Vendor SDK strategy is per-vendor**: Salesforce uses `jsforce`, HubSpot uses `@hubspot/api-client`, monday.com uses `@mondaydotcomorg/api` for the typed value. Pipedrive / Zoho / Attio / Close / GoHighLevel use raw fetch + handwritten types. All SDKs are in `optionalDependencies` and lazy-loaded inside the adapter file.
- **Adapter outputs flow through generic types only.** Vendor types never leak past `src/adapters/<vendor>.ts`.
- **`CRMTokenStore`** is the source of truth for OAuth tokens, refresh tokens, instance URLs, and region/sub-account context. The runtime asks the store for a token, hands it to the adapter, and re-asks on 401 after a refresh.

## License

CC BY-NC 4.0. See [LICENSE](./LICENSE).
