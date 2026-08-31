import { Moon, Sun, Monitor } from 'lucide-react';
import useDarkMode from '../hooks/useDarkMode';

const modes = [
  { value: 'light', icon: Sun, label: 'Light' },
  { value: 'dark', icon: Moon, label: 'Dark' },
  { value: 'system', icon: Monitor, label: 'System' },
];

export default function DarkModeToggle({ className = '' }) {
  const { mode, setMode } = useDarkMode();

  function cycleMode() {
    const order = ['light', 'dark', 'system'];
    const idx = order.indexOf(mode);
    setMode(order[(idx + 1) % order.length]);
  }

  const current = modes.find((m) => m.value === mode) || modes[2];
  const Icon = current.icon;

  return (
    <button
      onClick={cycleMode}
      className={`rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300 ${className}`}
      aria-label={`Color theme: ${current.label}. Click to change.`}
      title={`Theme: ${current.label}`}
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}
