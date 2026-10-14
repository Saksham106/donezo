// Habit editor sheet: add, edit, schedule, audience, pause and archive.
import { app, checkInFor, friendList, getState, me, member, setActiveTab, ui } from './state.js';
import { esc, notify } from './util.js';
import { render } from './render.js';
import { runMutation } from './sync.js';

const starterTemplates = [
  { title: 'Move for 20 minutes', emoji: '🏃', targetTime: '18:00' },
  { title: 'Read 10 pages', emoji: '📚', targetTime: '21:00' },
  { title: 'No phone after 10', emoji: '📵', targetTime: '22:00' },
];

export function habitAudience(habit, state = getState()) {
  const friendIds = friendList(state).map((friend) => friend.id).filter((id) => id !== state?.currentUserId);
  const rawIds = habit?.audienceIds || habit?.selectedFriendIds || habit?.friendIds || [];
  const legacyIds = habit?.squadIds || [];
  const rawMode = habit?.audienceMode || habit?.audience;
  const mode = ['all_friends', 'selected_friends', 'only_me'].includes(rawMode)
    ? rawMode
    : legacyIds.length ? 'selected_friends' : 'all_friends';
  const audienceIds = new Set((rawIds.length ? rawIds : legacyIds).filter((id) => friendIds.includes(id)));
  return { friendIds, mode, audienceIds };
}

export function openHabitEditor(habitId = null) {
  const state = getState();
  const habit = habitId ? state.habits.find((item) => item.id === habitId && item.ownerId === state.currentUserId && item.active) : null;
  if (habitId && !habit) return;
  ui.editingHabitId = habit?.id || null;
  ui.selectedEmoji = habit?.emoji || '⚡';
  ui.habitSheetOpen = true;
  render();
}

export function habitSheet() {
  if (!ui.habitSheetOpen) return '';
  const state = getState();
  const emojis = ['⚡', '🏃', '🏋️', '📚', '🧠', '📵'];
  const editing = ui.editingHabitId
    ? state.habits.find((habit) => habit.id === ui.editingHabitId && habit.ownerId === state.currentUserId && habit.active)
    : null;
  const editMode = Boolean(editing);
  const title = editing?.title || '';
  const targetTime = editMode ? (editing.targetTime ?? '') : '20:00';
  const proofMode = editing?.proofMode || 'photo';
  const scheduleFrequency = editing?.scheduleFrequency || editing?.frequency || 'daily';
  const scheduleWeekdays = new Set(editing?.scheduleWeekdays || []);
  const weeklyTargetDays = Number(editing?.weeklyTargetDays ?? 4);
  const targetQuantity = editing?.targetQuantity ?? 1;
  const targetUnit = editing?.targetUnit || 'count';
  const graceMinutes = editing?.graceMinutes || 0;
  const scheduleTimezone = editing?.scheduleTimezone || me()?.timeZone || 'UTC';
  const weekdays = [['S', 0], ['M', 1], ['T', 2], ['W', 3], ['T', 4], ['F', 5], ['S', 6]];
  const { friendIds, mode: audienceMode, audienceIds } = habitAudience(editing, state);
  const busy = ui.busy;
  const pauseList = editing?.pauseWindows?.length
    ? `<div class="pause-list">${editing.pauseWindows.map((pause) => `<small>Paused ${esc(pause.startDate)} to ${esc(pause.endDate)}${pause.reason ? ` · ${esc(pause.reason)}` : ''}</small>`).join('')}</div>`
    : '';
  const pauseForm = editMode ? `<section class="schedule-pause"><button class="pause-disclosure" type="button" data-toggle-habit-pause aria-expanded="false" aria-controls="habit-pause-panel"><span>Pause for travel or a break</span><svg class="pause-chevron" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg></button>${pauseList}<div id="habit-pause-panel" data-habit-pause-panel hidden><form id="pause-form" class="form"><div class="pause-date-grid"><label>From<input name="startDate" type="date" required></label><label>Through<input name="endDate" type="date" required></label></div><label>Note (optional)<input name="reason" maxlength="280" placeholder="Vacation, sick, deload…"></label><button class="btn full" ${busy ? 'disabled' : ''}>Add pause</button></form></div></section>` : '';
  const friendChoices = friendIds.map((friendId) => {
    const friend = member(friendId);
    return `<label class="friend-audience-option"><input type="checkbox" name="audienceIds" value="${esc(friendId)}" ${audienceIds.has(friendId) ? 'checked' : ''} ${audienceMode === 'selected_friends' ? '' : 'disabled'}><span><strong>${esc(friend?.name || 'Friend')}</strong><small>Can see proof and join the conversation</small></span></label>`;
  }).join('');
  const legacySquadIds = (editing?.squadIds || state?.circles?.map((circle) => circle.id) || []).join(',');
  const audienceChoices = `<fieldset class="friend-audience"><legend>Who can see this?</legend><p>Pick who gets the proof, reactions, and replies.</p><div class="audience-mode-grid"><label class="audience-mode-card"><input type="radio" name="audienceMode" value="all_friends" ${audienceMode === 'all_friends' ? 'checked' : ''}><span class="audience-mode-icon" aria-hidden="true">👥</span><span><strong>All friends</strong><small>Everyone connected</small></span></label><label class="audience-mode-card"><input type="radio" name="audienceMode" value="selected_friends" ${audienceMode === 'selected_friends' ? 'checked' : ''}><span class="audience-mode-icon" aria-hidden="true">◎</span><span><strong>Selected</strong><small>You choose who</small></span></label><label class="audience-mode-card"><input type="radio" name="audienceMode" value="only_me" ${audienceMode === 'only_me' ? 'checked' : ''}><span class="audience-mode-icon" aria-hidden="true">🔒</span><span><strong>Only me</strong><small>Keep it private</small></span></label></div><div class="friend-audience-list" data-friend-audience-list ${audienceMode === 'selected_friends' ? '' : 'hidden'}>${friendChoices || '<small class="settings-empty">Add a friend to share proof with them.</small>'}</div></fieldset><input type="hidden" name="squadIds" value="${esc(legacySquadIds)}">`;
  const archiveArea = editMode ? `<button class="btn danger-soft full archive-btn" type="button" data-archive-habit ${busy ? 'disabled' : ''}>Archive habit</button>` : '';
  return `<div class="sheet-backdrop" data-close-sheet><section class="sheet ${editMode ? 'habit-edit-sheet' : ''}" role="dialog" aria-modal="true" aria-label="${editMode ? 'Edit habit' : 'Add habit'}" data-sheet><div class="sheet-handle"></div><div class="sheet-head"><div><p class="eyebrow">HABIT SETTINGS</p><h2>${editMode ? 'Edit habit' : 'Add a habit'}</h2></div><button class="icon-btn" type="button" data-close-habit aria-label="Close">×</button></div><form id="habit-form" class="form sheet-form">${editMode ? '' : `<div class="starter-templates"><span>Quick start</span>${starterTemplates.map((template, index) => `<button type="button" data-template="${index}">${template.emoji} ${esc(template.title)}</button>`).join('')}</div>`}<label>Habit name<input name="title" maxlength="80" placeholder="Run 1 mile" value="${esc(title)}" required></label><label>Icon<div class="emoji-row">${emojis.map((emoji) => `<button type="button" data-emoji="${emoji}" aria-pressed="${emoji === ui.selectedEmoji}" class="emoji ${emoji === ui.selectedEmoji ? 'selected' : ''}">${emoji}</button>`).join('')}</div></label><fieldset class="schedule-fields"><legend>When does this count?</legend><label>Schedule<select name="scheduleFrequency"><option value="daily" ${scheduleFrequency === 'daily' ? 'selected' : ''}>Every day</option><option value="selected_weekdays" ${scheduleFrequency === 'selected_weekdays' ? 'selected' : ''}>Specific days</option><option value="times_per_week" ${scheduleFrequency === 'times_per_week' ? 'selected' : ''}>X times per week</option><option value="weekly" ${scheduleFrequency === 'weekly' ? 'selected' : ''}>Once a week</option></select></label><div data-weekly-target ${scheduleFrequency === 'times_per_week' ? '' : 'hidden'}><label>Days per week<select name="weeklyTargetDays" ${scheduleFrequency === 'times_per_week' ? '' : 'disabled'}>${[1, 2, 3, 4, 5, 6, 7].map((day) => `<option value="${day}" ${weeklyTargetDays === day ? 'selected' : ''}>${day} ${day === 1 ? 'day' : 'days'}</option>`).join('')}</select></label><small>Any distinct days count Monday–Sunday. Your first official week starts next Monday.</small></div><div data-schedule-weekdays ${['selected_weekdays', 'weekly'].includes(scheduleFrequency) ? '' : 'hidden'}><span class="field-label">Days</span><div class="weekday-row">${weekdays.map(([label, day]) => `<label title="${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][day]}"><input type="checkbox" name="scheduleWeekdays" value="${day}" ${scheduleWeekdays.has(day) ? 'checked' : ''}><span>${label}</span></label>`).join('')}</div><small>Pick the exact days. For once-a-week habits, the first picked day is the due day.</small></div><div class="form-grid"><label>Amount<input name="targetQuantity" type="number" min="0.01" step="any" value="${esc(targetQuantity)}" required></label><label>Unit<input name="targetUnit" maxlength="40" value="${esc(targetUnit)}" placeholder="pages, minutes" required></label></div><div class="form-grid"><label>Due time<input name="targetTime" type="time" value="${esc(targetTime)}"></label><label>Grace<select name="graceMinutes"><option value="0" ${graceMinutes === 0 ? 'selected' : ''}>None</option><option value="30" ${graceMinutes === 30 ? 'selected' : ''}>30 min</option><option value="60" ${graceMinutes === 60 ? 'selected' : ''}>1 hour</option><option value="120" ${graceMinutes === 120 ? 'selected' : ''}>2 hours</option></select></label></div><small>Timezone: ${esc(scheduleTimezone)}</small></fieldset><input type="hidden" name="scheduleTimezone" value="${esc(scheduleTimezone)}"><label>Proof<select name="proofMode"><option value="photo" ${proofMode === 'photo' ? 'selected' : ''}>Photo proof</option><option value="none" ${proofMode === 'none' ? 'selected' : ''}>Truuust me</option></select></label>${audienceChoices}${editMode ? '' : `<button class="btn primary full" ${busy ? 'disabled' : ''}>Add habit</button>`}</form>${editMode ? `<div class="habit-save-dock" data-habit-save-dock hidden><button class="btn primary full" type="submit" form="habit-form" ${busy ? 'disabled' : ''}>Save changes</button></div>` : ''}${pauseForm}<div class="habit-sheet-actions">${archiveArea}<button class="text-btn" type="button" data-cancel-habit ${busy ? 'disabled' : ''}>Cancel</button></div></section></div>`;
}

function closeHabitEditor() {
  ui.habitSheetOpen = false;
  ui.editingHabitId = null;
  ui.selectedEmoji = '⚡';
  render();
}

function markHabitDirty() {
  if (!ui.editingHabitId) return;
  const dock = app.querySelector('[data-habit-save-dock]');
  if (dock) dock.hidden = false;
}

function syncHabitScheduleFields(habitForm) {
  if (!habitForm) return;
  const frequency = habitForm.elements.scheduleFrequency?.value || 'daily';
  const weeklyTarget = habitForm.querySelector('[data-weekly-target]');
  const weekdays = habitForm.querySelector('[data-schedule-weekdays]');
  if (weeklyTarget) weeklyTarget.hidden = frequency !== 'times_per_week';
  if (weekdays) weekdays.hidden = !['selected_weekdays', 'weekly'].includes(frequency);
  if (habitForm.elements.weeklyTargetDays) habitForm.elements.weeklyTargetDays.disabled = frequency !== 'times_per_week';
}

async function handleHabitSubmit(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const scheduleFrequency = String(form.get('scheduleFrequency') || 'daily');
  const audienceMode = String(form.get('audienceMode') || 'all_friends');
  const input = {
    title: String(form.get('title')),
    emoji: ui.selectedEmoji,
    frequency: scheduleFrequency,
    scheduleFrequency,
    scheduleWeekdays: ['selected_weekdays', 'weekly'].includes(scheduleFrequency) ? form.getAll('scheduleWeekdays').map(Number).sort((a, b) => a - b) : [],
    weeklyTargetDays: Number(form.get('weeklyTargetDays') || 1),
    targetQuantity: Number(form.get('targetQuantity') || 1),
    targetUnit: String(form.get('targetUnit') || 'count'),
    targetTime: String(form.get('targetTime') || ''),
    graceMinutes: Number(form.get('graceMinutes') || 0),
    scheduleTimezone: String(form.get('scheduleTimezone') || me()?.timeZone || 'UTC'),
    proofMode: String(form.get('proofMode')),
    audienceMode,
    audienceIds: audienceMode === 'selected_friends' ? [...new Set(form.getAll('audienceIds').map(String).filter(Boolean))] : [],
    squadIds: [...new Set(form.getAll('squadIds').flatMap((value) => String(value).split(',').map((id) => id.trim()).filter(Boolean)))],
  };
  if (input.scheduleFrequency === 'selected_weekdays' && !input.scheduleWeekdays.length) {
    notify('Pick at least one day for this schedule', 3200);
    return;
  }
  if (input.scheduleFrequency === 'times_per_week' && (!Number.isInteger(input.weeklyTargetDays) || input.weeklyTargetDays < 1 || input.weeklyTargetDays > 7)) {
    notify('Choose between 1 and 7 days per week', 3200);
    return;
  }
  if (input.audienceMode === 'selected_friends' && !input.audienceIds.length) {
    notify('Pick at least one friend for this habit', 3200);
    return;
  }
  const habitId = ui.editingHabitId;
  if (habitId && checkInFor(habitId)) {
    const existing = getState().habits.find((habit) => habit.id === habitId);
    const scheduleChanged = existing && (
      input.scheduleFrequency !== (existing.scheduleFrequency || existing.frequency || 'daily')
      || input.scheduleWeekdays.join(',') !== (existing.scheduleWeekdays || []).join(',')
      || input.weeklyTargetDays !== Number(existing.weeklyTargetDays ?? 1)
      || input.targetQuantity !== Number(existing.targetQuantity ?? 1)
      || input.targetUnit.trim() !== (existing.targetUnit || 'count')
      || input.targetTime !== (existing.targetTime || '')
      || input.graceMinutes !== Number(existing.graceMinutes || 0)
      || input.scheduleTimezone !== (existing.scheduleTimezone || existing.ownerTimeZone || me()?.timeZone || 'UTC')
    );
    if (scheduleChanged) {
      notify("Today's check-in already uses the current schedule. Change it tomorrow or undo today's check-in first.", 4200);
      return;
    }
  }
  const submitButtons = [...event.currentTarget.querySelectorAll('button[type="submit"], button:not([type])'), ...app.querySelectorAll('[data-habit-save-dock] button[type="submit"]')];
  submitButtons.forEach((button) => {
    button.disabled = true;
    button.dataset.originalLabel = button.textContent;
    button.textContent = 'Saving…';
  });
  const result = habitId
    ? await runMutation(() => ui.repo.updateHabit(habitId, input), 'Habit saved', { preserveDraft: true })
    : await runMutation(() => ui.repo.addHabit(input), `${ui.selectedEmoji} ${input.title.trim()} added. Now actually do it.`, { preserveDraft: true });
  if (!result) {
    submitButtons.forEach((button) => {
      button.disabled = false;
      button.textContent = button.dataset.originalLabel || 'Save changes';
      delete button.dataset.originalLabel;
    });
    markHabitDirty();
    return;
  }
  if (!habitId) setActiveTab('profile');
  closeHabitEditor();
}

async function handlePauseSubmit(event) {
  event.preventDefault();
  const habitId = ui.editingHabitId;
  if (!habitId) return;
  const form = new FormData(event.currentTarget);
  const startDate = String(form.get('startDate') || '');
  const endDate = String(form.get('endDate') || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate) || startDate > endDate) {
    notify('Through must be on or after From', 3200);
    return;
  }
  const editing = getState().habits.find((habit) => habit.id === habitId);
  if ((editing?.pauseWindows || []).some((pause) => startDate <= pause.endDate && endDate >= pause.startDate)) {
    notify('That pause overlaps an existing pause', 3200);
    return;
  }
  const result = await runMutation(() => ui.repo.pauseHabit(habitId, { startDate, endDate, reason: String(form.get('reason') || '') }), 'Pause saved. No guilt tax.');
  if (result) render();
}

async function handleArchiveRequest() {
  const habitId = ui.editingHabitId;
  if (ui.busy || !habitId) return;
  const result = await runMutation(() => ui.repo.archiveHabit(habitId));
  if (!result) return;
  closeHabitEditor();
  notify('Habit archived', 5000, { action: { label: 'Undo', onClick: () => runMutation(() => ui.repo.restoreHabit(habitId), 'Habit restored') } });
}

function selectEmoji(emoji) {
  ui.selectedEmoji = emoji;
  app.querySelectorAll('[data-emoji]').forEach((button) => {
    const selected = button.dataset.emoji === emoji;
    button.classList.toggle('selected', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
}

export function bindHabits(root) {
  root.querySelectorAll('[data-open-habit]').forEach((element) => { element.onclick = () => openHabitEditor(); });
  root.querySelectorAll('[data-edit-habit]').forEach((element) => { element.onclick = () => openHabitEditor(element.dataset.editHabit); });
  const habitForm = root.querySelector('#habit-form');
  if (!habitForm) return;
  root.querySelectorAll('[data-close-habit], [data-cancel-habit]').forEach((element) => { element.onclick = closeHabitEditor; });
  root.querySelectorAll('[data-emoji]').forEach((element) => { element.onclick = () => { selectEmoji(element.dataset.emoji); markHabitDirty(); }; });
  root.querySelectorAll('[data-template]').forEach((element) => { element.onclick = () => {
    const template = starterTemplates[Number(element.dataset.template)];
    if (!template) return;
    habitForm.elements.title.value = template.title;
    habitForm.elements.targetTime.value = template.targetTime;
    selectEmoji(template.emoji);
  }; });
  habitForm.addEventListener('submit', handleHabitSubmit);
  habitForm.addEventListener('input', markHabitDirty);
  habitForm.addEventListener('change', markHabitDirty);
  const audienceList = habitForm.querySelector('[data-friend-audience-list]');
  const syncAudienceControls = () => {
    const selectedMode = (habitForm.querySelector('[name="audienceMode"]:checked')?.value || 'all_friends') === 'selected_friends';
    if (audienceList) audienceList.hidden = !selectedMode;
    audienceList?.querySelectorAll('[name="audienceIds"]').forEach((checkbox) => {
      if (!selectedMode) checkbox.checked = false;
      checkbox.disabled = !selectedMode;
    });
  };
  habitForm.querySelectorAll('[name="audienceMode"]').forEach((radio) => radio.addEventListener('change', syncAudienceControls));
  syncAudienceControls();
  const scheduleSelect = habitForm.elements.scheduleFrequency;
  let previousScheduleValue = scheduleSelect?.value;
  syncHabitScheduleFields(habitForm);
  scheduleSelect?.addEventListener('change', () => {
    if (scheduleSelect.value === 'daily') habitForm.querySelectorAll('[name="scheduleWeekdays"]').forEach((checkbox) => { checkbox.checked = true; });
    else if (previousScheduleValue === 'daily') habitForm.querySelectorAll('[name="scheduleWeekdays"]').forEach((checkbox) => { checkbox.checked = false; });
    previousScheduleValue = scheduleSelect.value;
    syncHabitScheduleFields(habitForm);
  });
  habitForm.querySelectorAll('[name="scheduleWeekdays"]').forEach((checkbox) => { checkbox.addEventListener('change', () => {
    if (checkbox.checked && scheduleSelect) scheduleSelect.value = 'selected_weekdays';
    syncHabitScheduleFields(habitForm);
  }); });
  root.querySelector('[data-toggle-habit-pause]')?.addEventListener('click', (event) => {
    const button = event.currentTarget;
    const panel = root.querySelector('[data-habit-pause-panel]');
    if (!panel) return;
    const expanded = button.getAttribute('aria-expanded') === 'true';
    button.setAttribute('aria-expanded', String(!expanded));
    panel.hidden = expanded;
  });
  root.querySelector('#pause-form')?.addEventListener('submit', handlePauseSubmit);
  root.querySelector('[data-archive-habit]')?.addEventListener('click', handleArchiveRequest);
}
