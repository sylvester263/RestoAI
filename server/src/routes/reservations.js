import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth.js';
import { query } from '../db/pool.js';

const router = Router();
router.use(authenticate);

const statusSchema = z.object({
  status: z.enum(['confirmed', 'seated', 'completed', 'cancelled', 'no_show']),
});

// ── PUT /api/reservations/:id/status ──
router.put('/:id/status', async (req, res, next) => {
  try {
    const data = statusSchema.parse(req.body);
    const result = await query(
      `UPDATE reservations SET status = $3 WHERE id = $1 AND tenant_id = $2 RETURNING *`,
      [req.params.id, req.user.tenant_id, data.status],
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: { message: 'Reservation not found' } });
    }
    res.json({ reservation: result.rows[0] });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: { message: err.errors[0].message } });
    }
    next(err);
  }
});

export default router;
