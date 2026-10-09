/**
 * Keep this device ready to sell offline (impl-33 Part 4). Run while online
 * on the POS page: on load and every few minutes. Registers the device,
 * refreshes the menu snapshot and the cashier's shift, tops up bill numbers,
 * and renews the cashier's PIN-session token if they enrolled here.
 */
import { api } from '../lib/api';
import {
  getDeviceId, saveSnapshot, saveShift, getBlocks, addBlock, remainingNumbers, LOW_BILL_NUMBERS,
} from './store';
import { getEnrollment, updateToken } from './pin';
import { pendingSummary } from './sync';

export const SNAPSHOT_REFRESH_MS = 5 * 60 * 1000;

export async function prepareOffline({ branchId, user }) {
  const deviceId = await getDeviceId();
  const { pending } = await pendingSummary();
  await api.registerPosDevice({ device_id: deviceId, branch_id: branchId, pending_count: pending });

  const snap = await api.getPosSnapshot(branchId);
  await saveSnapshot(snap);
  await saveShift(user.id, branchId, snap.shift);

  let blocks = await getBlocks(branchId);
  if (remainingNumbers(blocks) < LOW_BILL_NUMBERS) {
    const { block } = await api.leasePosBillBlock({ device_id: deviceId, branch_id: branchId });
    await addBlock(branchId, block);
    blocks = await getBlocks(branchId);
  }

  const enrollment = await getEnrollment(user.id);
  if (enrollment) {
    try {
      const res = await api.refreshPosToken(deviceId);
      await updateToken(user.id, res.pos_token, res.expires_at);
    } catch { /* PIN cleared or changed — the sync removes the stale unlock */ }
  }
  return { deviceId, snapshotAt: snap.snapshot_at, remaining: remainingNumbers(blocks) };
}
