// Consistent chrome around every real product screenshot on the marketing
// page — a plain <img> would read as a random crop; this reads as "a window
// into the actual app."
export default function ScreenshotFrame({ src, alt, className = '' }) {
  return (
    <div className={`overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg ${className}`}>
      <div className="flex items-center gap-1.5 border-b border-gray-100 bg-gray-50 px-3 py-2">
        <span className="h-2.5 w-2.5 rounded-full bg-gray-300" />
        <span className="h-2.5 w-2.5 rounded-full bg-gray-300" />
        <span className="h-2.5 w-2.5 rounded-full bg-gray-300" />
      </div>
      <img src={src} alt={alt} className="w-full" loading="lazy" />
    </div>
  );
}
