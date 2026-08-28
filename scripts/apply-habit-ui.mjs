import { readFile, writeFile } from 'node:fs/promises';

const appPath = 'src/app.js';
const cssPath = 'social.css';
let app = await readFile(appPath, 'utf8');
let css = await readFile(cssPath, 'utf8');

if (app.includes('editingHabitId') && app.includes('data-confirm-archive')) {
  console.log('Habit UI changes already applied.');
  process.exit(0);
}

function replaceOnce(search, replacement, label) {
  if (!app.includes(search)) throw new Error(`${label}: source pattern not found`);
  app = app.replace(search, replacement);
}

replaceOnce(
`let habitSheetOpen = false;
let settingsSheetOpen = false;`,
`let habitSheetOpen = false;
let editingHabitId = null;
let archiveConfirm = false;
let settingsSheetOpen = false;`,
'habit editor state',
);

replaceOnce(
`function habitSettingsRow(habit) {
  return \`<div class="habit-setting"><span>\${esc(habit.emoji)}</span><div><strong>\${esc(habit.title)}</strong><small>\${esc(formatTime(habit.targetTime))}\${habit.proofMode === 'photo' ? ' · Photo proof' : ' · Truuust mode'}</small></div></div>\`;
}`,
`function habitSettingsRow(habit) {
  return \`<button type="button" class="habit-setting habit-setting-button" data-edit-habit="\${habit.id}" aria-label="Edit \${esc(habit.title)}"><span>\${esc(habit.emoji)}</span><div><strong>\${esc(habit.title)}</strong><small>\${esc(formatTime(habit.targetTime))}\${habit.proofMode === 'photo' ? ' · Photo proof' : ' · Truuust mode'}</small></div><span class="setting-chevron" aria-hidden="true">›</span></button>\`;
}`,
'habit row button',
);

const sheetPattern = /function habitSheet\(\) \{[\s\S]*?\n\}\n\nfunction settingsSheet/;
if (!sheetPattern.test(app)) throw new Error('habit sheet block not found');
app = app.replace(sheetPattern, `function habitSheet() {
  if (!habitSheetOpen) return '';
  const emojis = ['⚡', '🏃', '🏋️', '📚', '🧠', '📵'];
  const editing = editingHabitId
    ? getState().habits.find((habit) => habit.id === editingHabitId && habit.ownerId === getState().currentUserId && habit.active)
    : null;
  const editMode = Boolean(editing);
  const title = editing?.title || '';
  const targetTime = editing?.targetTime || '20:00';
  const proofMode = editing?.proofMode || 'photo';
  const archiveArea = editMode
    ? archiveConfirm
      ? \`<div class="archive-confirm" role="alert"><strong>Archive this habit?</strong><p>It disappears from Today and Check In, but your old check-ins stay in history.</p><div><button class="btn danger-soft" type="button" data-confirm-archive \${busy ? 'disabled' : ''}>Yes, archive it</button><button class="btn" type="button" data-cancel-archive \${busy ? 'disabled' : ''}>Keep habit</button></div></div>\`
      : \`<button class="btn danger-soft full archive-btn" type="button" data-archive-habit \${busy ? 'disabled' : ''}>Archive habit</button>\`
    : '';
  return \`<div class="sheet-backdrop" data-close-sheet><section class="sheet" role="dialog" aria-modal="true" aria-label="\${editMode ? 'Edit habit' : 'Add habit'}" data-sheet><div class="sheet-handle"></div><div class="sheet-head"><div><p class="eyebrow">HABIT SETTINGS</p><h2>\${editMode ? 'Edit habit' : 'Add a habit'}</h2></div><button class="icon-btn" type="button" data-close-habit aria-label="Close">×</button></div><form id="habit-form" class="form sheet-form"><label>Habit name<input name="title" maxlength="80" placeholder="Run 1 mile" value="\${esc(title)}" required autofocus></label><label>Icon<div class="emoji-row">\${emojis.map((emoji) => \`<button type="button" data-emoji="\${emoji}" class="emoji \${emoji === selectedEmoji ? 'selected' : ''}">\${emoji}</button>\`).join('')}</div></label><label>Target time<input name="targetTime" type="time" value="\${esc(targetTime)}"></label><label>Proof<select name="proofMode"><option value="photo" \${proofMode === 'photo' ? 'selected' : ''}>Photo / screenshot</option><option value="none" \${proofMode === 'none' ? 'selected' : ''}>Truuust me</option></select></label><button class="btn primary full" \${busy ? 'disabled' : ''}>\${editMode ? 'Save changes' : 'Add habit'}</button></form><div class="habit-sheet-actions">\${archiveArea}<button class="text-btn" type="button" data-cancel-habit \${busy ? 'disabled' : ''}>Cancel</button></div></section></div>\`;
}

function settingsSheet`);

replaceOnce(
`  app.querySelectorAll('[data-open-habit]').forEach((element) => { element.onclick = () => { habitSheetOpen = true; render(); }; });`,
`  app.querySelectorAll('[data-open-habit]').forEach((element) => { element.onclick = () => { editingHabitId = null; archiveConfirm = false; selectedEmoji = '⚡'; habitSheetOpen = true; render(); }; });
  app.querySelectorAll('[data-edit-habit]').forEach((element) => { element.onclick = () => { const habit = getState().habits.find((item) => item.id === element.dataset.editHabit && item.ownerId === getState().currentUserId && item.active); if (!habit) return; editingHabitId = habit.id; archiveConfirm = false; selectedEmoji = habit.emoji; habitSheetOpen = true; render(); }; });`,
'habit open bindings',
);

replaceOnce(
`  app.querySelector('#habit-form')?.addEventListener('submit', handleAdd);`,
`  app.querySelector('#habit-form')?.addEventListener('submit', handleHabitSubmit);
  app.querySelector('[data-archive-habit]')?.addEventListener('click', handleArchiveRequest);
  app.querySelector('[data-confirm-archive]')?.addEventListener('click', handleArchiveConfirm);
  app.querySelector('[data-cancel-archive]')?.addEventListener('click', () => { archiveConfirm = false; render(); });
  app.querySelector('[data-cancel-habit]')?.addEventListener('click', closeHabitEditor);`,
'habit form bindings',
);

replaceOnce(
`  habitSheetOpen = false;
  settingsSheetOpen = false;`,
`  habitSheetOpen = false;
  editingHabitId = null;
  archiveConfirm = false;
  settingsSheetOpen = false;`,
'close sheet reset',
);

const handlerPattern = /async function handleAdd\(event\) \{[\s\S]*?\n\}\n\nasync function handleNudgeSubmit/;
if (!handlerPattern.test(app)) throw new Error('handleAdd block not found');
app = app.replace(handlerPattern, `function closeHabitEditor() {
  habitSheetOpen = false;
  editingHabitId = null;
  archiveConfirm = false;
  selectedEmoji = '⚡';
  render();
}

async function handleHabitSubmit(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const input = {
    title: String(form.get('title')),
    emoji: selectedEmoji,
    targetTime: String(form.get('targetTime') || ''),
    proofMode: String(form.get('proofMode')),
  };
  const habitId = editingHabitId;
  const result = habitId
    ? await runMutation(() => repo.updateHabit(habitId, input), 'Habit saved')
    : await runMutation(() => repo.addHabit({ ...input, frequency: 'daily' }), \`\${selectedEmoji} \${input.title.trim()} added. Now actually do it.\`);
  if (!result) return;
  closeHabitEditor();
  if (!habitId) tab = 'checkin';
  render();
}

function handleArchiveRequest() {
  if (busy || !editingHabitId) return;
  archiveConfirm = true;
  render();
}

async function handleArchiveConfirm() {
  const habitId = editingHabitId;
  if (!habitId) return;
  const result = await runMutation(() => repo.archiveHabit(habitId), 'Habit archived');
  if (!result) return;
  closeHabitEditor();
}

async function handleNudgeSubmit`);

if (!css.includes('.habit-setting-button')) {
  css += `\n.habit-setting-button{width:100%;grid-template-columns:2rem minmax(0,1fr) auto;border:var(--rule-hairline) solid var(--color-rule);background:var(--color-surface);color:var(--color-ink);text-align:left;cursor:pointer}.habit-setting-button:hover{border-color:var(--color-rule-strong);background:var(--color-paper-2)}.setting-chevron{align-self:center;color:var(--color-muted);font-size:1.4rem;line-height:1}.habit-sheet-actions{display:grid;gap:var(--space-2);margin-top:var(--space-4)}.archive-btn{margin-top:var(--space-2)}.archive-confirm{padding:var(--space-4);border:var(--rule-hairline) solid color-mix(in oklch,var(--color-coral) 35%,var(--color-rule));border-radius:var(--radius-md);background:var(--color-coral-soft)}.archive-confirm strong{display:block;color:var(--color-coral-ink)}.archive-confirm p{margin:.35rem 0 var(--space-3);color:var(--color-muted);font-size:var(--text-xs);line-height:1.45}.archive-confirm>div{display:grid;grid-template-columns:1fr 1fr;gap:var(--space-2)}@media(max-width:374px){.archive-confirm>div{grid-template-columns:1fr}}\n`;
}

await writeFile(appPath, app);
await writeFile(cssPath, css);
