from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]


def read(path):
    return (ROOT / path).read_text()


def write(path, text):
    (ROOT / path).write_text(text)


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected 1 exact match, found {count}')
    return text.replace(old, new, 1)


def sub_once(text, pattern, replacement, label, flags=re.S):
    text, count = re.subn(pattern, replacement, text, count=1, flags=flags)
    if count != 1:
        raise SystemExit(f'{label}: expected 1 regex match, found {count}')
    return text

# Habit proof mode: photo or none only.
store = read('src/store.js')
store = replace_once(
    store,
    "if (!['photo', 'dual_photo', 'none'].includes(proofMode)) throw new Error('Choose a valid proof mode');",
    "if (!['photo', 'none'].includes(proofMode)) throw new Error('Choose a valid proof mode');",
    'store proof modes',
)
write('src/store.js', store)

proof = read('src/proof.js')
proof = replace_once(
    proof,
    "  return mode === 'photo' || mode === 'dual_photo';",
    "  return mode === 'photo';",
    'photo proof requirement',
)
write('src/proof.js', proof)

# Reuse the existing dual-photo capture state as a generic single/dual camera session.
dual = read('src/dual-proof.js')
dual = replace_once(dual, "export function createDualProofState(habitId) {", "export function createDualProofState(habitId, mode = 'dual') {", 'camera state signature')
dual = replace_once(
    dual,
    "    habitId,\n    phase: 'main',",
    "    habitId,\n    mode: mode === 'single' ? 'single' : 'dual',\n    phase: 'main',",
    'camera state mode',
)
dual = replace_once(
    dual,
    "      return { ...state, phase: 'selfie', mainFile: action.file, error: null };",
    "      return { ...state, phase: state.mode === 'single' ? 'review' : 'selfie', mainFile: action.file, error: null };",
    'single capture completion',
)
dual = replace_once(dual, "  quality = 0.9,", "  quality = 0.92,", 'camera jpeg quality')
write('src/dual-proof.js', dual)

app = read('src/app.js')
app = replace_once(
    app,
    "${habit.proofMode === 'dual_photo' ? ' · Dual photo' : habit.proofMode === 'photo' ? ' · Photo proof' : ' · Truuust mode'}",
    "${habit.proofMode === 'photo' ? ' · Photo proof' : ' · Truuust mode'}",
    'habit settings proof label',
)
app = replace_once(
    app,
    "<option value=\"photo\" ${proofMode === 'photo' ? 'selected' : ''}>Photo / screenshot</option><option value=\"dual_photo\" ${proofMode === 'dual_photo' ? 'selected' : ''}>Dual photo</option><option value=\"none\" ${proofMode === 'none' ? 'selected' : ''}>Truuust me</option>",
    "<option value=\"photo\" ${proofMode === 'photo' ? 'selected' : ''}>Photo proof</option><option value=\"none\" ${proofMode === 'none' ? 'selected' : ''}>Truuust me</option>",
    'habit proof select',
)
app = replace_once(
    app,
    "  if (habit.proofMode === 'dual_photo') {\n    dualProof = createDualProofState(id);\n    render();\n    return;\n  }\n",
    "",
    'remove habit-level dual branch',
)
app = replace_once(
    app,
    "  if (result.status === 'refreshed') notify('Friends refreshed. Fresh receipts 🧾');",
    "  if (result.status === 'refreshed') notify('Synced just now');",
    'manual refresh success copy',
)

friends_screen = '''function friendsScreen() {
  const state = getState();
  const feed = activityList(state).filter((activity) => activity.proofPath);
  const visibleActivities = feed.slice(0, feedLimit);
  const activities = visibleActivities.map((activity) => activityCard(activity, { showProofActions: true })).join('');
  const loadMore = feed.length > visibleActivities.length ? `<button class="btn full load-more" type="button" data-load-more>Load older proofs</button>` : '';
  const refreshButton = `<button class="refresh-btn ${manualRefreshLoading ? 'loading' : ''}" type="button" data-manual-refresh aria-label="Refresh Friends" title="Refresh" ${manualRefreshLoading ? 'disabled' : ''}><span aria-hidden="true">↻</span></button>`;
  const peopleButton = `<button class="invite-icon-btn" type="button" data-people-open aria-label="View friends" title="Friends">${icon('people')}</button>`;
  const empty = '<div class="empty compact-empty"><b>No proofs yet.</b><p>Post a photo check-in and give your friends something to react to.</p><button class="btn primary empty-action" type="button" data-empty-checkin>Check in</button></div>';
  return `<section class="friends-heading"><p class="eyebrow">YOUR PEOPLE</p><div class="friends-heading-row"><h1>Friends</h1><div class="friends-heading-actions">${refreshButton}${peopleButton}</div></div></section><div class="activity-list">${activities || empty}${loadMore}</div>`;
}

'''
app = sub_once(app, r"function friendsScreen\(\) \{.*?\n\}\n\n(?=function challengeProgress)", friends_screen, 'friends screen')

camera_sheet = '''function dualProofSheet() {
  if (!dualProof || proofReview) return '';
  const habit = getState()?.habits.find((item) => item.id === dualProof.habitId);
  if (!habit) return '';
  const mainStep = dualProof.phase === 'main';
  const mode = dualProof.mode === 'dual' ? 'dual' : 'single';
  const title = mainStep ? (mode === 'dual' ? 'Show what you did' : 'Take your proof') : 'Now show you';
  const copy = mainStep
    ? mode === 'dual' ? 'Take the main proof photo, then Donezo will flip for your selfie.' : 'Take one clear photo that proves the habit.'
    : 'Flip it around for the selfie.';
  const fallbackAttr = mainStep ? 'data-dual-fallback-main' : 'data-dual-fallback-selfie';
  const modeSwitch = mainStep ? `<div class="camera-mode-switch" role="group" aria-label="Photo mode"><button class="${mode === 'single' ? 'active' : ''}" type="button" data-camera-mode="single" aria-pressed="${mode === 'single'}">Single</button><button class="${mode === 'dual' ? 'active' : ''}" type="button" data-camera-mode="dual" aria-pressed="${mode === 'dual'}">Dual</button></div>` : '';
  return `<div class="sheet-backdrop"><section class="sheet dual-proof-sheet" role="dialog" aria-modal="true" aria-label="Photo proof camera" data-sheet><div class="sheet-handle"></div><div class="sheet-head"><div><p class="eyebrow">${mode === 'dual' ? 'DUAL PHOTO' : 'PHOTO PROOF'}</p><h2>${esc(title)}</h2></div><button class="icon-btn" type="button" data-dual-cancel aria-label="Cancel proof">×</button></div>${modeSwitch}<p class="proof-sheet-copy">${esc(copy)}</p><div class="dual-camera-frame"><video data-dual-camera autoplay playsinline muted></video><div class="dual-camera-loading">Starting camera…</div></div>${dualProof.error ? `<div class="proof-error" role="alert"><p>${esc(dualProof.error)}</p></div>` : ''}<button class="btn primary full" type="button" data-dual-capture>${mainStep ? 'Capture' : 'Capture selfie'}</button><button class="camera-quality-fallback" type="button" ${fallbackAttr}><span class="camera-quality-icon" aria-hidden="true">📷</span><span><strong>Use iPhone camera for better quality</strong><small>Opens the native camera</small></span><span class="camera-quality-chevron" aria-hidden="true">›</span></button></section></div>`;
}

'''
app = sub_once(app, r"function dualProofSheet\(\) \{.*?\n\}\n\n(?=function proofSourceSheet)", camera_sheet, 'camera sheet')

source_sheet = '''function proofSourceSheet() {
  if (!proofHabit || proofReview) return '';
  const habit = getState()?.habits.find((item) => item.id === proofHabit);
  if (!habit) return '';
  return `<div class="sheet-backdrop" data-close-sheet><section class="sheet compact-sheet proof-source-sheet" role="dialog" aria-modal="true" aria-label="Add proof" data-sheet><div class="sheet-handle"></div><div class="sheet-head"><div><p class="eyebrow">ADD PROOF</p><h2>${esc(habit.emoji)} ${esc(habit.title)}</h2></div><button class="icon-btn" type="button" data-proof-source-close aria-label="Close">×</button></div><p class="proof-sheet-copy">Take a photo, pick one from your library, or paste a screenshot. Large photos are compressed automatically.</p><button class="btn primary full" type="button" data-proof-camera>Take photo</button><button class="btn full" type="button" data-proof-gallery>Choose from library</button><button class="btn full" type="button" data-proof-paste>Paste copied photo</button></section></div>`;
}

'''
app = sub_once(app, r"function proofSourceSheet\(\) \{.*?\n\}\n\n(?=function proofReviewSheet)", source_sheet, 'proof source sheet')

review_sheet = '''function proofReviewSheet() {
  if (!proofReview) return '';
  const habit = getState()?.habits.find((item) => item.id === proofReview.habitId);
  if (!habit) return '';
  const uploading = proofReview.status === 'uploading';
  const submitLabel = uploading ? 'Uploading…' : proofReview.status === 'error' ? 'Retry proof' : 'Submit proof';
  const cameraSession = dualProof?.habitId === habit.id;
  const dual = cameraSession && dualProof?.mode === 'dual';
  const replaceActions = dual
    ? `<div class="proof-review-actions"><button class="btn" type="button" data-dual-retake-main ${uploading ? 'disabled' : ''}>Retake proof</button><button class="btn" type="button" data-dual-retake-selfie ${uploading ? 'disabled' : ''}>Retake selfie</button></div>`
    : cameraSession
      ? `<div class="proof-review-actions"><button class="btn" type="button" data-camera-retake ${uploading ? 'disabled' : ''}>Retake</button><button class="btn" type="button" data-proof-choose ${uploading ? 'disabled' : ''}>Choose from library</button></div>`
      : `<div class="proof-review-actions"><button class="btn" type="button" data-proof-retake ${uploading ? 'disabled' : ''}>Retake</button><button class="btn" type="button" data-proof-choose ${uploading ? 'disabled' : ''}>Choose another</button></div>`;
  return `<div class="sheet-backdrop"><section class="sheet proof-review-sheet" role="dialog" aria-modal="true" aria-label="Review proof" data-sheet><div class="sheet-handle"></div><div class="sheet-head"><div><p class="eyebrow">REVIEW PROOF</p><h2>${esc(habit.emoji)} ${esc(habit.title)}</h2></div><button class="icon-btn" type="button" data-proof-review-close aria-label="Cancel proof" ${uploading ? 'disabled' : ''}>×</button></div><div class="proof-preview-frame"><img src="${esc(proofReview.previewUrl)}" alt="Selected proof for ${esc(habit.title)}"></div><div class="proof-file-meta"><strong>Looks usable?</strong><span>${esc(formatProofFileSize(proofReview.file.size))} · max 4 MB</span></div>${proofReview.error ? `<div class="proof-error" role="alert"><strong>That didn’t upload.</strong><p>${esc(proofReview.error)} Your photo is still here, so you can retry.</p></div>` : ''}${replaceActions}<div class="upload-status" aria-live="polite" data-upload-status>${uploading ? 'Uploading proof. Keep Donezo open.' : proofReview.status === 'error' ? 'Upload failed. Your photo is saved for retry.' : 'Ready to submit.'}</div><button class="btn primary full proof-submit-btn" type="button" data-proof-submit ${uploading ? 'disabled aria-busy="true"' : ''}>${submitLabel}</button><button class="text-btn" type="button" data-proof-review-close ${uploading ? 'disabled' : ''}>Cancel</button></section></div>`;
}

'''
app = sub_once(app, r"function proofReviewSheet\(\) \{.*?\n\}\n\n+?(?=function stopDualCamera)", review_sheet, 'proof review sheet')

app = replace_once(
    app,
    "    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: facing } }, audio: false });",
    "    const stream = await navigator.mediaDevices.getUserMedia({\n      video: {\n        facingMode: { ideal: facing },\n        width: { ideal: 1920 },\n        height: { ideal: 1440 },\n        aspectRatio: { ideal: 4 / 3 },\n      },\n      audio: false,\n    });",
    'higher resolution camera constraints',
)
app = replace_once(
    app,
    "      const composite = await composeDualProof(dualProof.mainFile, dualProof.selfieFile);\n      const previewUrl = URL.createObjectURL(composite);\n      proofReview = createProofReviewState({ file: composite, habitId: dualProof.habitId, previewUrl });",
    "      const output = dualProof.mode === 'dual'\n        ? await composeDualProof(dualProof.mainFile, dualProof.selfieFile)\n        : dualProof.mainFile;\n      if (!output) throw new Error('Take a proof photo first');\n      const previewUrl = URL.createObjectURL(output);\n      proofReview = createProofReviewState({ file: output, habitId: dualProof.habitId, previewUrl });",
    'single camera review output',
)

bind_proof = '''function bindProofActions() {
  app.querySelectorAll('[data-proof-camera]').forEach((element) => { element.onclick = () => {
    if (!proofHabit) return;
    dualProof = createDualProofState(proofHabit, 'single');
    proofHabit = null;
    render();
  }; });
  app.querySelectorAll('[data-proof-gallery]').forEach((element) => { element.onclick = () => chooseProofInput(proofGalleryInput); });
  app.querySelectorAll('[data-proof-paste]').forEach((element) => { element.onclick = handlePasteProof; });
  app.querySelectorAll('[data-proof-source-close]').forEach((element) => { element.onclick = () => { proofHabit = null; render(); }; });
  app.querySelectorAll('[data-proof-retake]').forEach((element) => { element.onclick = () => {
    if (!proofReview) return;
    const habitId = proofReview.habitId;
    clearProofReview();
    clearDualProof();
    dualProof = createDualProofState(habitId, 'single');
    render();
  }; });
  app.querySelectorAll('[data-proof-choose]').forEach((element) => { element.onclick = () => {
    if (dualProof?.habitId === proofReview?.habitId) clearDualProof();
    replaceProofSelection(proofGalleryInput);
  }; });
  app.querySelectorAll('[data-proof-review-close]').forEach((element) => { element.onclick = dismissProofReview; });
  app.querySelectorAll('[data-proof-submit]').forEach((element) => { element.onclick = handleProofSubmit; });
  bindProofThumbnails();
  void startDualCameraIfNeeded();
}

'''
app = sub_once(app, r"function bindProofActions\(\) \{.*?\n\}\n\n(?=async function openFriendProfile)", bind_proof, 'proof action bindings')

app = replace_once(
    app,
    "  app.querySelectorAll('[data-quick-proof]').forEach((element) => { element.onclick = () => { proofHabit = element.dataset.quickProof; chooseProofInput(proofInput); }; });",
    "  app.querySelectorAll('[data-quick-proof]').forEach((element) => { element.onclick = () => { dualProof = createDualProofState(element.dataset.quickProof, 'single'); proofHabit = null; render(); }; });",
    'quick proof in-app camera',
)

old_camera_bindings = """  app.querySelector('[data-dual-capture]')?.addEventListener('click', () => { void captureDualCamera(); });
  app.querySelector('[data-dual-fallback-main]')?.addEventListener('click', () => dualProofMainInput?.click());
  app.querySelector('[data-dual-fallback-selfie]')?.addEventListener('click', () => proofSelfieInput?.click());
  app.querySelector('[data-dual-cancel]')?.addEventListener('click', () => { clearDualProof(); render(); });
  app.querySelector('[data-dual-retake-main]')?.addEventListener('click', () => { clearProofReview(); dualProof = transitionDualProof(dualProof, { type: 'retake_main' }); render(); });
  app.querySelector('[data-dual-retake-selfie]')?.addEventListener('click', () => { clearProofReview(); dualProof = transitionDualProof(dualProof, { type: 'retake_selfie' }); render(); });
"""
new_camera_bindings = """  app.querySelectorAll('[data-camera-mode]').forEach((element) => { element.onclick = () => {
    if (!dualProof || dualProof.phase !== 'main') return;
    const mode = element.dataset.cameraMode === 'dual' ? 'dual' : 'single';
    if (dualProof.mode === mode) return;
    const habitId = dualProof.habitId;
    clearDualProof();
    dualProof = createDualProofState(habitId, mode);
    render();
  }; });
  app.querySelector('[data-dual-capture]')?.addEventListener('click', () => { void captureDualCamera(); });
  app.querySelector('[data-dual-fallback-main]')?.addEventListener('click', () => dualProofMainInput?.click());
  app.querySelector('[data-dual-fallback-selfie]')?.addEventListener('click', () => proofSelfieInput?.click());
  app.querySelector('[data-dual-cancel]')?.addEventListener('click', () => { const habitId = dualProof?.habitId; clearDualProof(); proofHabit = habitId || null; render(); });
  app.querySelector('[data-camera-retake]')?.addEventListener('click', () => { clearProofReview(); dualProof = transitionDualProof(dualProof, { type: 'retake_main' }); render(); });
  app.querySelector('[data-dual-retake-main]')?.addEventListener('click', () => { clearProofReview(); dualProof = transitionDualProof(dualProof, { type: 'retake_main' }); render(); });
  app.querySelector('[data-dual-retake-selfie]')?.addEventListener('click', () => { clearProofReview(); dualProof = transitionDualProof(dualProof, { type: 'retake_selfie' }); render(); });
"""
app = replace_once(app, old_camera_bindings, new_camera_bindings, 'camera render bindings')
write('src/app.js', app)

social = read('social.css')
social += '''\n\n/* Camera polish + compact Friends header + hard viewport containment. */
.friends-heading{padding:var(--space-5) 0 var(--space-3)}
.friends-heading>.eyebrow{margin-bottom:var(--space-2)}
.friends-heading-row{display:flex;align-items:center;justify-content:space-between;gap:var(--space-3);min-width:0}
.friends-heading-row h1{min-width:0;margin:0;font-family:var(--font-display);font-size:clamp(1.55rem,6vw,2rem);font-weight:800;letter-spacing:-.045em;line-height:1.05}
.friends-heading-actions{display:flex;align-items:center;gap:var(--space-2);flex:0 0 auto}
.friends-heading-actions .refresh-btn,.friends-heading-actions .invite-icon-btn{display:grid;place-items:center;width:2.55rem;height:2.55rem;min-width:2.55rem;padding:0;border-radius:var(--radius-round)}
.camera-mode-switch{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.2rem;margin:0 0 var(--space-3);padding:.2rem;border-radius:var(--radius-round);background:var(--color-paper-2)}
.camera-mode-switch button{min-height:2.4rem;border:0;border-radius:var(--radius-round);background:transparent;color:var(--color-muted);font-size:var(--text-xs);font-weight:800}
.camera-mode-switch button.active{background:var(--color-surface);color:var(--color-ink);box-shadow:0 1px 5px var(--color-shadow)}
.camera-quality-fallback{display:grid;grid-template-columns:2.45rem minmax(0,1fr) auto;align-items:center;gap:var(--space-3);width:100%;min-height:4rem;margin-top:var(--space-3);border:var(--rule-hairline) solid var(--color-rule-strong);border-radius:var(--radius-md);padding:var(--space-2) var(--space-3);background:var(--color-surface);color:var(--color-ink);text-align:left}
.camera-quality-fallback>span:nth-child(2){min-width:0}.camera-quality-fallback strong,.camera-quality-fallback small{display:block}.camera-quality-fallback strong{font-size:var(--text-sm)}.camera-quality-fallback small{margin-top:.16rem;color:var(--color-muted);font-size:var(--text-2xs)}
.camera-quality-icon{display:grid;place-items:center;width:2.45rem;height:2.45rem;border-radius:var(--radius-round);background:var(--color-cobalt-soft);font-size:1.1rem}.camera-quality-chevron{color:var(--color-muted);font-size:1.35rem}
.activity-list{grid-template-columns:minmax(0,1fr);min-width:0;width:100%;max-width:100%}
.activity{min-width:0;max-width:100%}
.activity-social-actions{min-width:0;max-width:100%}
.reaction-row{min-width:0;max-width:100%;overflow-x:auto}
.proof-media{max-width:100%}
'''
write('social.css', social)

# Update superseded regression contracts to the new approved product behavior.
mode_test = read('test/dual-proof-mode.test.mjs')
mode_test = sub_once(
    mode_test,
    r"test\('dual photo is a first-class proof-required habit mode'.*?\n\}\);",
    """test('photo is the only proof-required habit mode', () => {
  assert.equal(requiresPhotoProof('none'), false);
  assert.equal(requiresPhotoProof('photo'), true);
  assert.equal(requiresPhotoProof('dual_photo'), false);
  assert.equal(validateHabitInput({ title: 'Gym', emoji: '🏋️', targetTime: '18:00', proofMode: 'photo' }).proofMode, 'photo');
  assert.throws(() => validateHabitInput({ title: 'Gym', emoji: '🏋️', targetTime: '18:00', proofMode: 'dual_photo' }), /valid proof mode/);
});""",
    'dual proof mode regression',
)
write('test/dual-proof-mode.test.mjs', mode_test)

ui_test = read('test/dual-proof-ui.test.mjs')
ui_test = sub_once(
    ui_test,
    r"test\('habit editor exposes a configured dual-photo proof mode'.*?\n\}\);",
    """test('habit editor exposes photo proof without a separate dual habit mode', () => {
  assert.match(app, /value=\"photo\"[^>]*>[^<]*Photo proof/i);
  assert.match(app, /value=\"none\"[^>]*>[^<]*Truuust me/i);
  assert.doesNotMatch(app, /value=\"dual_photo\"/);
  assert.match(app, /requiresPhotoProof/);
});""",
    'dual proof UI habit regression',
)
write('test/dual-proof-ui.test.mjs', ui_test)

polish_test = read('test/dual-updates-polish.test.mjs')
polish_test = sub_once(
    polish_test,
    r"test\('every normal photo-proof picker offers Dual photo'.*?\n\}\);",
    """test('Dual photo lives inside the Take photo camera rather than the source picker', () => {
  const picker = section(app, 'function proofSourceSheet()', 'function proofReviewSheet()');
  const camera = section(app, 'function dualProofSheet()', 'function proofSourceSheet()');
  const bindings = section(app, 'function bindProofActions()', 'async function openFriendProfile(');
  assert.doesNotMatch(picker, /data-proof-dual/);
  assert.match(camera, /data-camera-mode=\"single\"/);
  assert.match(camera, /data-camera-mode=\"dual\"/);
  assert.match(bindings, /createDualProofState\(proofHabit, 'single'\)/);
});""",
    'dual source picker regression',
)
polish_test = sub_once(
    polish_test,
    r"test\('optional Dual photo keeps the dual retake review controls'.*?\n\}\);",
    """test('Dual camera mode keeps independent retake controls', () => {
  const review = section(app, 'function proofReviewSheet()', 'function stopDualCamera()');
  assert.match(review, /cameraSession/);
  assert.match(review, /dualProof\?\.mode === 'dual'/);
  assert.match(review, /data-dual-retake-main/);
  assert.match(review, /data-dual-retake-selfie/);
});""",
    'dual review regression',
)
write('test/dual-updates-polish.test.mjs', polish_test)

friends_test = read('test/friends-ui.test.mjs')
friends_test = replace_once(friends_test, "  assert.match(source, /pageHeading\\('Friends'/);", "  assert.match(source, /friends-heading-row/);", 'friends heading test')
friends_test = replace_once(friends_test, "  assert.match(social, /\\.squad-refresh-row/);", "  assert.match(social, /\\.friends-heading-row/);", 'friends heading css test')
write('test/friends-ui.test.mjs', friends_test)

# Guard postconditions before tests run.
final_app = read('src/app.js')
if 'value="dual_photo"' in final_app:
    raise SystemExit('habit-level dual_photo option survived')
if 'data-proof-dual' in final_app:
    raise SystemExit('top-level Dual photo picker survived')
if 'Use iPhone camera for better quality' not in final_app:
    raise SystemExit('quality fallback copy missing')
if "width: { ideal: 1920 }" not in final_app or "height: { ideal: 1440 }" not in final_app:
    raise SystemExit('higher quality constraints missing')
if 'friends-heading-row' not in final_app:
    raise SystemExit('compact Friends heading missing')
