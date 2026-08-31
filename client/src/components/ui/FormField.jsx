/**
 * FormField — consistent form input with label, validation error, and helper text.
 *
 * Usage:
 *   <FormField label="Email" type="email" value={v} onChange={setV} error={errors.email} required />
 *   <FormField label="Phone" value={v} onChange={setV} hint="We'll send a code to this number" />
 *   <FormField as="select" label="Category" value={v} onChange={setV} options={cats} />
 *   <FormField as="textarea" label="Notes" value={v} onChange={setV} rows={3} />
 */

export default function FormField({
  label,
  hint,
  error,
  required = false,
  as = 'input',
  className = '',
  options = [],
  id,
  ...props
}) {
  const fieldId = id || `field-${label?.toLowerCase().replace(/\s+/g, '-')}`;
  const errorId = `${fieldId}-error`;
  const hintId = `${fieldId}-hint`;

  const inputClasses = `block w-full rounded-lg border px-3 py-2 text-sm shadow-sm placeholder:text-gray-400 focus:outline-none focus:ring-1 transition-colors ${
    error
      ? 'border-red-400 focus:border-red-500 focus:ring-red-500'
      : 'border-gray-300 focus:border-brand-500 focus:ring-brand-500'
  } ${className}`;

  let Input;
  if (as === 'select') {
    Input = (
      <select
        id={fieldId}
        className={inputClasses}
        aria-invalid={!!error}
        aria-describedby={[hint ? hintId : '', error ? errorId : ''].filter(Boolean).join(' ') || undefined}
        {...props}
      >
        {options.map((opt) => (
          <option key={opt.value ?? opt} value={opt.value ?? opt}>
            {opt.label ?? opt}
          </option>
        ))}
      </select>
    );
  } else if (as === 'textarea') {
    Input = (
      <textarea
        id={fieldId}
        className={inputClasses}
        aria-invalid={!!error}
        aria-describedby={[hint ? hintId : '', error ? errorId : ''].filter(Boolean).join(' ') || undefined}
        {...props}
      />
    );
  } else {
    Input = (
      <input
        id={fieldId}
        className={inputClasses}
        aria-invalid={!!error}
        aria-describedby={[hint ? hintId : '', error ? errorId : ''].filter(Boolean).join(' ') || undefined}
        {...props}
      />
    );
  }

  return (
    <div>
      {label && (
        <label htmlFor={fieldId} className="mb-1 block text-xs font-medium text-gray-600">
          {label}
          {required && <span className="ml-0.5 text-red-500" aria-hidden="true">*</span>}
        </label>
      )}
      {Input}
      {hint && !error && (
        <p id={hintId} className="mt-1 text-xs text-gray-400">{hint}</p>
      )}
      {error && (
        <p id={errorId} role="alert" className="mt-1 text-xs text-red-600">{error}</p>
      )}
    </div>
  );
}
