import { publicApi } from './api';

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

export function pushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window;
}

// Registers the service worker, requests notification permission, subscribes
// to push, and saves the subscription against the customer's phone number.
// Returns true on success, false if the user declined or push isn't supported.
export async function subscribeToPush(tenantSlug, phone) {
  if (!pushSupported()) return false;

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return false;

  const vapidPublicKey = await publicApi.getVapidKey(tenantSlug);
  if (!vapidPublicKey) return false;

  const registration = await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;

  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
    });
  }

  const raw = subscription.toJSON();
  await publicApi.subscribePush(tenantSlug, {
    phone,
    endpoint: raw.endpoint,
    keys: raw.keys,
  });
  return true;
}
