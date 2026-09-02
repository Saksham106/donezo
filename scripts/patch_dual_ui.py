from pathlib import Path
import re

app_path = Path('src/app.js')
text = app_path.read_text()


def rep(old, new, expected=1):
    global text
    count = text.count(old)
    if count != expected:
        raise SystemExit(f'expected {expected}, found {count}: {old[:140]!r}')
    text = text.replace(old, new, expected)


def section(start, end, replacement):
    global text
    i = text.find(start)
    if i < 0:
        raise SystemExit(f'missing section start: {start}')
    j = text.find(end, i + len(start))
    if j < 0:
        raise SystemExit(f'missing section end: {end}')
    text = text[:i] + replacement.rstrip() + '\n\n' + text[j:]


# Imports and global state.
rep(
    "import { MAX_PROOF_BYTES, compressProofFile, createProofReviewState, formatProofFileSize, imageFileFromPasteData, readClipboardImage, transitionProofReview, validateProofFile } from './proof.js';",
    "import { MAX_PROOF_BYTES, compressProofFile, createProofReviewState, formatProofFileSize, imageFileFromPasteData, readClipboardImage, requiresPhotoProof, transitionProofReview, validateProofFile } from './proof.js';\nimport { captureVideoFrame, composeDualProof, createDualProofState, dualCameraSupported, stopMediaStream, transitionDualProof } from './dual-proof.js';",
)
rep(
    "const proofGalleryInput = document.querySelector('#proof-gallery-input');",
    "const proofGalleryInput = document.querySelector('#proof-gallery-input');\nconst dualProofMainInput = document.querySelector('#dual-proof-main-input');\nconst proofSelfieInput = document.querySelector('#proof-selfie-input');",
)
rep("let proofViewer = null;\nlet proofViewerRequestId = 0;\n", "")
rep("let squadFeed = localStorage.getItem('donezo.squadFeed') || 'proofs';\n", "")
rep(
    "let proofPreparationId = 0;",
    "let proofPreparationId = 0;\nlet dualProof = null;\nlet dualCameraStream = null;\nlet dualCameraRequestId = 0;",
)

# Top bar and unified update helpers.
old_topbar = """function topbar() {
  const state = getState();
  const unread = incomingNudges().filter((nudge) => !nudge.readAt).length;
  const friendsLink = `<button class="friends-toplink" type="button" data-friends aria-label="Open Friends">Friends</button>`;
  return `<header class="topbar"><button class="brand brand-button" data-home aria-label="Go to Today"><span>ϟ</span><strong>Donezo</strong></button>${friendsLink}<div class="top-actions"><button class="top-icon-btn" data-nudge-inbox aria-label="Open nudges">${icon('bolt')}${unread ? `<i>${unread > 9 ? '9+' : unread}</i>` : ''}</button><button class="avatar profile-button" data-settings aria-label="Open settings">${esc(me()?.avatar || '?')}</button></div></header>`;
}
"""
new_topbar = """function topbar() {
  const unread = unseenUpdatesCount();
  const friendsLink = `<button class="friends-toplink" type="button" data-friends aria-label="Open Friends">Friends</button>`;
  return `<header class="topbar"><button class="brand brand-button" data-home aria-label="Go to Today"><span>ϟ</span><strong>Donezo</strong></button>${friendsLink}<div class="top-actions"><button class="top-icon-btn" data-nudge-inbox aria-label="Open Updates">${icon('bolt')}${unread ? `<i>${unread > 9 ? '9+' : unread}</i>` : ''}</button><button class="avatar profile-button" data-settings aria-label="Open settings">${esc(me()?.avatar || '?')}</button></div></header>`;
}
"""
rep(old_topbar, new_topbar)

incoming = """function incomingNudges() {
  return (getState()?.nudges || []).filter((nudge) => nudge.toUserId === me()?.id);
}
"""
updates_helpers = incoming + """
function updatesList(state = getState()) {
  const nudges = incomingNudges().map((nudge) => ({
    kind: 'nudge',
    id: `nudge:${nudge.id}`,
    sourceId: nudge.id,
    userId: nudge.fromUserId,
    when: nudge.createdAt,
    message: nudge.message,
    readAt: nudge.readAt || null,
  }));
  const activities = activityList(state).filter((activity) => !activity.proofPath).map((activity) => ({
    kind: 'activity',
    id: `activity:${activity.id}`,
    sourceId: activity.id,
    userId: activity.userId,
    when: activity.when,
    message: activity.message || `${activity.emoji || '✓'} ${activity.habitTitle || 'Habit'}`,
    activity,
  }));
  return [...nudges, ...activities].sort((a, b) => new Date(b.when) - new Date(a.when));
}

function unseenUpdatesCount(state = getState()) {
  const lastSeen = new Date(state?.updatesLastSeenAt || 0).getTime();
  const activityCount = activityList(state).filter((activity) => !activity.proofPath && new Date(activity.when).getTime() > lastSeen).length;
  const nudgeCount = incomingNudges().filter((nudge) => !nudge.readAt).length;
  return activityCount + nudgeCount;
}

async function openUpdatesCenter() {
  nudgeInboxOpen = true;
  const optimisticAt = new Date().toISOString();
  repo.applyUpdatesSeen?.(optimisticAt);
  render();
  try {
    await repo.markUpdatesSeen?.();
    scheduleStateCacheWrite();
  } catch (error) {
    notify(readableError(error), 3600);
    void refreshCoordinator?.request('updates-seen-failed');
  }
  render();
}
"""
rep(incoming, updates_helpers)

# Proof card media is the full image; rejection controls remain below it.
rep(
    "const proofPreview = showProofActions && activity.proofPath ? `<button class=\"proof-thumbnail\" type=\"button\" data-proof=\"${esc(activity.proofPath)}\" data-proof-thumbnail=\"${esc(activity.proofPath)}\" aria-label=\"Open ${esc(activity.habitTitle)} proof\"><span aria-hidden=\"true\">📷</span><small>Loading proof…</small></button>` : '';",
    "const proofPreview = showProofActions && activity.proofPath ? `<div class=\"proof-media\" data-proof-image=\"${esc(activity.proofPath)}\" aria-label=\"${esc(activity.habitTitle)} proof\"><span aria-hidden=\"true\">📷</span><small>Loading proof…</small></div>` : '';",
)
rep(
    "const proofActions = showProofActions && activity.proofPath ? `<div class=\"proof-actions\"><button class=\"btn proof-btn\" data-proof=\"${esc(activity.proofPath)}\">Open proof</button>${mine ? `${rejectionStatus}${activity.invalid ? `<button class=\"btn danger-soft\" data-redo-checkin=\"${activity.checkInId}\">Run it back</button>` : ''}` : `<button class=\"vote-btn ${activity.userDownvoted ? 'active' : ''}\" data-request-reject=\"${activity.checkInId}\" aria-label=\"${activity.userDownvoted ? 'Remove proof rejection' : 'Reject proof'}\">👎 <span>${rejectionLabel}</span></button>`}</div>` : '';",
    "const proofActions = showProofActions && activity.proofPath ? `<div class=\"proof-actions\">${mine ? `${rejectionStatus}${activity.invalid ? `<button class=\"btn danger-soft\" data-redo-checkin=\"${activity.checkInId}\">Run it back</button>` : ''}` : `<button class=\"vote-btn ${activity.userDownvoted ? 'active' : ''}\" data-request-reject=\"${activity.checkInId}\" aria-label=\"${activity.userDownvoted ? 'Remove proof rejection' : 'Reject proof'}\">👎 <span>${rejectionLabel}</span></button>`}</div>` : '';",
)

# Legacy squad route and active Friends screen both become proof-only.
section(
    "function squadScreen() {",
    "function friendsScreen() {",
    """function squadScreen() {
  return friendsScreen();
}
""",
)
section(
    "function friendsScreen() {",
    "function challengeProgress(",
    """function friendsScreen() {
  const state = getState();
  const feed = activityList(state).filter((activity) => activity.proofPath);
  const visibleActivities = feed.slice(0, feedLimit);
  const activities = visibleActivities.map((activity) => activityCard(activity, { showProofActions: true })).join('');
  const loadMore = feed.length > visibleActivities.length ? `<button class="btn full load-more" type="button" data-load-more>Load older proofs</button>` : '';
  const syncText = lastRefreshAt ? `Synced ${formatWhen(lastRefreshAt)}` : 'Ready to sync';
  const refreshButton = `<button class="refresh-btn ${manualRefreshLoading ? 'loading' : ''}" type="button" data-manual-refresh aria-label="Refresh Friends" title="Refresh" ${manualRefreshLoading ? 'disabled' : ''}><span aria-hidden="true">↻</span></button>`;
  const peopleButton = `<button class="invite-icon-btn" type="button" data-people-open aria-label="View friends" title="Friends">${icon('people')}</button>`;
  const empty = '<div class="empty compact-empty"><b>No proofs yet.</b><p>Post a photo check-in and give your friends something to react to.</p><button class="btn primary empty-action" type="button" data-empty-checkin>Check in</button></div>';
  return `${pageHeading('Friends', 'YOUR PEOPLE')}<div class="squad-refresh-row"><small>${esc(syncText)}</small><div class="squad-actions">${refreshButton}${peopleButton}</div></div><div class="activity-list">${activities || empty}${loadMore}</div>`;
}
""",
)

# Habit proof labels/options.
rep(
    "${habit.proofMode === 'photo' ? ' · Photo proof' : ' · Truuust mode'}",
    "${habit.proofMode === 'dual_photo' ? ' · Dual photo' : habit.proofMode === 'photo' ? ' · Photo proof' : ' · Truuust mode'}",
)
rep(
    "<option value=\"photo\" ${proofMode === 'photo' ? 'selected' : ''}>Photo / screenshot</option><option value=\"none\" ${proofMode === 'none' ? 'selected' : ''}>Truuust me</option>",
    "<option value=\"photo\" ${proofMode === 'photo' ? 'selected' : ''}>Photo / screenshot</option><option value=\"dual_photo\" ${proofMode === 'dual_photo' ? 'selected' : ''}>Dual photo</option><option value=\"none\" ${proofMode === 'none' ? 'selected' : ''}>Truuust me</option>",
)

# Unified Updates sheet.
section(
    "function nudgeInboxSheet() {",
    "function settingsSheet() {",
    """function nudgeInboxSheet() {
  if (!nudgeInboxOpen) return '';
  const updates = updatesList();
  const rows = updates.map((item) => {
    const actor = member(item.userId);
    if (item.kind === 'nudge') {
      return `<article class="inbox-nudge ${item.readAt ? 'read' : ''}"><div><strong>⚡ ${esc(actor?.name || 'Friend')}</strong><p>${esc(item.message)}</p><small>${esc(formatWhen(item.when))}</small></div>${item.readAt ? '<span>Seen</span>' : `<button class="btn small-btn" type="button" data-read-nudge="${item.sourceId}">Got it</button>`}</article>`;
    }
    const activity = item.activity;
    const detail = activity?.habitTitle ? `${activity.emoji || '✓'} ${activity.habitTitle}` : item.message;
    return `<button class="update-activity-row" type="button" data-friend-profile="${item.userId}"><span class="avatar">${esc(actor?.avatar || '?')}</span><span><strong>${esc(actor?.name || 'Friend')}</strong><p>${esc(detail)}</p><small>${esc(formatWhen(item.when))}</small></span></button>`;
  }).join('');
  return `<div class="sheet-backdrop" data-close-sheet><section class="sheet compact-sheet updates-sheet" role="dialog" aria-modal="true" aria-label="Updates" data-sheet><div class="sheet-handle"></div><div class="sheet-head"><div><p class="eyebrow">UPDATES</p><h2>${updates.length ? 'What happened' : 'All caught up'}</h2></div><button class="icon-btn" type="button" data-close-inbox aria-label="Close">×</button></div>${rows ? `<div class="inbox-list updates-list">${rows}</div>` : '<div class="empty compact-empty"><b>Quiet right now.</b><p>Nudges and friend activity will show up here.</p></div>'}</section></div>`;
}
""",
)

# Dual proof sheet + review. The regular source picker stays unchanged.
dual_sheet = """function dualProofSheet() {
  if (!dualProof || proofReview) return '';
  const habit = getState()?.habits.find((item) => item.id === dualProof.habitId);
  if (!habit) return '';
  const mainStep = dualProof.phase === 'main';
  const title = mainStep ? 'Show what you did' : 'Now show you';
  const copy = mainStep ? 'Take the proof photo with the rear camera.' : 'Flip it around for the selfie.';
  const fallbackAttr = mainStep ? 'data-dual-fallback-main' : 'data-dual-fallback-selfie';
  return `<div class="sheet-backdrop"><section class="sheet dual-proof-sheet" role="dialog" aria-modal="true" aria-label="Dual photo proof" data-sheet><div class="sheet-handle"></div><div class="sheet-head"><div><p class="eyebrow">DUAL PROOF</p><h2>${esc(title)}</h2></div><button class="icon-btn" type="button" data-dual-cancel aria-label="Cancel proof">×</button></div><p class="proof-sheet-copy">${esc(copy)}</p><div class="dual-camera-frame"><video data-dual-camera autoplay playsinline muted></video><div class="dual-camera-loading">Starting camera…</div></div>${dualProof.error ? `<div class="proof-error" role="alert"><p>${esc(dualProof.error)}</p></div>` : ''}<button class="btn primary full" type="button" data-dual-capture>Capture</button><button class="text-btn" type="button" ${fallbackAttr}>Use phone camera instead</button></section></div>`;
}

"""
text = text.replace("function proofSourceSheet() {", dual_sheet + "function proofSourceSheet() {", 1)

section(
    "function proofReviewSheet() {",
    "function proofViewerSheet() {",
    """function proofReviewSheet() {
  if (!proofReview) return '';
  const habit = getState()?.habits.find((item) => item.id === proofReview.habitId);
  if (!habit) return '';
  const uploading = proofReview.status === 'uploading';
  const submitLabel = uploading ? 'Uploading…' : proofReview.status === 'error' ? 'Retry proof' : 'Submit proof';
  const dual = habit.proofMode === 'dual_photo' && dualProof?.habitId === habit.id;
  const replaceActions = dual
    ? `<div class="proof-review-actions"><button class="btn" type="button" data-dual-retake-main ${uploading ? 'disabled' : ''}>Retake proof</button><button class="btn" type="button" data-dual-retake-selfie ${uploading ? 'disabled' : ''}>Retake selfie</button></div>`
    : `<div class="proof-review-actions"><button class="btn" type="button" data-proof-retake ${uploading ? 'disabled' : ''}>Retake</button><button class="btn" type="button" data-proof-choose ${uploading ? 'disabled' : ''}>Choose another</button></div>`;
  return `<div class="sheet-backdrop"><section class="sheet proof-review-sheet" role="dialog" aria-modal="true" aria-label="Review proof" data-sheet><div class="sheet-handle"></div><div class="sheet-head"><div><p class="eyebrow">REVIEW PROOF</p><h2>${esc(habit.emoji)} ${esc(habit.title)}</h2></div><button class="icon-btn" type="button" data-proof-review-close aria-label="Cancel proof" ${uploading ? 'disabled' : ''}>×</button></div><div class="proof-preview-frame"><img src="${esc(proofReview.previewUrl)}" alt="Selected proof for ${esc(habit.title)}"></div><div class="proof-file-meta"><strong>Looks usable?</strong><span>${esc(formatProofFileSize(proofReview.file.size))} · max 4 MB</span></div>${proofReview.error ? `<div class="proof-error" role="alert"><strong>That didn’t upload.</strong><p>${esc(proofReview.error)} Your photo is still here, so you can retry.</p></div>` : ''}${replaceActions}<div class="upload-status" aria-live="polite" data-upload-status>${uploading ? 'Uploading proof. Keep Donezo open.' : proofReview.status === 'error' ? 'Upload failed. Your photo is saved for retry.' : 'Ready to submit.'}</div><button class="btn primary full proof-submit-btn" type="button" data-proof-submit ${uploading ? 'disabled aria-busy="true"' : ''}>${submitLabel}</button><button class="text-btn" type="button" data-proof-review-close ${uploading ? 'disabled' : ''}>Cancel</button></section></div>`;
}
""",
)
# Remove the viewer function entirely.
section("function proofViewerSheet() {", "function clearProofReview() {", "")

# Dual camera behavior goes immediately before proof-review cleanup.
dual_logic = r'''function stopDualCamera() {
  dualCameraRequestId += 1;
  stopMediaStream(dualCameraStream);
  dualCameraStream = null;
}

function clearDualProof() {
  stopDualCamera();
  dualProof = null;
}

async function startDualCameraIfNeeded() {
  if (!dualProof || proofReview || !['main', 'selfie'].includes(dualProof.phase)) return;
  const video = app.querySelector('[data-dual-camera]');
  if (!video || !dualCameraSupported()) return;
  const requestId = ++dualCameraRequestId;
  stopMediaStream(dualCameraStream);
  dualCameraStream = null;
  try {
    const facing = dualProof.phase === 'main' ? 'environment' : 'user';
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: facing } }, audio: false });
    if (requestId !== dualCameraRequestId || !dualProof || !video.isConnected) {
      stopMediaStream(stream);
      return;
    }
    dualCameraStream = stream;
    video.srcObject = stream;
    await video.play?.().catch(() => {});
    video.parentElement?.querySelector('.dual-camera-loading')?.remove();
  } catch (error) {
    if (requestId !== dualCameraRequestId || !dualProof) return;
    dualProof = transitionDualProof(dualProof, { type: 'failed', error: 'Camera access failed. Use the phone camera fallback below.' });
    render();
  }
}

async function finishDualSelection(file, side) {
  if (!dualProof || !file) return;
  const validation = validateProofFile(file);
  if (!validation.valid) {
    notify(validation.error, 3400);
    return;
  }
  const prepared = file.size > MAX_PROOF_BYTES ? await compressProofFile(file) : file;
  dualProof = transitionDualProof(dualProof, { type: side === 'main' ? 'main_selected' : 'selfie_selected', file: prepared });
  stopDualCamera();
  if (dualProof.phase === 'review') {
    try {
      const composite = await composeDualProof(dualProof.mainFile, dualProof.selfieFile);
      const previewUrl = URL.createObjectURL(composite);
      proofReview = createProofReviewState({ file: composite, habitId: dualProof.habitId, previewUrl });
    } catch (error) {
      dualProof = transitionDualProof(dualProof, { type: 'failed', error: readableError(error) });
    }
  }
  render();
}

async function captureDualCamera() {
  if (!dualProof) return;
  const video = app.querySelector('[data-dual-camera]');
  if (!video || !dualCameraStream) {
    (dualProof.phase === 'main' ? dualProofMainInput : proofSelfieInput)?.click();
    return;
  }
  try {
    const side = dualProof.phase;
    const file = await captureVideoFrame(video, { facing: side === 'main' ? 'environment' : 'user' });
    await finishDualSelection(file, side);
  } catch (error) {
    dualProof = transitionDualProof(dualProof, { type: 'failed', error: readableError(error) });
    render();
  }
}

'''
text = text.replace("function clearProofReview() {", dual_logic + "function clearProofReview() {", 1)

# Closing/reviewing a proof also clears live camera state when appropriate.
rep(
    "function dismissProofReview() {\n  clearProofReview();\n  proofHabit = null;\n  render();\n}",
    "function dismissProofReview() {\n  clearProofReview();\n  proofHabit = null;\n  clearDualProof();\n  render();\n}",
)
rep(
    "    if (proofReview?.previewUrl === review.previewUrl) clearProofReview();\n    proofHabit = null;",
    "    if (proofReview?.previewUrl === review.previewUrl) clearProofReview();\n    proofHabit = null;\n    clearDualProof();",
)

# Remove standalone viewer loader; inline loader keeps signed-url caching.
section("async function loadProofViewerUrl() {", "async function loadProofThumbnail(", "")
text = text.replace('dataset.proofThumbnail', 'dataset.proofImage')
text = text.replace('[data-proof-thumbnail]', '[data-proof-image]')
text = text.replace('data-proof-thumbnail', 'data-proof-image')

# Remove any dedicated proof-open handler if present.
match = re.search(r"\n(?:async )?function handleProofView\([^\n]*\)[\s\S]*?(?=\n(?:async )?function )", text)
if match:
    text = text[:match.start()] + '\n' + text[match.end():]

# Route proof habits and dual proof habits correctly.
rep("if (habit.proofMode === 'photo' || checkIn.proofPath) {", "if (requiresPhotoProof(habit.proofMode) || checkIn.proofPath) {")
rep(
    "  if (habit.proofMode === 'photo') {\n    proofHabit = id;\n    render();\n    return;\n  }",
    "  if (habit.proofMode === 'dual_photo') {\n    dualProof = createDualProofState(id);\n    render();\n    return;\n  }\n  if (habit.proofMode === 'photo') {\n    proofHabit = id;\n    render();\n    return;\n  }",
)

# Open Updates atomically instead of simply opening the old nudge sheet.
rep("app.querySelectorAll('[data-nudge-inbox]').forEach((element) => { element.onclick = () => { nudgeInboxOpen = true; render(); }; });", "app.querySelectorAll('[data-nudge-inbox]').forEach((element) => { element.onclick = () => { void openUpdatesCenter(); }; });")
# Remove click-to-open proof binding.
text = re.sub(r"\n\s*app\.querySelectorAll\('\[data-proof\]'\)\.forEach\([^\n]*\);", "", text)

# Add dual controls to the existing binding pass.
anchor = "  app.querySelector('[data-retry-mutation]')?.addEventListener('click', () => retryMutation?.());"
dual_bindings = """  app.querySelector('[data-dual-capture]')?.addEventListener('click', () => { void captureDualCamera(); });
  app.querySelector('[data-dual-fallback-main]')?.addEventListener('click', () => dualProofMainInput?.click());
  app.querySelector('[data-dual-fallback-selfie]')?.addEventListener('click', () => proofSelfieInput?.click());
  app.querySelector('[data-dual-cancel]')?.addEventListener('click', () => { clearDualProof(); render(); });
  app.querySelector('[data-dual-retake-main]')?.addEventListener('click', () => { clearProofReview(); dualProof = transitionDualProof(dualProof, { type: 'retake_main' }); render(); });
  app.querySelector('[data-dual-retake-selfie]')?.addEventListener('click', () => { clearProofReview(); dualProof = transitionDualProof(dualProof, { type: 'retake_selfie' }); render(); });
"""
if anchor not in text:
    raise SystemExit('missing proof binding anchor')
text = text.replace(anchor, dual_bindings + anchor, 1)

# Render dual capture and stop rendering the removed viewer.
rep("${proofSourceSheet()}${proofReviewSheet()}${proofViewerSheet()}", "${proofSourceSheet()}${dualProofSheet()}${proofReviewSheet()}")
# Start camera after the freshly-rendered video element exists.
rep("  bindProofThumbnails();", "  bindProofThumbnails();\n  void startDualCameraIfNeeded();")

# Remove stale proof-viewer cleanup/state references.
text = text.replace("  proofViewer = null;\n", "")
text = re.sub(r"\n\s*app\.querySelector[^\n]*data-proof-viewer[^\n]*", "", text)
text = re.sub(r"\n\s*const expectedUrl = proofViewer[^\n]*", "", text)
text = re.sub(r"\n\s*if \(proofViewer[^\n]*", "", text)

# Fallback inputs are stable DOM nodes outside app rerenders.
text += """

dualProofMainInput?.addEventListener('change', async () => {
  const file = dualProofMainInput.files?.[0];
  dualProofMainInput.value = '';
  if (file) await finishDualSelection(file, 'main');
});
proofSelfieInput?.addEventListener('change', async () => {
  const file = proofSelfieInput.files?.[0];
  proofSelfieInput.value = '';
  if (file) await finishDualSelection(file, 'selfie');
});
"""

# Postconditions: old product state/viewer must really be gone.
if 'proofViewer' in text:
    raise SystemExit('proofViewer reference survived UI patch')
if 'squadFeed' in text or 'donezo.squadFeed' in text or 'data-squad-feed' in text:
    raise SystemExit('squadFeed reference survived UI patch')
for required in ['function updatesList', 'function unseenUpdatesCount', 'class="proof-media"', 'function dualProofSheet', 'composeDualProof']:
    if required not in text:
        raise SystemExit(f'missing required UI marker: {required}')
app_path.write_text(text)

# Hidden fallback camera inputs.
index_path = Path('index.html')
html = index_path.read_text()
old = '  <input id="proof-gallery-input" type="file" accept="image/*" hidden />'
new = old + '\n  <input id="dual-proof-main-input" type="file" accept="image/*" capture="environment" hidden />\n  <input id="proof-selfie-input" type="file" accept="image/*" capture="user" hidden />'
if old not in html:
    raise SystemExit('missing proof gallery input')
index_path.write_text(html.replace(old, new, 1))

# Full-image proof media + compact Updates/dual-camera styling.
css_path = Path('social.css')
css = css_path.read_text()
css += r'''

/* Full proof media: Instagram-style complete image, never crop the main proof. */
.proof-media{width:100%;margin:var(--space-3) 0;overflow:hidden;border-radius:var(--radius-md);background:var(--color-paper-2)}
.proof-media img{display:block;width:100%;height:auto;object-fit:contain}
.proof-media>span,.proof-media>small{display:block;padding:var(--space-3);color:var(--color-muted);text-align:center}
.proof-media.is-error{padding:var(--space-4);color:var(--color-muted);text-align:center}
.updates-list{display:grid;gap:var(--space-2)}
.update-activity-row{display:grid;grid-template-columns:auto minmax(0,1fr);align-items:center;gap:var(--space-3);width:100%;min-height:0;padding:var(--space-3);border:var(--rule-hairline) solid var(--color-rule);border-radius:var(--radius-md);background:var(--color-surface);color:var(--color-ink);text-align:left}
.update-activity-row p,.update-activity-row small{display:block;margin:.15rem 0 0;color:var(--color-muted);font-size:var(--text-xs)}
.dual-camera-frame{position:relative;overflow:hidden;min-height:18rem;border-radius:var(--radius-lg);background:#111}
.dual-camera-frame video{display:block;width:100%;max-height:62vh;object-fit:contain;background:#111}
.dual-camera-loading{position:absolute;inset:0;display:grid;place-items:center;color:#fff;font-size:var(--text-sm)}
.dual-proof-sheet .proof-sheet-copy{margin-top:0}
'''
css_path.write_text(css)
