/**
 * Human-readable validation messages for public (customer-facing) endpoints.
 *
 * Zod's default messages ("String must contain at least 7 character(s)")
 * describe the schema, not the problem. Customers should be told what is
 * wrong in plain words and, where useful, what a good value looks like.
 * The mapping is keyed by the field path; anything not listed falls back
 * to a generic sentence so raw schema text never reaches a customer.
 */

const FIELD_MESSAGES = {
  // Checkout
  customer_name: 'Please enter your name so the rider knows who to ask for.',
  customer_phone: 'Please enter a valid phone number, for example +923001234567.',
  delivery_address: 'Please add a delivery address so the rider can find you.',
  payment_method: 'Please choose how you would like to pay.',
  notes: 'Notes can be up to 500 characters.',
  redeem_points: 'Loyalty points to redeem must be a whole number.',
  coupon_code: 'Please enter a valid coupon code.',
  items: 'Your cart is empty. Add something from the menu first.',
  'items.menu_item_id': 'One of the items in your cart is no longer on the menu. Please remove it and try again.',
  'items.quantity': 'You can order up to 50 of a single item.',
  // Reservations
  party_size: 'Party size must be between 1 and 50 people.',
  reserved_for: 'Please choose a valid date and time for your booking.',
  // Reviews
  rating: 'Please choose a rating from 1 to 5 stars.',
  comment: 'Comments can be up to 1000 characters.',
  order_id: 'We could not match that order. Please open the tracking link again.',
  // Push / misc
  phone: 'Please enter a valid phone number, for example +923001234567.',
  message: 'Please type a message first.',
  code: 'Please enter a coupon code.',
  subtotal: 'Something went wrong with your cart total. Please refresh and try again.',
};

const FALLBACK = 'Please check the details you entered and try again.';

/**
 * Turn a ZodError into one plain-language sentence for the first failing field.
 * Array indices are stripped from the path so `items.3.quantity` matches
 * `items.quantity`.
 */
export function friendlyValidationMessage(zodError) {
  const issue = zodError?.errors?.[0];
  if (!issue) return FALLBACK;
  const path = (issue.path || []).filter((p) => typeof p !== 'number').join('.');
  if (FIELD_MESSAGES[path]) return FIELD_MESSAGES[path];
  // Fall back to the last segment (e.g. `quantity`) before giving up.
  const leaf = path.split('.').pop();
  return FIELD_MESSAGES[leaf] || FALLBACK;
}
