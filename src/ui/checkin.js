// Check In overlay: caught-up sheet, due-habit picker, and the proof flow
// (source → crop → review → upload). It opens over the current tab, so the
// tab underneath keeps its scroll position.
import { MAX_PROOF_BYTES, compressProofFile, createProofReviewState, formatProofFileSize, imageFileFromPasteData, readClipboardImage, requiresPhotoProof, transitionProofReview, validateProofFile } from '../proof.js';
import { composeDualProof, createDualProofState, setDualProofFile } from '../dual-proof.js';
import { cropProofFile, inspectProofFile } from '../proof-crop.js';
import { contextualHabitStatus } from '../ux.js';
import { actionableHabitsFor, completedHabitsFor, flexibleWeekProgress, missedHabits, sortHabitsForDay } from '../today-domain.js';
import { app, checkInFor, getState, inputs, me, today, ui } from './state.js';
import { esc, haptic, icon, notify, readableError } from './util.js';
import { render, renderPreservingScroll } from './render.js';
import { dataNotReady, runMutation, runOptimisticMutation } from './sync.js';
import { openRecovery } from './social.js';
import { openHabitEditor } from './habits.js';

function habitSubtitle(habit, date = today()) {
  const state = getState();
  const checkIn = checkInFor(habit.id, me()?.id, date);
  if (checkIn?.invalid) return 'Proof needs another try';
  const weekly = flexibleWeekProgress(habit, date, state);
  const proof = habit.proofMode === 'photo' ? 'photo proof' : 'honor system';
  if (weekly) return weekly.startsNextMonday ? `Goal starts next Monday · ${proof}` : `${weekly.completed} of ${weekly.possible} this week · ${proof}`;
  const timing = contextualHabitStatus({ ...habit, completedAt: null, invalid: false }, { date });
  return `${timing} · ${proof}`;
}

function dueToday() {
  const state = getState();
  return sortHabitsForDay(actionableHabitsFor(state.currentUserId, today(), state), state, state.currentUserId, today());
}

/** The center Check In button: 0 due → caught up, 1 due → straight in, 2+ → picker. */
export function openCheckIn() {
  if (!getState()) return;
  const due = dueToday();
  const misses = missedHabits(getState(), today());
  if (!due.length && !misses.length) {
    ui.checkInOverlay = 'caught-up';
    render();
    return;
  }
  if (due.length === 1 && !misses.length) {
    void handleHabit(due[0].id);
    return;
  }
  ui.checkInOverlay = 'picker';
  render();
}

export function closeCheckInOverlay() {
  ui.checkInOverlay = null;
}

function caughtUpSheet() {
  return `<div class="sheet-backdrop" data-close-sheet><section class="sheet compact-sheet dz-sheet dz-caught-up" role="dialog" aria-modal="true" aria-label="All caught up" data-sheet><div class="sheet-handle"></div><span class="dz-caught-up-mark">${icon('check', 28, 2.6)}</span><h2>All caught up</h2><p>Everything due today is done.</p><button class="dz-btn secondary full" type="button" data-checkin-add-habit>Add a habit</button></section></div>`;
}

function pickerSheet() {
  const state = getState();
  const due = dueToday();
  const misses = missedHabits(state, today());
  const doneToday = completedHabitsFor(state.currentUserId, today(), state);
  const rows = due.map((habit) => {
    const photo = habit.proofMode === 'photo';
    return `<button type="button" class="dz-pick-row" data-habit="${habit.id}" ${ui.busy ? 'disabled' : ''}><span class="dz-tile">${esc(habit.emoji)}</span><span class="dz-row-copy"><strong>${esc(habit.title)}</strong><small>${esc(habitSubtitle(habit))}</small></span><span class="dz-pick-mark ${photo ? 'photo' : 'tick'}" aria-label="${photo ? 'Photo proof' : 'Check in'}">${photo ? icon('camera', 17, 2.1) : ''}</span></button>`;
  }).join('');
  const bounceRows = misses.map((habit) => `<button type="button" class="dz-pick-row" data-recover-habit="${habit.id}" data-recover-date="${habit.missedDate}"><span class="dz-tile">${esc(habit.emoji)}</span><span class="dz-row-copy"><strong>${esc(habit.title)}</strong><small>Missed yesterday · bounce back</small></span><span class="dz-pill comeback">Comeback</span></button>`).join('');
  const doneLine = doneToday.length
    ? `<div class="dz-done-line">Done today · ${doneToday.map((habit) => `<button type="button" data-habit="${habit.id}" aria-label="Undo ${esc(habit.title)}">${esc(habit.title)}</button>`).join(', ')}</div>`
    : '';
  return `<div class="sheet-backdrop" data-close-sheet><section class="sheet compact-sheet dz-sheet dz-picker" role="dialog" aria-modal="true" aria-label="Check in" data-sheet><div class="sheet-handle"></div><h2 class="dz-sheet-title">Check in</h2>${rows}${bounceRows}${doneLine}</section></div>`;
}

export function checkInUndoSheet() {
  if (!ui.checkInUndoRequest) return '';
  const habit = getState()?.habits.find((item) => item.id === ui.checkInUndoRequest.habitId);
  if (!habit) return '';
  return `<div class="sheet-backdrop checkin-undo-layer"><section class="sheet compact-sheet checkin-undo-sheet" role="alertdialog" aria-modal="true" aria-label="Confirm check-in undo" data-sheet><div class="sheet-handle"></div><div class="sheet-head"><div><p class="eyebrow">CHECK-IN</p><h2>Undo this check-in?</h2></div><button class="icon-btn" type="button" data-cancel-check-in-undo aria-label="Keep check-in">×</button></div><p class="sheet-copy">This removes today’s completion for ${esc(habit.title)}. You can check it off again anytime.</p><div class="confirm-actions"><button class="btn" type="button" data-cancel-check-in-undo>Keep it done</button><button class="btn danger-soft" type="button" data-confirm-check-in-undo>Undo check-in</button></div></section></div>`;
}

function proofSourceSheet() {
  if (!ui.proofHabit || ui.proofReview) return '';
  const habit = getState()?.habits.find((item) => item.id === ui.proofHabit);
  if (!habit) return '';
  return `<div class="sheet-backdrop" data-close-sheet><section class="sheet compact-sheet dz-sheet proof-source-sheet" role="dialog" aria-modal="true" aria-label="Add proof" data-sheet><div class="sheet-handle"></div><div class="dz-proof-habit"><span class="dz-tile large">${esc(habit.emoji)}</span><span class="dz-row-copy"><strong>${esc(habit.title)}</strong><small>${esc(habitSubtitle(habit))}</small></span><button class="icon-btn" type="button" data-proof-source-close aria-label="Close">×</button></div><button class="dz-btn primary full" type="button" data-proof-camera>${icon('camera', 20, 2)}Take photo</button><div class="dz-btn-row"><button class="dz-btn secondary" type="button" data-proof-gallery>Library</button><button class="dz-btn secondary" type="button" data-proof-paste>Paste</button></div><p class="dz-fine">Large photos are compressed automatically.</p></section></div>`;
}

function proofCropSheet() {
  if (!ui.proofCrop) return '';
  const position = Math.max(0, Math.min(1, Number(ui.proofCrop.position) || 0.5));
  return `<div class="sheet-backdrop proof-crop-layer"><section class="sheet compact-sheet proof-crop-sheet" role="dialog" aria-modal="true" aria-label="Crop proof" data-sheet><div class="sheet-handle"></div><div class="sheet-head"><div><p class="eyebrow">POSITION PROOF</p><h2>Choose what shows.</h2></div><button class="icon-btn" type="button" data-proof-crop-cancel aria-label="Cancel crop">×</button></div><p class="proof-sheet-copy">Drag the photo up or down. This is the only version that will be uploaded.</p><div class="proof-crop-frame" data-proof-crop-frame><img class="proof-crop-image" data-proof-crop-image src="${esc(ui.proofCrop.previewUrl)}" alt="Crop preview" style="object-position:50% ${Math.round(position * 100)}%"></div><div class="proof-crop-actions"><button class="btn primary full" type="button" data-proof-crop-use>Use crop</button><button class="text-btn" type="button" data-proof-crop-cancel>Cancel</button></div></section></div>`;
}

function dualRoleChoiceControls() {
  if (!ui.dualRoleChoice || !ui.proofReview) return '';
  return `<section class="proof-role-step" role="group" aria-label="Choose first photo role"><div class="proof-role-copy"><p class="eyebrow">MAKE DUAL</p><h3>What was this photo?</h3><small>We’ll open the other camera next.</small></div><div class="proof-role-options"><button class="btn full" type="button" data-dual-first-role="main">Main proof</button><button class="btn full" type="button" data-dual-first-role="selfie">Selfie</button></div><button class="text-btn proof-role-back" type="button" data-dual-role-cancel>Back</button></section>`;
}

function proofReviewSheet() {
  const review = ui.proofReview;
  if (!review) return '';
  const habit = getState()?.habits.find((item) => item.id === review.habitId);
  if (!habit) return '';
  const uploading = review.status === 'uploading';
  const submitLabel = uploading ? 'Uploading…' : review.status === 'error' ? 'Retry proof' : 'Submit proof';
  const choosingDualRole = Boolean(ui.dualRoleChoice);
  const dualReady = ui.dualProof?.habitId === habit.id && Boolean(ui.dualProof?.mainFile) && Boolean(ui.dualProof?.selfieFile);
  const reviewActions = choosingDualRole
    ? dualRoleChoiceControls()
    : dualReady
      ? `<div class="proof-review-actions compact-proof-review-actions"><button class="btn" type="button" data-dual-replace-main ${uploading ? 'disabled' : ''}>Replace main</button><button class="btn" type="button" data-dual-replace-selfie ${uploading ? 'disabled' : ''}>Replace selfie</button></div>`
      : `<div class="proof-review-actions compact-proof-review-actions"><button class="btn" type="button" data-proof-choose ${uploading ? 'disabled' : ''}>Choose another</button><button class="btn proof-make-dual" type="button" data-proof-make-dual ${uploading ? 'disabled' : ''}>Make Dual</button></div>`;
  const submitControls = choosingDualRole ? '' : `<div class="upload-status" aria-live="polite" data-upload-status>${uploading ? 'Uploading proof. Keep Donezo open.' : review.status === 'error' ? 'Upload failed. Your photo is saved for retry.' : 'Ready to submit.'}</div><button class="btn primary full proof-submit-btn" type="button" data-proof-submit ${uploading ? 'disabled aria-busy="true"' : ''}>${submitLabel}</button><button class="text-btn" type="button" data-proof-review-close ${uploading ? 'disabled' : ''}>Cancel</button>`;
  return `<div class="sheet-backdrop"><section class="sheet proof-review-sheet" role="dialog" aria-modal="true" aria-label="Review proof" data-sheet data-no-swipe="${uploading}"><div class="sheet-handle"></div><div class="sheet-head"><div><p class="eyebrow">REVIEW PROOF</p><h2>${esc(habit.emoji)} ${esc(habit.title)}</h2></div><button class="icon-btn" type="button" data-proof-review-close aria-label="Cancel proof" ${uploading ? 'disabled' : ''}>×</button></div><div class="proof-preview-frame"><img src="${esc(review.previewUrl)}" alt="Selected proof for ${esc(habit.title)}"></div><div class="proof-file-meta"><strong>Looks usable?</strong><span>${esc(formatProofFileSize(review.file.size))} · max 4 MB</span></div>${review.error ? `<div class="proof-error" role="alert"><strong>That didn’t upload.</strong><p>${esc(review.error)} Your photo is still here, so you can retry.</p></div>` : ''}${reviewActions}${submitControls}</section></div>`;
}

/** Every sheet the Check In flow can show, in stacking order. */
export function checkInSheets() {
  const overlay = ui.proofHabit || ui.proofReview || ui.proofCrop
    ? ''
    : ui.checkInOverlay === 'caught-up' ? caughtUpSheet() : ui.checkInOverlay === 'picker' ? pickerSheet() : '';
  return `${overlay}${checkInUndoSheet()}${proofCropSheet()}${proofSourceSheet()}${proofReviewSheet()}`;
}

export async function handleSimpleCheckIn(habit, date, checked, successMessage = '') {
  const current = checkInFor(habit.id, me()?.id, date);
  const existingId = current?.id || null;
  const previous = current ? { ...current } : null;
  const result = await runOptimisticMutation({
    key: `checkin:${habit.id}:${date}`,
    apply: () => ui.repo.applySimpleCheckIn(habit.id, date, checked),
    rollback: () => ui.repo.applySimpleCheckIn(habit.id, date, Boolean(previous), previous),
    persist: () => ui.repo.toggleSimpleCheckIn(habit.id, date, checked, existingId),
    errorMessage: checked ? 'Could not complete habit' : 'Could not undo check-in',
    onSuccess: (serverRow) => {
      if (checked && serverRow && typeof serverRow === 'object') ui.repo.applySimpleCheckIn(habit.id, date, true, serverRow);
    },
  });
  if (result === undefined) return undefined;
  haptic(checked ? 28 : 16);
  if (successMessage) notify(successMessage, 4200, checked ? { action: { label: 'Undo', onClick: () => handleUndoCheckIn(habit.id, date) } } : {});
  renderPreservingScroll();
  return result;
}

export async function handleUndoCheckIn(habitId, date = today()) {
  const habit = getState()?.habits.find((item) => item.id === habitId);
  const checkIn = checkInFor(habitId, me()?.id, date);
  if (!habit || !checkIn) return;
  if (requiresPhotoProof(habit.proofMode) || checkIn.proofPath) {
    await runMutation(() => ui.repo.toggleHabit(habitId, date), 'Check-in undone');
    return;
  }
  await handleSimpleCheckIn(habit, date, false, 'Check-in undone');
}

export async function handleHabit(id) {
  const habit = getState().habits.find((item) => item.id === id);
  if (!habit) return;
  const checkInDate = today();
  const current = checkInFor(id, me()?.id, checkInDate);
  if (current && !current.invalid) {
    ui.checkInUndoRequest = { habitId: habit.id, date: checkInDate };
    renderPreservingScroll();
    return;
  }
  const weekly = flexibleWeekProgress(habit, checkInDate, getState());
  if (weekly?.complete) {
    notify(`${habit.title} is complete for the week.`);
    return;
  }
  if (weekly?.paused) {
    notify(`${habit.title} is paused today.`);
    return;
  }
  if (habit.proofMode === 'photo') {
    ui.checkInOverlay = null;
    ui.proofHabit = id;
    render();
    return;
  }
  ui.checkInOverlay = null;
  await handleSimpleCheckIn(habit, checkInDate, true, `Checked in · ${habit.title}`);
}

export function handleRedoProof(checkInId) {
  const checkIn = getState().checkIns.find((item) => item.id === checkInId);
  if (!checkIn) return;
  ui.proofHabit = checkIn.habitId;
  render();
}

// --- Proof flow -----------------------------------------------------------

function openProofCrop(review, sourceFile, { dual = false, selfieFile = null } = {}) {
  if (!review || !sourceFile) return false;
  if (ui.proofCrop?.previewUrl) URL.revokeObjectURL(ui.proofCrop.previewUrl);
  ui.proofCrop = { habitId: review.habitId, review, sourceFile, selfieFile, dual, previewUrl: URL.createObjectURL(sourceFile), position: 0.5 };
  render();
  return true;
}

function closeProofCrop() {
  if (ui.proofCrop?.previewUrl) URL.revokeObjectURL(ui.proofCrop.previewUrl);
  ui.proofCrop = null;
  render();
}

async function handleUseProofCrop() {
  const crop = ui.proofCrop;
  if (!crop || ui.busy) return;
  try {
    const cropped = await cropProofFile(crop.sourceFile, crop.position);
    const artifact = crop.dual
      ? await composeDualProof(cropped, crop.selfieFile)
      : cropped.size > MAX_PROOF_BYTES ? await compressProofFile(cropped) : cropped;
    const validation = validateProofFile(artifact);
    if (!validation.valid) throw new Error(validation.error);
    if (ui.proofCrop?.previewUrl === crop.previewUrl) {
      URL.revokeObjectURL(crop.previewUrl);
      ui.proofCrop = null;
    }
    await uploadProofArtifact(crop.review, artifact);
  } catch (error) {
    notify(readableError(error), 4200);
  }
}

export function clearDualProof() {
  ui.dualProof = null;
  ui.dualRoleChoice = null;
}

async function handleNativeDualInput(input, role) {
  const file = input?.files?.[0];
  if (input) input.value = '';
  if (!file || !ui.dualProof || !['main', 'selfie'].includes(role)) return false;
  const validation = validateProofFile(file);
  if (!validation.valid) {
    notify(validation.error, 3400);
    return false;
  }
  try {
    const prepared = file.size > MAX_PROOF_BYTES ? await compressProofFile(file) : file;
    const nextDual = setDualProofFile(ui.dualProof, role, prepared);
    ui.dualProof = nextDual;
    if (!nextDual.mainFile || !nextDual.selfieFile) return true;
    const output = await composeDualProof(nextDual.mainFile, nextDual.selfieFile);
    const previewUrl = URL.createObjectURL(output);
    if (ui.proofReview?.previewUrl) URL.revokeObjectURL(ui.proofReview.previewUrl);
    ui.proofReview = createProofReviewState({ file: output, habitId: nextDual.habitId, previewUrl });
    render();
    return true;
  } catch (error) {
    notify(readableError(error), 4200);
    return false;
  }
}

export function clearProofReview() {
  if (ui.proofReview?.previewUrl) URL.revokeObjectURL(ui.proofReview.previewUrl);
  ui.proofReview = null;
}

/** Drops every in-progress proof draft (review, crop, dual). */
export function resetProofFlow() {
  if (ui.proofCrop?.previewUrl) URL.revokeObjectURL(ui.proofCrop.previewUrl);
  ui.proofCrop = null;
  clearProofReview();
  clearDualProof();
  ui.proofHabit = null;
}

function dismissProofReview() {
  clearProofReview();
  ui.proofHabit = null;
  clearDualProof();
  render();
}

function chooseProofInput(input) {
  if (!ui.proofHabit && ui.proofReview?.habitId) ui.proofHabit = ui.proofReview.habitId;
  input?.click();
}

function replaceProofSelection(input) {
  if (!ui.proofReview) return;
  ui.proofHabit = ui.proofReview.habitId;
  input?.click();
}

function acceptProofFile(file) {
  if (!file) return false;
  const habitId = ui.proofHabit || ui.proofReview?.habitId;
  if (!habitId) return false;
  const validation = validateProofFile(file);
  if (!validation.valid) {
    notify(validation.error, 3400);
    return false;
  }
  const previewUrl = URL.createObjectURL(file);
  if (ui.proofReview?.previewUrl) URL.revokeObjectURL(ui.proofReview.previewUrl);
  ui.proofReview = createProofReviewState({ file, habitId, previewUrl });
  ui.proofHabit = null;
  render();
  return true;
}

async function handleProofFileSelection(input) {
  const file = input.files?.[0];
  input.value = '';
  await prepareProofFile(file);
}

async function prepareProofFile(file) {
  if (!file) return false;
  const habitId = ui.proofHabit || ui.proofReview?.habitId;
  if (!habitId) return false;
  const preparationId = ++ui.proofPreparationId;
  try {
    if (file.size > MAX_PROOF_BYTES) notify('Compressing large photo…', 5000);
    const prepared = await compressProofFile(file);
    const currentHabitId = ui.proofHabit || ui.proofReview?.habitId;
    if (preparationId !== ui.proofPreparationId || currentHabitId !== habitId) return false;
    if (prepared !== file) notify(`Photo compressed to ${formatProofFileSize(prepared.size)}`, 3200);
    return acceptProofFile(prepared);
  } catch (error) {
    const currentHabitId = ui.proofHabit || ui.proofReview?.habitId;
    if (preparationId === ui.proofPreparationId && currentHabitId === habitId) notify(readableError(error), 4200);
    return false;
  }
}

async function handlePasteProof() {
  try {
    const file = await readClipboardImage(navigator.clipboard);
    await prepareProofFile(file);
  } catch (error) {
    notify(error?.name === 'NotAllowedError'
      ? 'Clipboard access was blocked. Allow it, or choose the photo from your library.'
      : readableError(error), 4200);
  }
}

async function uploadProofArtifact(review, artifact) {
  if (!review || !artifact || ui.busy) return false;
  const habit = getState().habits.find((item) => item.id === review.habitId);
  if (!habit) return false;
  const checkInDate = today();
  let nextReview = review;
  if (artifact !== review.file) {
    const previewUrl = URL.createObjectURL(artifact);
    if (review.previewUrl) URL.revokeObjectURL(review.previewUrl);
    nextReview = createProofReviewState({ file: artifact, habitId: review.habitId, previewUrl });
  }
  ui.proofReview = { ...nextReview, file: artifact, artifactFinalized: true, status: 'uploading', error: null };
  ui.busy = true;
  render();
  try {
    await ui.repo.completeWithProof(review.habitId, checkInDate, artifact);
    if (ui.proofReview?.file === artifact) clearProofReview();
    ui.proofHabit = null;
    ui.checkInOverlay = null;
    clearDualProof();
    notify(`Proof posted · ${habit.title} 🧾`, 5000, { action: { label: 'Undo', onClick: () => handleUndoCheckIn(review.habitId, checkInDate) } });
    haptic(35);
    void ui.refreshCoordinator?.request('proof-posted');
    return true;
  } catch (error) {
    if (ui.proofReview?.file === artifact) {
      ui.proofReview = { ...transitionProofReview(ui.proofReview, { type: 'failed', error: readableError(error) }), artifactFinalized: true };
    }
    return false;
  } finally {
    ui.busy = false;
    renderPreservingScroll();
  }
}

async function handleProofSubmit() {
  const review = ui.proofReview;
  if (!review || review.status === 'uploading' || ui.busy) return;
  if (dataNotReady()) return;
  await ui.refreshCoordinator?.waitForIdle();
  if (ui.busy || ui.proofReview !== review) return;
  if (review.artifactFinalized) {
    await uploadProofArtifact(review, review.file);
    return;
  }
  try {
    const matchingDual = ui.dualProof?.habitId === review.habitId && ui.dualProof.mainFile && ui.dualProof.selfieFile;
    const cropSource = matchingDual ? ui.dualProof.mainFile : review.file;
    const inspection = await inspectProofFile(cropSource);
    if (ui.proofReview !== review) return;
    if (inspection.needsCrop) {
      openProofCrop(review, cropSource, { dual: Boolean(matchingDual), selfieFile: matchingDual ? ui.dualProof.selfieFile : null });
      return;
    }
    await uploadProofArtifact(review, review.file);
  } catch (error) {
    if (ui.proofReview === review) {
      ui.proofReview = transitionProofReview(review, { type: 'failed', error: readableError(error) });
      render();
    }
  }
}

function bindProofCropActions(root) {
  root.querySelectorAll('[data-proof-crop-cancel]').forEach((element) => { element.onclick = closeProofCrop; });
  root.querySelector('[data-proof-crop-use]')?.addEventListener('click', () => { void handleUseProofCrop(); });
  const frame = root.querySelector('[data-proof-crop-frame]');
  const image = root.querySelector('[data-proof-crop-image]');
  if (!frame || !image || !ui.proofCrop) return;
  let dragging = false;
  let startY = 0;
  let startPosition = ui.proofCrop.position;
  const updatePosition = (clientY) => {
    if (!dragging || !ui.proofCrop) return;
    const next = Math.max(0, Math.min(1, startPosition - ((clientY - startY) / Math.max(1, frame.clientHeight))));
    ui.proofCrop.position = next;
    image.style.objectPosition = `50% ${Math.round(next * 100)}%`;
  };
  frame.addEventListener('pointerdown', (event) => {
    dragging = true;
    startY = event.clientY;
    startPosition = ui.proofCrop?.position ?? 0.5;
    frame.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  });
  frame.addEventListener('pointermove', (event) => updatePosition(event.clientY));
  frame.addEventListener('pointerup', (event) => {
    if (!dragging) return;
    updatePosition(event.clientY);
    dragging = false;
    frame.releasePointerCapture?.(event.pointerId);
  });
  frame.addEventListener('pointercancel', () => { dragging = false; });
}

export function bindCheckIn(root) {
  root.querySelectorAll('[data-checkin-action]').forEach((element) => { element.onclick = openCheckIn; });
  root.querySelectorAll('[data-habit]').forEach((element) => { element.onclick = () => handleHabit(element.dataset.habit); });
  root.querySelectorAll('[data-checkin-add-habit]').forEach((element) => { element.onclick = () => { ui.checkInOverlay = null; openHabitEditor(); }; });
  root.querySelectorAll('[data-recover-habit]').forEach((element) => { element.onclick = () => { ui.checkInOverlay = null; openRecovery(element.dataset.recoverHabit, element.dataset.recoverDate); }; });
  root.querySelector('[data-confirm-check-in-undo]')?.addEventListener('click', () => {
    const request = ui.checkInUndoRequest;
    ui.checkInUndoRequest = null;
    if (request) void handleUndoCheckIn(request.habitId, request.date);
  });
  root.querySelectorAll('[data-cancel-check-in-undo]').forEach((element) => { element.onclick = () => { ui.checkInUndoRequest = null; render(); }; });
  root.querySelectorAll('[data-redo-checkin]').forEach((element) => { element.onclick = () => handleRedoProof(element.dataset.redoCheckin); });
  // Native pickers must open synchronously inside the tap for iOS.
  root.querySelectorAll('[data-proof-camera]').forEach((element) => { element.onclick = () => chooseProofInput(inputs.camera); });
  root.querySelectorAll('[data-proof-gallery]').forEach((element) => { element.onclick = () => chooseProofInput(inputs.gallery); });
  root.querySelectorAll('[data-proof-paste]').forEach((element) => { element.onclick = handlePasteProof; });
  root.querySelectorAll('[data-proof-source-close]').forEach((element) => { element.onclick = () => { ui.proofHabit = null; render(); }; });
  root.querySelectorAll('[data-proof-choose]').forEach((element) => { element.onclick = () => {
    if (ui.dualProof?.habitId === ui.proofReview?.habitId) clearDualProof();
    replaceProofSelection(inputs.gallery);
  }; });
  root.querySelectorAll('[data-proof-make-dual]').forEach((element) => { element.onclick = () => {
    if (!ui.proofReview) return;
    ui.dualRoleChoice = { habitId: ui.proofReview.habitId, firstFile: ui.proofReview.file };
    render();
    app.querySelector('[data-dual-first-role]')?.focus();
  }; });
  root.querySelectorAll('[data-dual-first-role]').forEach((element) => { element.onclick = () => {
    if (!ui.dualRoleChoice || !ui.proofReview) return;
    const role = element.dataset.dualFirstRole;
    if (!['main', 'selfie'].includes(role)) return;
    const { habitId, firstFile } = ui.dualRoleChoice;
    ui.dualProof = createDualProofState(habitId, firstFile, role);
    ui.dualRoleChoice = null;
    (role === 'main' ? inputs.selfie : inputs.dualMain)?.click();
    queueMicrotask(() => render());
  }; });
  root.querySelectorAll('[data-dual-role-cancel]').forEach((element) => { element.onclick = () => {
    ui.dualRoleChoice = null;
    render();
    app.querySelector('[data-proof-make-dual]')?.focus();
  }; });
  root.querySelectorAll('[data-dual-replace-main]').forEach((element) => { element.onclick = () => inputs.dualMain?.click(); });
  root.querySelectorAll('[data-dual-replace-selfie]').forEach((element) => { element.onclick = () => inputs.selfie?.click(); });
  root.querySelectorAll('[data-proof-review-close]').forEach((element) => { element.onclick = dismissProofReview; });
  root.querySelectorAll('[data-proof-submit]').forEach((element) => { element.onclick = handleProofSubmit; });
  bindProofCropActions(root);
}

/** One-time listeners on the native file inputs and clipboard. */
export function bindNativeProofInputs() {
  inputs.camera?.addEventListener('change', () => handleProofFileSelection(inputs.camera));
  inputs.gallery?.addEventListener('change', () => handleProofFileSelection(inputs.gallery));
  inputs.dualMain?.addEventListener('change', () => handleNativeDualInput(inputs.dualMain, 'main'));
  inputs.selfie?.addEventListener('change', () => handleNativeDualInput(inputs.selfie, 'selfie'));
  document.addEventListener('paste', (event) => {
    if ((!ui.proofHabit && !ui.proofReview) || ui.proofReview?.status === 'uploading') return;
    const file = imageFileFromPasteData(event.clipboardData);
    if (!file) return;
    event.preventDefault();
    void prepareProofFile(file);
  });
}
