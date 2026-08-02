# @absolutejs/crm

Multi-vendor CRM adapter framework for the AbsoluteJS stack.

> **Status: alpha.** Pin an exact version while the API approaches 1.0.

## What it is

A unified CRM contract (`CRMAdapter`) plus vendor adapters for the major CRMs, designed to be:

- **Type-safe end-to-end** — generic `CRMContact` / `CRMLead` / `CRMDeal` types are what the rest of your framework sees; vendor-specific shapes are confined to one adapter.
- **Auth-integrated** — OAuth2 flows ride on `@absolutejs/auth` + `citra`. No bespoke per-vendor login code in your app.
- **Bring-your-own-store** — `CRMTokenStore` and `CRMSyncQueue` are interfaces with shipped implementations for in-memory, Redis, SQLite, and Neon/Postgres.
- **Bidirectional-ready** — outbound mutations + inbound webhook intake are plumbed through the same queue from day one. v1 ships push-at-call-end + on-demand pull; v2 activates full sync via config.
- **Voice-aware** — drop-in bridge to `@absolutejs/voice` agents via `VoiceCRMContract`. Lead-capture and disposition-logging pathway templates included.

## Vendor coverage

| Vendor      | Status  | Auth  | Adapter | Webhooks |
| ----------- | ------- | ----- | ------- | -------- |
| Salesforce  | shipped | citra | shipped | shipped  |
| HubSpot     | shipped | citra | shipped | shipped  |
| Pipedrive   | shipped | citra | shipped | shipped  |
| Zoho CRM    | shipped | citra | shipped | shipped  |
| Attio       | shipped | citra | shipped | shipped  |
| Close       | shipped | citra | shipped | shipped  |
| monday CRM  | shipped | citra | shipped | shipped  |
| GoHighLevel | shipped | citra | shipped | shipped  |

## Installation

```sh
bun add @absolutejs/crm
```

## Quick start

```ts
import {
  createInMemoryCRMSyncQueue,
  createInMemoryCRMTokenStore,
} from "@absolutejs/crm";

const tokenStore = createInMemoryCRMTokenStore();
const syncQueue = createInMemoryCRMSyncQueue();
```

The package exports all eight adapter factories from its root, plus OAuth handlers, signed webhook receivers, in-memory and durable stores, reconciliation workers, and the voice CRM bridge.

## Design

- **Vendor SDK strategy is per-vendor**: Salesforce uses `jsforce`, HubSpot uses `@hubspot/api-client`, monday.com uses `@mondaydotcomorg/api` for the typed value. Pipedrive / Zoho / Attio / Close / GoHighLevel use raw fetch + handwritten types. All SDKs are in `optionalDependencies` and lazy-loaded inside the adapter file.
- **Adapter outputs flow through generic types only.** Vendor types never leak past `src/adapters/<vendor>.ts`.
- **`CRMTokenStore`** is the source of truth for OAuth tokens, refresh tokens, instance URLs, and region/sub-account context. The runtime asks the store for a token, hands it to the adapter, and re-asks on 401 after a refresh.

## License

Business Source License 1.1 — production use is free except offering it as a competing hosted CRM or CRM-integration service (see the Additional Use Grant in [LICENSE](./LICENSE)). Converts to Apache 2.0 on May 29, 2030.
