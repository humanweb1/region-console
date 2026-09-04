# Digital Anıt API Contract

Region Console is the source of truth for cemetery geography and operational eligibility. Digital Anıt must call these APIs from its backend; credentials must never be embedded in browser code.

## Base URL

`https://knmkbjtutzitugntszpq.supabase.co/functions/v1`

## Authentication

All endpoints require `Authorization: Bearer <service/integration token>` and currently enforce JWT verification. The production integration credential must be stored only in the Digital Anıt backend and Supabase secret configuration.

## 1. Resolve memorial location

`POST /resolve-memorial-location`

Request:

```json
{ "grave_id": "uuid" }
```

Returns the physical location hierarchy, cemetery/section geometry metadata and grave coordinates. This endpoint does not return service/campaign eligibility.

## 2. Cemetery map

`POST /cemetery-map-read`

Request:

```json
{ "cemetery_id": "uuid" }
```

Returns read-only cemetery boundary, sections and active graves suitable for the Digital Anıt cemetery map. No write operation is exposed.

## 3. Check memorial order

`POST /check-memorial-order`

Request:

```json
{ "grave_id": "uuid" }
```

Returns the current operational order decision, including service status, closure reason and the applicable active campaign when present.

Example:

```json
{
  "allowed": true,
  "reason": null,
  "service": {
    "status": "service",
    "closure_reason": null,
    "region_id": "uuid"
  },
  "campaign": null
}
```

## Rules

- Grave and cemetery IDs are stable UUIDs; names are display data only.
- Service and campaign state must not be copied into a memorial profile.
- Order eligibility is evaluated at order time.
- Region Console remains authoritative for physical cemetery data and operational service state.
- Digital Anıt remains authoritative for memorial/profile content.
- Public/anonymous RPC execution is not allowed for these APIs.
