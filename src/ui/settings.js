// Settings sheet (opened from the Profile gear) plus theme handling.
import { getNotificationCapability } from '../notifications.js';
import { myHabits } from '../today-domain.js';
import { getState, me, ui } from './state.js';
import { esc, icon, notify, readableError } from './util.js';
import { render } from './render.js';
import { runMutation, scheduleStateCacheWrite } from './sync.js';
import { handleNotifications } from './social.js';

const THEME_KEY = 'donezo.theme';

export function currentThemeChoice() {
  let saved = null;
  try { saved = localStorage.getItem(THEME_KEY); } catch { saved = null; }
  return ['light', 'dark'].includes(saved) ? saved : 'system';
}

export function applyTheme(choice) {
  const next = ['light', 'dark'].includes(choice) ? choice : 'system';
  if (next === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = next;
  try { localStorage.setItem(THEME_KEY, next); } catch { /* Theme still applies for this session. */ }
  const dark = next === 'dark' || (next === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#1e1b18' : '#f7f2e8');
}

const CATEGORY_LABELS = {
  due_soon: { icon: '⏱', label: 'Due soon', description: 'A useful heads-up before the clock wins.' },
  streak_risk: { icon: '🔥', label: 'Streak at risk', description: 'Only when a streak is genuinely on the line.' },
  friend_activity: { icon: '👀', label: 'Friend check-ins', description: 'See when your people show up.' },
  nudge: { icon: '⚡', label: 'Nudges', description: 'A friend is calling you out.' },
  reaction: { icon: '👏', label: 'Reactions', description: 'Someone hyped your check-in.' },
  comment: { icon: '💬', label: 'Replies', description: 'Someone left a quick reply.' },
  challenge_progress: { icon: '🏆', label: 'Challenge progress', description: 'Meaningful challenge updates.' },
};

const VIEW_TITLES = { menu: 'Settings', profile: 'Edit profile', appearance: 'Appearance', notifications: 'Notifications', social: 'Social & privacy' };

function menuRow(view, glyph, title, detail) {
  return `<button type="button" class="dz-menu-row" data-settings-view="${view}"><span class="dz-tile small" aria-hidden="true">${glyph}</span><span class="dz-row-copy"><strong>${title}</strong><small>${detail}</small></span>${icon('chevron', 16, 2.2)}</button>`;
}

function settingsViews() {
  const state = getState();
  const capability = getNotificationCapability(window);
  const preferences = state.notificationPreferences;
  const theme = currentThemeChoice();
  const categoryChoices = Object.entries(CATEGORY_LABELS).map(([value, item]) => `<label class="notification-option"><span class="notification-option-icon" aria-hidden="true">${item.icon}</span><span><strong>${item.label}</strong><small>${item.description}</small></span><span class="switch-control notification-option-toggle"><input type="checkbox" name="category" value="${value}" ${preferences.categories[value] !== false ? 'checked' : ''}><span aria-hidden="true"></span></span></label>`).join('');
  const habitChoices = myHabits(state).map((habit) => `<label class="notification-option compact"><span class="notification-option-icon" aria-hidden="true">${esc(habit.emoji)}</span><span><strong>${esc(habit.title)}</strong><small>Personal reminder</small></span><span class="switch-control notification-option-toggle"><input type="checkbox" name="habitEnabled" value="${habit.id}" ${preferences.habitOverrides[habit.id] !== false ? 'checked' : ''}><span aria-hidden="true"></span></span></label>`).join('');
  const themeButton = (value, glyph, label) => `<button type="button" role="radio" aria-checked="${theme === value}" class="${theme === value ? 'active' : ''}" data-theme-choice="${value}"><span>${glyph}</span><strong>${label}</strong></button>`;
  return {
    menu: `<div class="dz-menu">${menuRow('profile', '☺', 'Edit profile', 'Name, username, install help')}${menuRow('appearance', '◐', 'Appearance', 'System, light, or dark')}${menuRow('notifications', '◌', 'Notifications', 'Quiet hours and reminders')}${menuRow('social', '↗', 'Social & privacy', 'Awards and Baton participation')}</div><button type="button" class="dz-btn secondary full danger" id="sign-out">Sign out</button>`,
    appearance: `<section class="appearance-settings"><p class="sheet-copy">Pick what feels right. System follows your phone automatically.</p><div class="dz-segmented three" role="radiogroup" aria-label="App theme">${themeButton('system', '◐', 'System')}${themeButton('light', '☀', 'Light')}${themeButton('dark', '☾', 'Dark')}</div></section>`,
    profile: `<form id="display-name-form" class="form sheet-form"><label>Display name<input name="displayName" maxlength="60" value="${esc(me().name)}" required></label><button class="dz-btn primary full">Save name</button></form><form id="username-form" class="form sheet-form username-form"><label>Username<div class="username-input-wrap"><span aria-hidden="true">@</span><input name="username" value="${esc(String(me().handle || '').replace(/^@/, ''))}" minlength="3" maxlength="30" pattern="[A-Za-z0-9][A-Za-z0-9._]{2,29}" autocapitalize="none" autocomplete="off" spellcheck="false" required></div><small>People can find you by this.</small></label><button class="dz-btn secondary full">Save username</button></form><div class="dz-card"><strong>Install Donezo</strong><p>iPhone: Safari → Share → Add to Home Screen. Push works best from the installed app.</p></div><button type="button" class="dz-btn secondary full danger" id="sign-out">Sign out</button>`,
    notifications: `<section class="notification-settings"><div class="notification-hero"><span class="notification-hero-icon" aria-hidden="true">🔔</span><div><strong>Stay in the loop, not glued to it.</strong><small>${capability.supported ? `Push is ${capability.permission}. You control what earns a buzz.` : 'Push is not supported here. Donezo still works.'}</small></div><button class="dz-btn secondary small" type="button" id="notification-btn">${capability.permission === 'granted' ? 'Test' : 'Enable'}</button></div><form id="notification-preferences-form" class="form notification-form"><section class="notification-panel"><div class="notification-panel-head"><div><strong>Quiet hours</strong><small>Donezo shuts up while you sleep.</small></div><label class="switch-control"><input type="checkbox" name="quietHoursEnabled" ${preferences.quietHoursEnabled ? 'checked' : ''}><span aria-hidden="true"></span></label></div><div class="quiet-hours-grid"><label>From<input name="quietHoursStart" type="time" value="${esc(preferences.quietHoursStart)}"></label><label>Until<input name="quietHoursEnd" type="time" value="${esc(preferences.quietHoursEnd)}"></label></div><label class="timezone-field">Timezone<input name="timezone" value="${esc(preferences.timezone)}" maxlength="100" required><small>Uses your habit timezone so reminders land correctly.</small></label></section><section class="notification-panel"><div class="notification-panel-head"><div><strong>What can buzz you</strong><small>Keep only the stuff you would actually open.</small></div></div><div class="notification-options">${categoryChoices}</div></section>${habitChoices ? `<section class="notification-panel"><div class="notification-panel-head"><div><strong>Habit reminders</strong><small>Mute individual habits without muting Donezo.</small></div></div><div class="notification-options">${habitChoices}</div></section>` : ''}<button class="dz-btn primary full" ${ui.busy ? 'disabled' : ''}>Save notifications</button></form></section>`,
    social: `<form id="social-preferences-form" class="form settings-social-form"><label class="preference-check"><input type="checkbox" name="recapAwardsEnabled" ${me().awardOptOut ? '' : 'checked'}><span><strong>Named recap awards</strong><small>Let your friends include your name in weekly and monthly awards.</small></span></label><label class="preference-check"><input type="checkbox" name="batonEnabled" ${state.batonOptedOut ? '' : 'checked'}><span><strong>Friend Baton</strong><small>Friends can pass you the next turn. No penalty if it expires.</small></span></label><button class="dz-btn primary full" ${ui.busy ? 'disabled' : ''}>Save social settings</button></form>`,
  };
}

export function settingsSheet() {
  if (!ui.settingsSheetOpen) return '';
  const views = settingsViews();
  const view = views[ui.settingsView] ? ui.settingsView : 'menu';
  const back = view === 'menu' ? '' : `<button class="dz-link back" type="button" data-settings-back>‹ Settings</button>`;
  return `<div class="sheet-backdrop" data-close-sheet><section class="sheet dz-sheet settings-sheet" role="dialog" aria-modal="true" aria-label="Settings" data-sheet><div class="sheet-handle"></div><div class="sheet-head"><div>${back}<h2>${VIEW_TITLES[view]}</h2></div><button class="icon-btn" type="button" data-close-settings aria-label="Close">×</button></div>${views[view]}</section></div>`;
}

async function handleUsernameSubmit(event) {
  event.preventDefault();
  const input = event.currentTarget.querySelector('[name="username"]');
  const submit = event.currentTarget.querySelector('button[type="submit"], button:not([type])');
  const raw = String(input?.value || '').trim();
  if (ui.networkBootLoading || !ui.authoritativeReady) {
    notify('Refreshing your latest data…', 2200);
    return;
  }
  if (!ui.online) {
    notify('You are offline. Nothing was saved yet.', 3200);
    return;
  }
  if (submit) {
    submit.disabled = true;
    submit.dataset.originalLabel = submit.textContent;
    submit.textContent = 'Saving…';
  }
  try {
    const saved = await ui.repo.setMyUsername(raw);
    if (input) input.value = saved;
    scheduleStateCacheWrite();
    notify(`Username saved · @${saved}`);
  } catch (error) {
    notify(readableError(error), 3600);
    input?.focus({ preventScroll: true });
    input?.select?.();
  } finally {
    if (submit) {
      submit.disabled = false;
      submit.textContent = submit.dataset.originalLabel || 'Save username';
      delete submit.dataset.originalLabel;
    }
  }
}

async function handleDisplayName(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const displayName = String(form.get('displayName'));
  await runMutation(() => ui.repo.updateDisplayName(displayName), 'Name updated ✍️');
}

async function handleNotificationPreferences(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const enabledCategories = new Set(form.getAll('category').map(String));
  const enabledHabits = new Set(form.getAll('habitEnabled').map(String));
  const categoryNames = Object.keys(CATEGORY_LABELS);
  const input = {
    quietHoursEnabled: form.has('quietHoursEnabled'),
    quietHoursStart: String(form.get('quietHoursStart') || '22:00'),
    quietHoursEnd: String(form.get('quietHoursEnd') || '08:00'),
    timezone: String(form.get('timezone') || me().timeZone || 'UTC'),
    categories: Object.fromEntries(categoryNames.map((category) => [category, enabledCategories.has(category)])),
    habitOverrides: Object.fromEntries(myHabits(getState()).map((habit) => [habit.id, enabledHabits.has(habit.id)])),
  };
  await runMutation(async () => {
    await ui.repo.saveNotificationPreferences(input);
    return true;
  }, 'Notification settings saved');
}

async function handleSocialPreferences(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const recapEnabled = form.has('recapAwardsEnabled');
  const batonEnabled = form.has('batonEnabled');
  await runMutation(async () => {
    await ui.repo.setRecapAwardsEnabled(recapEnabled);
    await ui.repo.setBatonEnabled(batonEnabled);
    return true;
  }, 'Social settings saved');
}

export function bindSettings(root) {
  root.querySelectorAll('[data-settings]').forEach((element) => { element.onclick = () => { ui.settingsView = 'menu'; ui.settingsSheetOpen = true; render(); }; });
  root.querySelectorAll('[data-settings-view]').forEach((element) => { element.onclick = () => { ui.settingsView = element.dataset.settingsView; render(); }; });
  root.querySelectorAll('[data-settings-back]').forEach((element) => { element.onclick = () => { ui.settingsView = 'menu'; render(); }; });
  root.querySelectorAll('[data-theme-choice]').forEach((element) => { element.onclick = () => { applyTheme(element.dataset.themeChoice); render(); }; });
  root.querySelectorAll('[data-close-settings]').forEach((element) => { element.onclick = () => {
    if (ui.settingsView !== 'menu') ui.settingsView = 'menu';
    else ui.settingsSheetOpen = false;
    render();
  }; });
  root.querySelector('#display-name-form')?.addEventListener('submit', handleDisplayName);
  root.querySelector('#username-form')?.addEventListener('submit', handleUsernameSubmit);
  root.querySelector('#notification-preferences-form')?.addEventListener('submit', handleNotificationPreferences);
  root.querySelector('#social-preferences-form')?.addEventListener('submit', handleSocialPreferences);
  root.querySelector('#notification-btn')?.addEventListener('click', handleNotifications);
}
