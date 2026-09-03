from pathlib import Path
import re

APP = Path('src/app.js')
CSS = Path('social.css')
TEST = Path('test/native-proof-flow-v2.test.mjs')

app = APP.read_text()

old_import = "import { captureVideoFrame, composeDualProof, createDualProofState, dualCameraSupported, stopMediaStream, transitionDualProof } from './dual-proof.js';"
new_import = "import { composeDualProof, createDualProofState, setDualProofFile } from './dual-proof.js';"
assert old_import in app
app = app.replace(old_import, new_import, 1)

old_state = "let dualProof = null;\nlet dualCameraStream = null;\nlet dualCameraRequestId = 0;"
new_state = "let dualProof = null;\nlet dualRoleChoice = null;"
assert old_state in app
app = app.replace(old_state, new_state, 1)

old_visibility = "document.addEventListener('visibilitychange', () => {\n  if (document.visibilityState !== 'visible') return;\n  requestPortraitLock();\n  void startDualCameraIfNeeded();\n});"
new_visibility = "document.addEventListener('visibilitychange', () => {\n  if (document.visibilityState !== 'visible') return;\n  requestPortraitLock();\n});"
assert old_visibility in app
app = app.replace(old_visibility, new_visibility, 1)

role_sheet = r'''function dualRoleChoiceSheet() {
  if (!dualRoleChoice || !proofReview) return '';
  return `<div class="sheet-backdrop proof-role-layer"><section class="sheet compact-sheet proof-role-sheet" role="dialog" aria-modal="true" aria-label="Choose first photo role" data-sheet><div class="sheet-handle"></div><div class="sheet-head"><div><p class="eyebrow">MAKE DUAL</p><h2>What was this photo?</h2></div><button class="icon-btn" type="button" data-dual-role-cancel aria-label="Cancel">×</button></div><div class="proof-role-options"><button class="btn full" type="button" data-dual-first-role="main">Main proof</button><button class="btn full" type="button" data-dual-first-role="selfie">Selfie</button></div></section></div>`;
}

'''
app, count = re.subn(r"function dualProofSheet\(\) \{[\s\S]*?(?=function proofSourceSheet\(\))", role_sheet, app, count=1)
assert count == 1

source_sheet = r'''function proofSourceSheet() {
  if (!proofHabit || proofReview) return '';
  const habit = getState()?.habits.find((item) => item.id === proofHabit);
  if (!habit) return '';
  return `<div class="sheet-backdrop" data-close-sheet><section class="sheet compact-sheet proof-source-sheet" role="dialog" aria-modal="true" aria-label="Add proof" data-sheet><div class="sheet-handle"></div><div class="sheet-head"><div><p class="eyebrow">ADD PROOF</p><h2>${esc(habit.emoji)} ${esc(habit.title)}</h2></div><button class="icon-btn" type="button" data-proof-source-close aria-label="Close">×</button></div><p class="proof-sheet-copy">Take a photo, choose one, or paste a screenshot. Large photos are compressed automatically.</p><button class="btn primary full" type="button" data-proof-camera>Take photo</button><button class="btn full" type="button" data-proof-gallery>Choose from library</button><button class="btn full" type="button" data-proof-paste>Paste copied photo</button></section></div>`;
}

'''
app, count = re.subn(r"function proofSourceSheet\(\) \{[\s\S]*?(?=function proofReviewSheet\(\))", source_sheet, app, count=1)
assert count == 1

review_and_native = r'''function proofReviewSheet() {
  if (!proofReview) return '';
  const habit = getState()?.habits.find((item) => item.id === proofReview.habitId);
  if (!habit) return '';
  const uploading = proofReview.status === 'uploading';
  const submitLabel = uploading ? 'Uploading…' : proofReview.status === 'error' ? 'Retry proof' : 'Submit proof';
  const dualReady = dualProof?.habitId === habit.id && Boolean(dualProof?.mainFile) && Boolean(dualProof?.selfieFile);
  const replaceActions = dualReady
    ? `<div class="proof-review-actions compact-proof-review-actions"><button class="btn" type="button" data-dual-replace-main ${uploading ? 'disabled' : ''}>Replace main</button><button class="btn" type="button" data-dual-replace-selfie ${uploading ? 'disabled' : ''}>Replace selfie</button></div>`
    : `<div class="proof-review-actions compact-proof-review-actions"><button class="btn" type="button" data-proof-choose ${uploading ? 'disabled' : ''}>Choose another</button><button class="btn proof-make-dual" type="button" data-proof-make-dual ${uploading ? 'disabled' : ''}>Make Dual</button></div>`;
  return `<div class="sheet-backdrop"><section class="sheet proof-review-sheet" role="dialog" aria-modal="true" aria-label="Review proof" data-sheet><div class="sheet-handle"></div><div class="sheet-head"><div><p class="eyebrow">REVIEW PROOF</p><h2>${esc(habit.emoji)} ${esc(habit.title)}</h2></div><button class="icon-btn" type="button" data-proof-review-close aria-label="Cancel proof" ${uploading ? 'disabled' : ''}>×</button></div><div class="proof-preview-frame"><img src="${esc(proofReview.previewUrl)}" alt="Selected proof for ${esc(habit.title)}"></div><div class="proof-file-meta"><strong>Looks usable?</strong><span>${esc(formatProofFileSize(proofReview.file.size))} · max 4 MB</span></div>${proofReview.error ? `<div class="proof-error" role="alert"><strong>That didn’t upload.</strong><p>${esc(proofReview.error)} Your photo is still here, so you can retry.</p></div>` : ''}${replaceActions}<div class="upload-status" aria-live="polite" data-upload-status>${uploading ? 'Uploading proof. Keep Donezo open.' : proofReview.status === 'error' ? 'Upload failed. Your photo is saved for retry.' : 'Ready to submit.'}</div><button class="btn primary full proof-submit-btn" type="button" data-proof-submit ${uploading ? 'disabled aria-busy="true"' : ''}>${submitLabel}</button><button class="text-btn" type="button" data-proof-review-close ${uploading ? 'disabled' : ''}>Cancel</button></section></div>`;
}

function clearDualProof() {
  dualProof = null;
  dualRoleChoice = null;
}

async function handleNativeDualInput(input, role) {
  const file = input?.files?.[0];
  if (input) input.value = '';
  if (!file) return false;
  if (!dualProof || !['main', 'selfie'].includes(role)) return false;
  const validation = validateProofFile(file);
  if (!validation.valid) {
    notify(validation.error, 3400);
    return false;
  }
  try {
    const prepared = file.size > MAX_PROOF_BYTES ? await compressProofFile(file) : file;
    const nextDual = setDualProofFile(dualProof, role, prepared);
    dualProof = nextDual;
    if (!nextDual.mainFile || !nextDual.selfieFile) return true;
    const output = await composeDualProof(nextDual.mainFile, nextDual.selfieFile);
    const previewUrl = URL.createObjectURL(output);
    if (proofReview?.previewUrl) URL.revokeObjectURL(proofReview.previewUrl);
    proofReview = createProofReviewState({ file: output, habitId: nextDual.habitId, previewUrl });
    render();
    return true;
  } catch (error) {
    notify(readableError(error), 4200);
    return false;
  }
}

'''
app, count = re.subn(r"function proofReviewSheet\(\) \{[\s\S]*?(?=function clearProofReview\(\))", review_and_native, app, count=1)
assert count == 1

bind = r'''function bindProofActions() {
  app.querySelectorAll('[data-proof-camera]').forEach((element) => { element.onclick = () => chooseProofInput(proofInput); });
  app.querySelectorAll('[data-proof-gallery]').forEach((element) => { element.onclick = () => chooseProofInput(proofGalleryInput); });
  app.querySelectorAll('[data-proof-paste]').forEach((element) => { element.onclick = handlePasteProof; });
  app.querySelectorAll('[data-proof-source-close]').forEach((element) => { element.onclick = () => { proofHabit = null; render(); }; });
  app.querySelectorAll('[data-proof-choose]').forEach((element) => { element.onclick = () => {
    if (dualProof?.habitId === proofReview?.habitId) clearDualProof();
    replaceProofSelection(proofGalleryInput);
  }; });
  app.querySelectorAll('[data-proof-make-dual]').forEach((element) => { element.onclick = () => {
    if (!proofReview) return;
    dualRoleChoice = { habitId: proofReview.habitId, firstFile: proofReview.file };
    render();
  }; });
  app.querySelectorAll('[data-dual-first-role]').forEach((element) => { element.onclick = () => {
    if (!dualRoleChoice || !proofReview) return;
    const role = element.dataset.dualFirstRole;
    if (!['main', 'selfie'].includes(role)) return;
    const { habitId, firstFile } = dualRoleChoice;
    dualProof = createDualProofState(habitId, firstFile, role);
    dualRoleChoice = null;
    const input = role === 'main' ? proofSelfieInput : dualProofMainInput;
    input?.click();
    queueMicrotask(() => render());
  }; });
  app.querySelectorAll('[data-dual-role-cancel]').forEach((element) => { element.onclick = () => { dualRoleChoice = null; render(); }; });
  app.querySelectorAll('[data-dual-replace-main]').forEach((element) => { element.onclick = () => dualProofMainInput?.click(); });
  app.querySelectorAll('[data-dual-replace-selfie]').forEach((element) => { element.onclick = () => proofSelfieInput?.click(); });
  app.querySelectorAll('[data-proof-review-close]').forEach((element) => { element.onclick = dismissProofReview; });
  app.querySelectorAll('[data-proof-submit]').forEach((element) => { element.onclick = handleProofSubmit; });
  bindProofThumbnails();
}

'''
app, count = re.subn(r"function bindProofActions\(\) \{[\s\S]*?(?=async function openFriendProfile\()", bind, app, count=1)
assert count == 1

old_sheets = "${stakeSheet()}${proofSourceSheet()}${dualProofSheet()}${proofReviewSheet()}"
new_sheets = "${stakeSheet()}${dualRoleChoiceSheet()}${proofSourceSheet()}${proofReviewSheet()}"
assert old_sheets in app
app = app.replace(old_sheets, new_sheets, 1)

old_quick = "app.querySelectorAll('[data-quick-proof]').forEach((element) => { element.onclick = () => { dualProof = createDualProofState(element.dataset.quickProof, 'single'); proofHabit = null; render(); }; });"
new_quick = "app.querySelectorAll('[data-quick-proof]').forEach((element) => { element.onclick = () => { proofHabit = element.dataset.quickProof; clearDualProof(); proofInput?.click(); }; });"
assert old_quick in app
app = app.replace(old_quick, new_quick, 1)

old_listeners = "dualProofMainInput?.addEventListener('change', async () => {\n  const file = dualProofMainInput.files?.[0];\n  dualProofMainInput.value = '';\n  if (file) await finishDualSelection(file, 'main');\n});\nproofSelfieInput?.addEventListener('change', async () => {\n  const file = proofSelfieInput.files?.[0];\n  proofSelfieInput.value = '';\n  if (file) await finishDualSelection(file, 'selfie');\n});"
new_listeners = "dualProofMainInput?.addEventListener('change', () => handleNativeDualInput(dualProofMainInput, 'main'));\nproofSelfieInput?.addEventListener('change', () => handleNativeDualInput(proofSelfieInput, 'selfie'));"
assert old_listeners in app
app = app.replace(old_listeners, new_listeners, 1)

for dead in ['startDualCameraIfNeeded', 'dualCameraStream', 'dualCameraRequestId', 'data-dual-camera', 'camera-mode-switch', 'data-proof-donezo-camera']:
    assert dead not in app, dead

APP.write_text(app)

# Stable boundary after live-camera deletion.
test = TEST.read_text()
test = test.replace("section(app, 'function proofReviewSheet()', 'function stopDualCamera()')", "section(app, 'function proofReviewSheet()', 'function clearDualProof()')")
TEST.write_text(test)

css = CSS.read_text()
# Remove dead live-camera-only rules. Keep unrelated proof-review rules.
live_tokens = [
    '.dual-camera-frame', '.dual-camera-loading', '.camera-mode-switch', '.dual-proof-sheet',
    '.camera-quality-fallback', '.camera-quality-icon', '.camera-quality-chevron', '.camera-capture-btn',
    '.camera-sheet-head'
]
for token in live_tokens:
    pattern = re.compile(r'[^{}]*' + re.escape(token) + r'[^{}]*\{[^{}]*\}')
    css = pattern.sub('', css)
if '.proof-make-dual{' not in css:
    css += "\n.compact-proof-review-actions{margin:var(--space-3) 0 var(--space-2)}.proof-make-dual{border-color:color-mix(in oklch,var(--color-coral) 58%,var(--color-rule));background:var(--color-coral-soft);color:var(--color-coral-ink);font-weight:850}.proof-role-options{display:grid;gap:var(--space-2)}\n"
CSS.write_text(css)
