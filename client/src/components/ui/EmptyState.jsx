/**
 * EmptyState — consistent, actionable empty-state placeholder.
 *
 * Replaces ad-hoc "No items found" text with a visually distinct block
 * that includes an icon, a heading, an optional description, and an
 * optional call-to-action button.
 *
 * Usage:
 *   <EmptyState icon={Package} title="No items yet" description="Add your first menu item." action={{ label: 'Add Item', onClick: handleAdd }} />
 */
import { Inbox } from 'lucide-react';

export default function EmptyState({ icon: Icon = Inbox, title, description, action, className = '' }) {
  return (
    <div className={`flex flex-col items-center justify-center py-16 text-center ${className}`}>
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gray-100">
        <Icon className="h-8 w-8 text-gray-400" />
      </div>
      <h3 className="mb-1 text-base font-semibold text-gray-700">{title}</h3>
      {description && <p className="mb-4 max-w-sm text-sm text-gray-500">{description}</p>}
      {action && (
        <button onClick={action.onClick} className="btn-primary text-sm">
          {action.label}
        </button>
      )}
    </div>
  );
}
