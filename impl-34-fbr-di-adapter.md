# Implementation 34 — FBR Digital Invoicing (DI) adapter

Status (2026-10-09): **spec only.** Source: PRAL "Technical Specification for DI API", v1.12, issued 7-Apr-2025, last updated 24-Jul-2025 (51 pages, supplied by the founder). Everything below is from that document unless marked **CONFIRM**. Do not invent anything the document does not state.

Depends on: `impl-33` Part 3 (`submitInvoice(bill)` seam, `fiscal_provider`, fiscal status columns) and Part 4 (offline sync).

## 0. Read this first: does this API apply to restaurants?
This document is the **FBR/PRAL** API. Its sandbox scenarios are organised by business activity (manufacturer, importer, distributor, wholesaler, exporter, retailer, service provider, other) and by sector. Restaurants are not named anywhere. Separately, the Punjab Revenue Authority (PRA) runs its own system (eIMS) with a different API; Punjab restaurants may fall under PRA, not FBR.
**CONFIRM before build (blocking):** for each of the ~20 restaurants: (a) FBR or PRA, (b) the business activity and sector on their FBR sales-tax profile, (c) whether FBR requires this DI API for them. Ask whoever supplied this document. Do not ship a restaurant to production on guesswork.

## 1. Endpoints (from the document)
| Purpose | Method / URL |
|---|---|
| Post invoice (sandbox) | `POST https://gw.fbr.gov.pk/di_data/v1/di/postinvoicedata_sb` |
| Post invoice (production) | `POST https://gw.fbr.gov.pk/di_data/v1/di/postinvoicedata` |
| Validate only (sandbox) | `POST https://gw.fbr.gov.pk/di_data/v1/di/validateinvoicedata_sb` |
| Validate only (production) | `POST https://gw.fbr.gov.pk/di_data/v1/di/validateinvoicedata` |
| Provinces | `GET https://gw.fbr.gov.pk/pdi/v1/provinces` |
| Document types | `GET .../pdi/v1/doctypecode` |
| HS codes | `GET .../pdi/v1/itemdesccode` |
| SRO items | `GET .../pdi/v1/sroitemcode` |
| Transaction types | `GET .../pdi/v1/transtypecode` |
| UOM | `GET .../pdi/v1/uom` |
| SRO schedule | `GET .../pdi/v1/SroSchedule?rate_id=&date=&origination_supplier=` |
| Rate by sale type | `GET .../pdi/v2/SaleTypeToRate?date=&transTypeId=&originationSupplier=` |
(The document also lists HS-with-UOM and two STATL endpoints; read pages 31–34 when building those.)

Auth: `Authorization: Bearer <token>`. The token is issued by PRAL, valid 5 years, renewed on request. The document says the same URLs serve sandbox and production with routing by token, yet it lists separate `_sb` URLs. **CONFIRM** which is correct; until then use the listed `_sb` URLs for sandbox and the plain URLs for production.
HTTP codes documented: 200, 401 (unauthorized), 500 (internal error).

## 2. Request body (post and validate share it)
Header fields (once per invoice):
- `invoiceType` — "Sale Invoice" or "Debit Note"
- `invoiceDate` — `YYYY-MM-DD`
- `sellerNTNCNIC` — 7 or 13 digits; `sellerBusinessName`; `sellerProvince` (value from the provinces API; Punjab = code 7 in the sample); `sellerAddress`
- `buyerNTNCNIC` — required, optional if buyer is Unregistered; `buyerBusinessName`, `buyerProvince`, `buyerAddress` (required); `buyerRegistrationType` — "Registered" | "Unregistered"
- `invoiceRefNo` — required only for a debit note (22 digits for NTN sellers, 28 for CNIC)
- `scenarioId` — **sandbox only**, e.g. "SN001"
- `items[]`

Item fields: `hsCode`, `productDescription`, `rate` (string from the rate API, e.g. "18%"), `uoM` (from UOM API), `quantity`, `totalValues` (incl. tax), `valueSalesExcludingST`, `fixedNotifiedValueOrRetailPrice`, `salesTaxApplicable`, `salesTaxWithheldAtSource` (required); optional `extraTax`, `furtherTax`, `sroScheduleNo`, `fedPayable`, `discount`, `sroItemSerialNo`; `saleType` (required, e.g. "Goods at standard rate (default)").
The sample JSON shows 18% and Sindh; those are sample values, not restaurant rules.

Response: `invoiceNumber` (FBR-issued, example format `7000007DI1747119701593`), `dated`, `validationResponse{statusCode "00"=valid/"01"=invalid, status, errorCode, error, invoiceStatuses[] per item}`. Per-item `invoiceNo` appears as `<invoiceNumber>-<n>`. Error code list is in section 7 of the document (0001, 0002, 0003, 0005 …); store the code and message verbatim.

## 3. Receipt requirements (document section 6)
Every invoice must print the **FBR Digital Invoicing System logo** and a **QR code**: QR version 2.0 (25×25), **1.0 × 1.0 inch**. Render at physical size on 58 mm and 80 mm paper.
**CONFIRM:** what the QR encodes. The document does not say. Likely the FBR invoice number, but do not assume; ask PRAL or look at a live sample. The logo image must come from FBR/PRAL; do not redraw it.

## 4. Sandbox testing (document sections 9–10)
Sandbox requires `scenarioId`. Scenarios relevant to restaurants depend on the registered activity: services are SN018 (services, FED in ST mode) and SN019 (services); end-consumer retail sales are SN026–SN028 and apply **only if registered as a retailer** in the sales-tax profile. Do not hard-code one: store per-tenant `fbr_business_activity`, `fbr_sector`, and a list of scenario IDs to test, from the document's section-10 table. **CONFIRM** whether production access requires passing all applicable scenarios.

## 5. Design
- `server/src/services/fiscal/fbr.js` implements the existing `submitInvoice(bill)`; selected by `tenants.fiscal_provider = 'fbr'`. `pra` is a separate adapter, not covered here.
- Per-tenant settings (encrypted where secret, using the same AES-256-GCM service as WhatsApp tokens): sandbox token, production token, environment (`sandbox|production`), seller NTN/CNIC, business name, province, address, business activity, sector, default HS code, default UOM, default sale type, default rate (or rate resolved via `SaleTypeToRate`). Tokens are never logged, never returned to the client, never in error messages.
- Walk-in customers: buyer fields are required except NTN for unregistered buyers. Use a configurable default ("Walk-in Customer", seller's province and address, Unregistered). **CONFIRM** this is accepted.
- Map bill → payload server-side only; amounts come from the settled bill, never from the client. Round to 2 decimals consistently and make `totalValues = valueSalesExcludingST + salesTaxApplicable (+ furtherTax/extraTax if any) − discount` match what the receipt prints. Add tests for rounding.
- HS code and rate for restaurant food/services are **not** in this document. Make them tenant settings; do not default them in code. **CONFIRM** with FBR/tax adviser.
- Reference data (provinces, UOM, rates) fetched with the tenant's token and cached with a TTL; a failed refresh must not block a sale.
- Result handling: 200 + `statusCode 00` → store `fiscal_invoice_number`, `fiscal_status=submitted`. 200 + `01` → `failed` with the error code, **not retryable** until a manager fixes the data. 401 → provider "misconfigured", alert the owner, stop retries. 500 or timeout → retry with backoff.
- **Duplicate risk:** the document says nothing about idempotency. A timeout after FBR accepted the invoice could create a second FBR invoice on retry. Until PRAL answers, mark ambiguous outcomes `unknown`, never auto-resubmit them, and show them to a manager. **CONFIRM** with PRAL how duplicates are detected.
- Refunds: the document offers only "Sale Invoice" and "Debit Note" and does not describe a credit note. **CONFIRM** how a returned or voided sale must be reported before building refunds against FBR.
- Offline: the document does not state a late-submission deadline. A separate source (KPMG brief, Feb 2025) says 24 hours for offline invoices under the FBR rules; treat as unconfirmed. Use the sale's real date in `invoiceDate`. Submission runs immediately after offline sync; pending/failed list warns after 12 hours.
- Receipt: print FBR invoice number, FBR logo and the QR at the specified size once `submitted`; until then print the normal receipt marked "Fiscal invoice pending" (**CONFIRM** this is acceptable to FBR).

## 6. Rollout
1. Build against sandbox only. Production tokens never in dev.
2. One pilot restaurant, validate endpoint first, then post.
3. Run the section-10 scenarios for that restaurant's registered activity.
4. Only then request production access and enable for other tenants.

## 7. Tests
Mock the gateway for: valid response, item-level invalid, header-level invalid (statusCode 01 with errorCode), 401, 500, timeout-then-success, timeout-ambiguous (no duplicate submit), rounding, walk-in buyer defaults, offline-synced sale with old date, token never present in logs/responses. Sandbox live calls are manual and need a real sandbox token.

## Open items
| Item | Type |
|---|---|
| FBR vs PRA per restaurant; business activity and sector | CONFIRM, blocking |
| Is this DI API the required route for restaurants? | CONFIRM, blocking |
| Same URLs vs `_sb` URLs; token scope (per taxpayer or per software) | CONFIRM |
| QR content | CONFIRM |
| HS code, UOM, rate for restaurant sales | CONFIRM |
| Walk-in buyer defaults accepted | CONFIRM |
| Duplicate detection on retry | CONFIRM |
| Refund/credit note reporting | CONFIRM |
| Offline late-submission deadline | CONFIRM |
| Sandbox pass required for production | CONFIRM |
