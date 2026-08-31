// Consistent chrome around every real product screenshot on the marketing
// page — a plain <img> would read as a random crop; this reads as "a window
// into the actual app."
export default function ScreenshotFrame({ src, alt, className = '' }) {
  return (
    <div className={`overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface-2)] shadow-lg ${className}`}>
      <div className="flex items-center gap-1.5 border-b border-[var(--border-light)] bg-[var(--surface-3)] px-3 py-2">
        <span className="h-2.5 w-2.5 rounded-full bg-gray-300 dark:bg-gray-600" />
        <span className="h-2.5 w-2.5 rounded-full bg-gray-300 dark:bg-gray-600" />
        <span className="h-2.5 w-2.5 rounded-full bg-gray-300 dark:bg-gray-600" />
      </div>
      <img src={src} alt={alt} className="w-full" loading="lazy" />
    </div>
  );
}
