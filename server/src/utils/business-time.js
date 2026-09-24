/**
 * One definition of "today / this week / this month" and of "a sale", shared
 * by the Dashboard, branch analytics and AI Insights so their numbers agree.
 *
 * The database runs on GMT, so bare CURRENT_DATE / DATE(created_at) put the
 * day boundary at 5am Pakistan time. Every business-day calculation goes
 * through these helpers instead.
 */
export const BUSINESS_TZ = 'Asia/Karachi';

const PERIOD_UNITS = { today: 'day', week: 'week', month: 'month' };

/** SQL timestamptz for the start of the current local day / week (Mon) / month. */
export function periodStartSql(period = 'today') {
  const unit = PERIOD_UNITS[period] || 'day';
  return `(date_trunc('${unit}', NOW() AT TIME ZONE '${BUSINESS_TZ}') AT TIME ZONE '${BUSINESS_TZ}')`;
}

/** SQL for the local calendar date of a timestamptz column. */
export function localDateSql(column) {
  return `DATE(${column} AT TIME ZONE '${BUSINESS_TZ}')`;
}

/** Cancelled orders never count toward sales, order counts or top items. */
export function isSaleSql(alias = '') {
  return `${alias ? `${alias}.` : ''}status <> 'cancelled'`;
}
