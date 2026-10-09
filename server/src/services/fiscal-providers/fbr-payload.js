/**
 * FBR Digital Invoicing payload (impl-34) — pure functions, no I/O, so the
 * mapping and rounding can be tested on their own.
 *
 * Source: PRAL "Technical Specification for DI API" v1.12 (24-Jul-2025),
 * sections 4.1–4.1.2 (field list and samples). Nothing here goes beyond that
 * document; points it leaves open are marked CONFIRM.
 *
 * Amounts always come from the settled bill on the server, never the client.
 */

const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/** Sale date in Pakistan time as YYYY-MM-DD (the document's invoiceDate format). */
export function pktDate(when) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date(when));
  const get = (t) => parts.find((p) => p.type === t).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/**
 * Split the bill's discount and tax across its lines.
 * - discount: proportional to each line's value, remainder on the last line
 * - tax: each line gets round2(net × rate) — error 0104 checks the
 *   percentage per line — and the few paisa of rounding difference from
 *   the bill's own tax goes on the largest line, so the invoice total is
 *   exactly what the receipt printed. CONFIRM 0104's tolerance with PRAL.
 * @returns {Array<{ gross, discount, net, tax, total }>}
 */
export function allocateLines(lines, { discount, tax, ratePercent }) {
  const gross = lines.map((l) => r2(l.total_price));
  const subtotal = r2(gross.reduce((s, g) => s + g, 0));
  let discLeft = r2(discount);
  const out = gross.map((g, i) => {
    const isLast = i === gross.length - 1;
    const d = isLast ? discLeft : Math.min(discLeft, subtotal > 0 ? r2(discount * (g / subtotal)) : 0);
    discLeft = r2(discLeft - d);
    const net = r2(g - d);
    return { gross: g, discount: d, net, tax: r2(net * (ratePercent / 100)) };
  });
  const residual = r2(r2(tax) - out.reduce((s, l) => s + l.tax, 0));
  if (residual !== 0 && out.length > 0) {
    const largest = out.reduce((best, l, i) => (l.net > out[best].net ? i : best), 0);
    out[largest].tax = r2(out[largest].tax + residual);
  }
  return out.map((l) => ({ ...l, total: r2(l.net + l.tax) }));
}

/**
 * Check the tenant's FBR settings are complete enough to build an invoice.
 * @returns {string[]} missing setting names (empty = ok)
 */
export function missingSettings(s) {
  const required = ['seller_ntn_cnic', 'seller_business_name', 'seller_province', 'seller_address', 'hs_code', 'uom', 'sale_type', 'rate_desc', 'rate_value'];
  const missing = required.filter((k) => s?.[k] == null || s[k] === '');
  if (s?.environment === 'sandbox' && !s.sandbox_scenario_id) missing.push('sandbox_scenario_id');
  return missing;
}

/**
 * Build the post/validate request body (same shape for both).
 * @param {object} bill  from services/fiscal.js loadBill()
 * @param {object} s     tenant_fbr_settings row
 */
export function buildFbrPayload(bill, s) {
  const lines = allocateLines(bill.items, { discount: bill.discount, tax: bill.tax, ratePercent: Number(s.rate_value) });
  const payload = {
    invoiceType: 'Sale Invoice',
    invoiceDate: pktDate(bill.saleTime),
    sellerNTNCNIC: s.seller_ntn_cnic,
    sellerBusinessName: s.seller_business_name,
    sellerProvince: s.seller_province,
    sellerAddress: s.seller_address,
    // Walk-in customer: buyer NTN/CNIC is optional for an unregistered buyer
    // (section 4.1.2 table). Sent empty, like invoiceRefNo in the samples.
    // CONFIRM with PRAL that this walk-in default is accepted.
    buyerNTNCNIC: '',
    buyerBusinessName: s.walkin_buyer_name || 'Walk-in Customer',
    buyerProvince: s.walkin_buyer_province || s.seller_province,
    buyerAddress: s.walkin_buyer_address || s.seller_address,
    buyerRegistrationType: 'Unregistered',
    invoiceRefNo: '',
    items: bill.items.map((item, i) => {
      const l = lines[i];
      return {
        hsCode: s.hs_code,
        productDescription: String(item.name).slice(0, 255),
        rate: s.rate_desc,
        uoM: s.uom,
        quantity: Number(item.quantity),
        totalValues: l.total,
        valueSalesExcludingST: l.gross,
        fixedNotifiedValueOrRetailPrice: 0.00,
        salesTaxApplicable: l.tax,
        salesTaxWithheldAtSource: 0.00,
        // Optional fields sent as in the document's samples.
        // CONFIRM: error 0091 ("Extra tax must be empty") applies to some sale types.
        extraTax: 0.00,
        furtherTax: 0.00,
        sroScheduleNo: '',
        fedPayable: 0.00,
        discount: l.discount,
        saleType: s.sale_type,
        sroItemSerialNo: '',
      };
    }),
  };
  // "Required for Sandbox only" (section 4.1.2 table)
  if (s.environment === 'sandbox') payload.scenarioId = s.sandbox_scenario_id;
  return payload;
}

/**
 * Read a post/validate response (section 4.1.3–4.1.5). Valid only when the
 * header AND every item are "00" and an invoice number came back — sample
 * 4.1.5 shows header "00" with an invalid item and no invoice number.
 * @returns {{ ok: true, invoiceNumber } | { ok: false, code, message } | { ok: null, message }}
 *   ok:null = the answer doesn't say either way (treated as unknown)
 */
export function readFbrResponse(body) {
  const v = body?.validationResponse;
  if (!v) return { ok: null, message: 'FBR response had no validationResponse' };
  const items = Array.isArray(v.invoiceStatuses) ? v.invoiceStatuses : [];
  const badItem = items.find((it) => it?.statusCode !== '00');
  if (v.statusCode === '01' || badItem) {
    const code = v.errorCode || badItem?.errorCode || null;
    const message = v.error || badItem?.error || v.status || 'Invoice invalid';
    const where = badItem ? ` (item ${badItem.itemSNo})` : '';
    return { ok: false, code, message: `FBR ${code || ''}: ${message}${where}`.replace('FBR :', 'FBR:') };
  }
  if (v.statusCode === '00' && body.invoiceNumber) return { ok: true, invoiceNumber: String(body.invoiceNumber) };
  return { ok: null, message: 'FBR response was neither valid nor invalid' };
}
