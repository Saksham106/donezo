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


app = read('src/app.js')

# Keep camera sessions mounted through background refreshes.
app = replace_once(
    app,
    "    || batonSheetOpen\n    || Boolean(proofReview);",
    "    || batonSheetOpen\n    || Boolean(dualProof)\n    || Boolean(proofReview);",
    'camera draft guard',
)

app = replace_once(
    app,
    "}\n\nasync function refreshRepositoryData(activeRepo) {",
    "}\n\nfunction shouldDeferFriendsRefreshRender() {\n  const scrollTop = app.querySelector('#content-scroll')?.scrollTop ?? screenScroll.friends ?? 0;\n  return tab === 'friends' && scrollTop > 4;\n}\n\nasync function refreshRepositoryData(activeRepo) {",
    'friends refresh defer helper',
)
app = replace_once(
    app,
    "  if (!hasUnsavedDraft()) renderPreservingScroll();\n  scheduleStateCacheWrite(activeRepo);",
    "  if (!hasUnsavedDraft() && !shouldDeferFriendsRefreshRender()) renderPreservingScroll();\n  scheduleStateCacheWrite(activeRepo);",
    'background refresh render guard',
)
app = replace_once(
    app,
    "      if (!hasUnsavedDraft()) renderPreservingScroll();",
    "      if (!hasUnsavedDraft() && !shouldDeferFriendsRefreshRender()) renderPreservingScroll();",
    'network render guard',
)

# Compact camera sheet: no explanatory copy; controls always fit in the viewport.
camera_sheet = '''function dualProofSheet() {
  if (!dualProof || proofReview) return '';
  const habit = getState()?.habits.find((item) => item.id === dualProof.habitId);
  if (!habit) return '';
  const mainStep = dualProof.phase === 'main';
  const mode = dualProof.mode === 'dual' ? 'dual' : 'single';
  const title = mainStep ? (mode === 'dual' ? 'Take main photo' : 'Take your proof') : 'Take your selfie';
  const fallbackAttr = mainStep ? 'data-dual-fallback-main' : 'data-dual-fallback-selfie';
  const modeSwitch = mainStep ? `<div class="camera-mode-switch" role="group" aria-label="Photo mode"><button class="${mode === 'single' ? 'active' : ''}" type="button" data-camera-mode="single" aria-pressed="${mode === 'single'}">Single</button><button class="${mode === 'dual' ? 'active' : ''}" type="button" data-camera-mode="dual" aria-pressed="${mode === 'dual'}">Dual</button></div>` : '';
  return `<div class="sheet-backdrop"><section class="sheet dual-proof-sheet" role="dialog" aria-modal="true" aria-label="Photo proof camera" data-sheet><div class="sheet-handle"></div><div class="sheet-head camera-sheet-head"><h2>${esc(title)}</h2><button class="icon-btn" type="button" data-dual-cancel aria-label="Cancel proof">×</button></div>${modeSwitch}<div class="dual-camera-frame"><video data-dual-camera autoplay playsinline muted></video><div class="dual-camera-loading">Starting camera…</div></div>${dualProof.error ? `<div class="proof-error" role="alert"><p>${esc(dualProof.error)}</p></div>` : ''}<button class="btn primary full camera-capture-btn" type="button" data-dual-capture>${mainStep ? 'Capture' : 'Capture selfie'}</button><button class="camera-quality-fallback" type="button" ${fallbackAttr}><span class="camera-quality-icon" aria-hidden="true">📷</span><strong>Use iPhone camera for better quality</strong><span class="camera-quality-chevron" aria-hidden="true">›</span></button></section></div>`;
}

function proofSourceSheet()'''
app = sub_once(
    app,
    r"function dualProofSheet\(\) \{.*?\n\}\n\nfunction proofSourceSheet\(\)",
    camera_sheet,
    'camera sheet',
)

# Keep the active stream warm while native camera temporarily takes foreground.
app = replace_once(
    app,
    "function openNativeCameraFallback(input) {\n  stopDualCamera();\n  input?.click();\n}",
    "function openNativeCameraFallback(input) {\n  input?.click();\n}",
    'native camera handoff',
)

reuse_anchor = """  const video = app.querySelector('[data-dual-camera]');
  if (!video || !dualCameraSupported()) return;
  const requestId = ++dualCameraRequestId;
  stopMediaStream(dualCameraStream);
  dualCameraStream = null;
  try {
"""
reuse_replacement = """  const video = app.querySelector('[data-dual-camera]');
  if (!video || !dualCameraSupported()) return;
  const liveTrack = dualCameraStream?.getVideoTracks?.().find((track) => track.readyState === 'live');
  if (liveTrack) {
    video.srcObject = dualCameraStream;
    await video.play?.().catch(() => {});
    video.parentElement?.querySelector('.dual-camera-loading')?.remove();
    return;
  }
  const requestId = ++dualCameraRequestId;
  stopMediaStream(dualCameraStream);
  dualCameraStream = null;
  try {
"""
app = replace_once(app, reuse_anchor, reuse_replacement, 'reuse live camera stream')

app = replace_once(
    app,
    "    const habitId = dualProof.habitId;\n    clearDualProof();\n    dualProof = createDualProofState(habitId, mode);\n    render();",
    "    dualProof = { ...dualProof, mode };\n    render();",
    'mode switch stream reuse',
)

# Move reject control into the proof-card header.
app = replace_once(
    app,
    "  const positiveReactions = `<div class=\"activity-social-actions\"><div><div class=\"reaction-row\" aria-label=\"React to or reject this check-in\">${reactionButtons}${rejectionControl}</div><small class=\"reaction-summary\" aria-live=\"polite\">${esc(reactionSummary)}</small></div><button type=\"button\" class=\"comment-open\" data-comment-open=\"${activity.checkInId}\">${commentCount ? `${commentCount} ${commentCount === 1 ? 'reply' : 'replies'}` : 'Reply'}</button></div>`;",
    "  const positiveReactions = `<div class=\"activity-social-actions\"><div><div class=\"reaction-row\" aria-label=\"React to this check-in\">${reactionButtons}</div><small class=\"reaction-summary\" aria-live=\"polite\">${esc(reactionSummary)}</small></div><button type=\"button\" class=\"comment-open\" data-comment-open=\"${activity.checkInId}\">${commentCount ? `${commentCount} ${commentCount === 1 ? 'reply' : 'replies'}` : 'Reply'}</button></div>`;",
    'reaction row moderation removal',
)
app = replace_once(
    app,
    '<div class="proof-card-header"><div class="proof-card-title">',
    '<div class="proof-card-header"><div class="proof-card-heading-copy"><div class="proof-card-title">',
    'proof header wrapper',
)
app = replace_once(
    app,
    '<span>· 🔥 ${activity.streak}</span></div></div>${proofPreview}',
    '<span>· 🔥 ${activity.streak}</span></div></div>${rejectionControl}</div>${proofPreview}',
    'proof header rejection control',
)

write('src/app.js', app)

social = read('social.css')
social += '''

/* Camera + Friends stability follow-up. */
.friends-heading>.eyebrow{margin-bottom:.2rem}
.proof-card-header{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:start;gap:var(--space-2);margin-bottom:var(--space-3)}
.proof-card-heading-copy{min-width:0}
.proof-rejection-inline{align-self:flex-start;margin-left:0;white-space:nowrap}
.reaction-row{overflow-x:auto;overflow-y:hidden}
.camera-mode-switch{border:var(--rule-hairline) solid var(--color-rule-strong);background:var(--color-paper-3);padding:.22rem}
.camera-mode-switch button{border:var(--rule-hairline) solid var(--color-rule);background:var(--color-paper-2);color:var(--color-ink)}
.camera-mode-switch button.active{border-color:var(--color-coral);background:var(--color-coral);color:var(--color-white);box-shadow:0 2px 8px var(--color-shadow)}
.dual-proof-sheet{height:calc(100dvh - env(safe-area-inset-top) - .25rem);max-height:calc(100dvh - env(safe-area-inset-top) - .25rem);overflow:hidden;display:flex;flex-direction:column;padding-top:var(--space-2);padding-bottom:calc(var(--space-3) + env(safe-area-inset-bottom))}
.dual-proof-sheet .sheet-handle{flex:0 0 auto;margin-bottom:var(--space-2)}
.dual-proof-sheet .camera-sheet-head{flex:0 0 auto;align-items:center;margin-bottom:var(--space-2)}
.dual-proof-sheet .camera-sheet-head h2{font-size:var(--text-lg)}
.dual-proof-sheet .camera-mode-switch{flex:0 0 auto;margin:0 0 var(--space-2)}
.dual-camera-frame{flex:1 1 auto;min-height:0;max-height:none;margin:0}
.dual-camera-frame video{height:100%;max-height:none;object-fit:contain}
.camera-capture-btn{flex:0 0 auto;margin-top:var(--space-3)}
.camera-quality-fallback{flex:0 0 auto;min-height:3.15rem;margin-top:var(--space-2);padding:.45rem var(--space-3)}
.camera-quality-fallback>strong{min-width:0;font-size:var(--text-sm);line-height:1.2}
'''
write('social.css', social)

# User changed the native handoff requirement: keep the stream warm instead of forcing release.
test = read('test/photo-camera-friends-polish.test.mjs')
test = replace_once(
    test,
    "test('native iPhone camera handoff releases and restores the Donezo stream', () => {\n  assert.match(app, /function openNativeCameraFallback\\(input\\)/);\n  assert.match(app, /function openNativeCameraFallback\\(input\\)[^]*stopDualCamera\\(\\)[^]*input\\?\\.click\\(\\)/);\n  assert.match(app, /visibilitychange[^]*document\\.visibilityState !== 'visible'[^]*return;[^]*startDualCameraIfNeeded\\(\\)/);\n  assert.match(app, /data-dual-fallback-main[^]*openNativeCameraFallback\\(dualProofMainInput\\)/);\n  assert.match(app, /data-dual-fallback-selfie[^]*openNativeCameraFallback\\(proofSelfieInput\\)/);\n});",
    "test('native iPhone camera handoff keeps the Donezo stream warm when possible', () => {\n  assert.match(app, /function openNativeCameraFallback\\(input\\)/);\n  assert.doesNotMatch(app, /function openNativeCameraFallback\\(input\\)[^}]*stopDualCamera\\(\\)/);\n  assert.match(app, /function openNativeCameraFallback\\(input\\)[^}]*input\\?\\.click\\(\\)/);\n  assert.match(app, /visibilitychange[^]*document\\.visibilityState !== 'visible'[^]*return;[^]*startDualCameraIfNeeded\\(\\)/);\n  assert.match(app, /data-dual-fallback-main[^]*openNativeCameraFallback\\(dualProofMainInput\\)/);\n  assert.match(app, /data-dual-fallback-selfie[^]*openNativeCameraFallback\\(proofSelfieInput\\)/);\n});",
    'native handoff regression',
)
write('test/photo-camera-friends-polish.test.mjs', test)

test = read('test/dual-updates-polish.test.mjs')
test = replace_once(
    test,
    "test('proof rejection shares the reaction row and is right aligned', () => {\n  const card = section(app, 'function activityCard(', 'function personProofCarousel(');\n  assert.match(card, /reaction-row[^`]*\\$\\{rejectionControl\\}/s);\n  assert.match(card, /class=\"vote-btn proof-rejection-inline/);\n  assert.doesNotMatch(card, /const proofActions[^\\n]*data-request-reject/);\n  assert.match(social, /\\.proof-rejection-inline\\{[^}]*margin-left:auto/);\n});",
    "test('proof rejection is visible in the proof header and kept out of the reaction row', () => {\n  const card = section(app, 'function activityCard(', 'function personProofCarousel(');\n  assert.match(card, /proof-card-header[^`]*\\$\\{rejectionControl\\}/s);\n  assert.match(card, /class=\"vote-btn proof-rejection-inline/);\n  assert.doesNotMatch(card, /reaction-row[^`]*\\$\\{rejectionControl\\}/s);\n  assert.match(social, /\\.proof-rejection-inline\\{[^}]*align-self:flex-start/);\n});",
    'reject placement regression',
)
write('test/dual-updates-polish.test.mjs', test)
