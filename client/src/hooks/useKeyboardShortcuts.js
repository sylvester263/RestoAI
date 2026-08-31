/**
 * useKeyboardShortcuts — declarative global keyboard shortcut binding.
 *
 * Usage:
 *   useKeyboardShortcuts([
 *     { key: 'n',           callback: () => openNewTab(), when: 'always' },
 *     { key: '/',           callback: () => focusSearch(), when: 'always' },
 *     { key: 'Escape',      callback: () => closeModal(),  when: 'always' },
 *     { key: 'k', ctrl: true, callback: () => openPalette(), when: 'always' },
 *     { key: 'k', meta: true, callback: () => openPalette(), when: 'always' },
 *   ]);
 *
 * `when`: 'always' | 'modal' (only when a modal is open) | 'input' (even in inputs)
 * Shortcuts are disabled when focus is in an <input>/<textarea>/<select> unless
 * `when: 'input'` or the key is Escape.
 */
import { useEffect } from 'react';

export default function useKeyboardShortcuts(shortcuts) {
  useEffect(() => {
    function handleKeyDown(e) {
      // Skip if user is typing in a form field (unless shortcut says 'input')
      const tag = document.activeElement?.tagName;
      const isTyping = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || document.activeElement?.isContentEditable;

      for (const shortcut of shortcuts) {
        const { key, ctrl, meta, shift, alt, callback, when = 'always' } = shortcut;

        // Check modifier match
        if (ctrl && !e.ctrlKey && !e.metaKey) continue;
        if (meta && !e.metaKey) continue;
        if (shift && !e.shiftKey) continue;
        if (alt && !e.altKey) continue;

        // Check key match (case-insensitive for letters)
        const keyMatch = e.key.toLowerCase() === key.toLowerCase() || e.code === key;
        if (!keyMatch) continue;

        // Skip if typing in a form field (except Escape and 'input' shortcuts)
        if (isTyping && when !== 'input' && key !== 'Escape') continue;

        e.preventDefault();
        callback(e);
        return;
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [shortcuts]);
}
