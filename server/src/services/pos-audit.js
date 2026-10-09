/**
 * Tenant-side POS audit trail (impl-33 Part 4): shift closes with unsynced
 * offline sales, review decisions, staff PIN changes. Best-effort like the
 * super-admin audit — a logging failure never undoes the action it records.
 */
import { query } from '../db/pool.js';

export async function posAudit(tenantId, userId, action, details = {}) {
  try {
    await query(
      'INSERT INTO pos_audit_log (tenant_id, user_id, action, details) VALUES ($1, $2, $3, $4)',
      [tenantId, userId, action, details],
    );
  } catch (err) {
    console.error('[pos-audit] log failed:', err.message);
  }
}
