// Small presentation helpers shared by every screen and sheet.

export const esc = (value = '') => String(value).replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));

const ICON_PATHS = {
  home: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10.5V20h13v-9.5"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0Z"/><path d="M12 13v4"/><path d="M8 20h8"/><path d="M6 6H4v2a3 3 0 0 0 3 3"/><path d="M18 6h2v2a3 3 0 0 1-3 3"/>',
  user: '<circle cx="12" cy="8" r="3.5"/><path d="M5.5 20a6.5 6.5 0 0 1 13 0"/>',
  userPlus: '<circle cx="9" cy="8" r="3"/><path d="M3.5 20a5.5 5.5 0 0 1 11 0"/><path d="M19 8v6"/><path d="M16 11h6"/>',
  people: '<path d="M15.5 20v-1.2a3.8 3.8 0 0 0-3.8-3.8H7.3a3.8 3.8 0 0 0-3.8 3.8V20"/><circle cx="9.5" cy="8" r="3"/><path d="M16 12.5a3 3 0 0 1 4.5 2.6V20"/><path d="M16.5 5.3a3 3 0 0 1 0 5.4"/>',
  bolt: '<path d="m13 2-8 11h6l-1 9 9-12h-6z"/>',
  share: '<path d="M12 16V3"/><path d="m7 8 5-5 5 5"/><path d="M5 13v7h14v-7"/>',
  target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 2v3M22 12h-3M12 22v-3M2 12h3"/>',
  bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15Z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>',
  sliders: '<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>',
  camera: '<rect x="3" y="7" width="18" height="13" rx="3"/><circle cx="12" cy="13.5" r="3.5"/><path d="M9 7l1.5-3h3L15 7"/>',
  smile: '<circle cx="12" cy="12" r="8.5"/><path d="M8.5 14a4 4 0 0 0 7 0"/><path d="M9 9.5h.01M15 9.5h.01"/>',
  reply: '<path d="M4 5h16v11H9l-5 4Z"/>',
  more: '<circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>',
};

export function icon(name, size = 24, strokeWidth = 1.9) {
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round">${ICON_PATHS[name] || ''}</svg>`;
}

export function notify(message, duration = 2400, options = {}) {
  const toast = document.querySelector('#toast');
  if (!toast) return;
  toast.replaceChildren(document.createTextNode(message));
  if (options.action?.label && typeof options.action.onClick === 'function') {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'toast-action';
    button.textContent = options.action.label;
    button.onclick = () => { toast.classList.remove('show'); options.action.onClick(); };
    toast.append(button);
  }
  toast.classList.add('show');
  clearTimeout(notify.timer);
  notify.timer = setTimeout(() => toast.classList.remove('show'), duration);
}

export function haptic(pattern = 24) {
  if (typeof navigator.vibrate !== 'function' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  navigator.vibrate(pattern);
}

export function readableError(error) {
  return error?.message || 'Something went wrong';
}

export const yieldToPaint = () => new Promise((resolve) => {
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => resolve());
  else queueMicrotask(resolve);
});

export function formatWhen(value) {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/** Compact feed timestamp: "now", "12m", "3h", "2d". */
export function formatAgo(value) {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60000));
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export function formatExactTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(date);
}

export function formatTime(value) {
  if (!value) return 'Any time';
  const [hours, minutes] = value.split(':').map(Number);
  return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(new Date(2000, 0, 1, hours, minutes));
}

export function formatDay(dateString, options = { weekday: 'short', month: 'short', day: 'numeric' }) {
  return new Intl.DateTimeFormat('en-US', { ...options, timeZone: 'UTC' }).format(new Date(`${dateString}T12:00:00Z`));
}

export function formatWeekRange(bounds) {
  return `${formatDay(bounds.start, { month: 'short', day: 'numeric' })} – ${formatDay(bounds.end, { month: 'short', day: 'numeric' })}`;
}

const AVATAR_HUES = [32, 75, 121, 155, 185, 220, 257, 302, 350];

/** Stable avatar hue for a user so the same person always gets the same colour. */
export function avatarHue(id = '') {
  let hash = 0;
  for (const character of String(id)) hash = ((hash * 31) + character.charCodeAt(0)) >>> 0;
  return AVATAR_HUES[hash % AVATAR_HUES.length];
}

export function avatar(person, size = 40, { ring = false } = {}) {
  const hue = avatarHue(person?.id || person?.name);
  const letter = person?.avatar || String(person?.name || '?').trim().slice(0, 1).toUpperCase() || '?';
  const content = person?.avatarUrl ? `<img src="${esc(person.avatarUrl)}" alt="">` : esc(letter);
  return `<span class="dz-avatar ${ring ? 'ring' : ''}" style="--hue:${hue};--size:${size}px" aria-hidden="true">${content}</span>`;
}
