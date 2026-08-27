export function getNotificationCapability(env = globalThis) {
  const NotificationApi = env.Notification;
  const navigatorApi = env.navigator;
  if (!NotificationApi || !navigatorApi?.serviceWorker) return { supported: false, permission: 'unsupported' };
  return { supported: true, permission: NotificationApi.permission || 'default' };
}

export async function enableNotifications() {
  const capability = getNotificationCapability(window);
  if (!capability.supported) return capability;
  await navigator.serviceWorker.register('/sw.js');
  const permission = await Notification.requestPermission();
  return { supported: true, permission };
}

export async function sendTestNotification() {
  const capability = getNotificationCapability(window);
  if (!capability.supported || capability.permission !== 'granted') return false;
  const registration = await navigator.serviceWorker.ready;
  await registration.showNotification('Donezo 🔥', {
    body: 'Notifications are ready. Your squad can hold you accountable.',
    icon: '/icon.svg',
    badge: '/icon.svg',
    tag: 'donezo-test',
  });
  return true;
}
