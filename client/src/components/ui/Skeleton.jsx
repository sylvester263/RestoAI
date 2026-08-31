/**
 * Skeleton — content-shaped placeholder that pulses while data loads.
 *
 * Usage:
 *   <Skeleton className="h-4 w-32" />            — single line
 *   <Skeleton circle className="h-10 w-10" />    — avatar
 *   <Skeleton.Card />                            — pre-built card shape
 *   <Skeleton.Table rows={5} cols={4} />         — pre-built table shape
 *   <Skeleton.KpiRow count={5} />                — pre-built KPI row
 */

export function Skeleton({ className = 'h-4 w-full', circle = false }) {
  return (
    <div
      aria-hidden="true"
      className={`animate-pulse rounded-md bg-gray-200 ${circle ? 'rounded-full' : ''} ${className}`}
    />
  );
}

function SkeletonCard({ lines = 3 }) {
  return (
    <div className="card" aria-hidden="true">
      <div className="space-y-3">
        <Skeleton className="h-5 w-2/5" />
        {Array.from({ length: lines }).map((_, i) => (
          <Skeleton key={i} className={`h-4 ${i === lines - 1 ? 'w-3/5' : 'w-full'}`} />
        ))}
      </div>
    </div>
  );
}

function SkeletonTable({ rows = 5, cols = 4 }) {
  return (
    <div className="card overflow-hidden p-0" aria-hidden="true">
      <div className="border-b border-gray-200 bg-gray-50 px-4 py-3">
        <div className="flex gap-4">
          {Array.from({ length: cols }).map((_, i) => (
            <Skeleton key={i} className="h-4 flex-1" />
          ))}
        </div>
      </div>
      <div className="divide-y divide-gray-100">
        {Array.from({ length: rows }).map((_, r) => (
          <div key={r} className="flex gap-4 px-4 py-3">
            {Array.from({ length: cols }).map((__, c) => (
              <Skeleton key={c} className={`h-4 flex-1 ${c === 0 ? 'w-32' : ''}`} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function SkeletonKpiRow({ count = 5 }) {
  return (
    <div className={`grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-${count}`} aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="card flex items-center gap-4">
          <Skeleton circle className="h-12 w-12" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-5 w-24" />
          </div>
        </div>
      ))}
    </div>
  );
}

function SkeletonList({ rows = 5 }) {
  return (
    <div className="space-y-3" aria-hidden="true">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="card flex items-center gap-4 p-4">
          <Skeleton circle className="h-10 w-10" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-2/5" />
            <Skeleton className="h-3 w-3/5" />
          </div>
          <Skeleton className="h-4 w-16" />
        </div>
      ))}
    </div>
  );
}

Skeleton.Card = SkeletonCard;
Skeleton.Table = SkeletonTable;
Skeleton.KpiRow = SkeletonKpiRow;
Skeleton.List = SkeletonList;
