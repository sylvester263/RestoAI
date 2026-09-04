import { Link } from 'react-router-dom';
import { ChefHat, ArrowLeft } from 'lucide-react';
import DarkModeToggle from '../../components/DarkModeToggle';

/**
 * Shared chrome for the Terms of Service and Privacy Policy pages — same
 * header/footer/disclaimer either way, only the section content differs.
 */
export function LegalSection({ number, title, children }) {
  return (
    <section className="mb-8">
      <h2 className="mb-2 text-lg font-semibold text-[var(--text-primary)]">
        {number}. {title}
      </h2>
      <div className="space-y-3 text-sm leading-relaxed text-[var(--text-secondary)]">
        {children}
      </div>
    </section>
  );
}

export default function LegalPageShell({ title, updatedDate, children }) {
  return (
    <div className="min-h-screen bg-[var(--surface-1)]">
      <header className="border-b border-[var(--border)]">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4 sm:px-6">
          <Link to="/" className="flex items-center gap-2 text-[var(--text-primary)]">
            <ChefHat className="h-5 w-5" />
            <span className="font-bold">RestoAI</span>
          </Link>
          <div className="flex items-center gap-3">
            <Link
              to="/"
              className="flex items-center gap-1 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back to home
            </Link>
            <DarkModeToggle />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <h1 className="mb-1 text-2xl font-bold text-[var(--text-primary)]">{title}</h1>
        <p className="mb-8 text-xs text-[var(--text-secondary)]">Last updated: {updatedDate}</p>

        {children}

        <div className="mt-10 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-4 py-3 text-xs text-[var(--text-secondary)]">
          This document is a working draft reflecting RestoAI's actual features and data practices as built, and has not
          yet been reviewed by qualified legal counsel. It will be updated as that review completes.
        </div>
      </main>

      <footer className="border-t border-[var(--border)] py-6 text-center text-xs text-[var(--text-secondary)]">
        <Link to="/terms" className="hover:text-[var(--text-primary)]">Terms of Service</Link>
        <span className="mx-2">·</span>
        <Link to="/privacy" className="hover:text-[var(--text-primary)]">Privacy Policy</Link>
      </footer>
    </div>
  );
}
