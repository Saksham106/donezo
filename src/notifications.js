export function getNotificationCapability(env = globalThis) {
  const NotificationApi = env.Notification;
  const navigatorApi = env.navigator;
  if (!NotificationApi || !navigatorApi?.serviceWorker) return { supported: false, permission: 'unsupported' };
  return { supported: true, permission: NotificationApi.permission || 'default' };
}

export function urlBase64ToUint8Array(value) {
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((character) => character.charCodeAt(0)));
}

function sameApplicationServerKey(subscription, expected) {
  const existing = subscription?.options?.applicationServerKey;
  if (!existing) return false;
  const actual = new Uint8Array(existing);
  if (actual.length !== expected.length) return false;
  return actual.every((value, index) => value === expected[index]);
}

export async function syncPushSubscription(repo) {
  const capability = getNotificationCapability(window);
  if (!capability.supported || capability.permission !== 'granted') return false;
  const registration = await navigator.serviceWorker.ready;
  if (!registration.pushManager) return false;
  const publicKey = await repo.getVapidPublicKey();
  const applicationServerKey = urlBase64ToUint8Array(publicKey);
  let subscription = await registration.pushManager.getSubscription();
  if (subscription && !sameApplicationServerKey(subscription, applicationServerKey)) {
    await subscription.unsubscribe();
    subscription = null;
  }
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey,
    });
  }
  await repo.savePushSubscription(subscription);
  return true;
}

export async function enableNotifications(repo) {
  const capability = getNotificationCapability(window);
  if (!capability.supported) return capability;
  await navigator.serviceWorker.register('/sw.js');
  const permission = capability.permission === 'granted'
    ? 'granted'
    : await Notification.requestPermission();
  let pushRegistered = false;
  if (permission === 'granted' && repo) {
    try {
      pushRegistered = await syncPushSubscription(repo);
    } catch {
      pushRegistered = false;
    }
  }
  return { supported: true, permission, pushRegistered };
}

export async function sendTestNotification() {
  const capability = getNotificationCapability(window);
  if (!capability.supported || capability.permission !== 'granted') return false;
  const registration = await navigator.serviceWorker.ready;
  await registration.showNotification('Donezo 🔥', {
    body: 'Notifications are ready. Now your friends can annoy you properly.',
    icon: '/icon.svg',
    badge: '/icon.svg',
    tag: 'donezo-test',
    data: { url: '/' },
  });
  return true;
}
