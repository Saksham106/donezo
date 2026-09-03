from pathlib import Path
import re

APP = Path('src/app.js')
CSS = Path('social.css')
app = APP.read_text()

old_import = "import { composeDualProof, createDualProofState, setDualProofFile } from './dual-proof.js';"
new_import = old_import + "\nimport { cropProofFile, inspectProofFile } from './proof-crop.js';"
assert old_import in app and "from './proof-crop.js'" not in app
app = app.replace(old_import, new_import, 1)

old_state = "let dualProof = null;\nlet dualRoleChoice = null;"
new_state = "let dualProof = null;\nlet dualRoleChoice = null;\nlet proofCrop = null;"
assert old_state in app
app = app.replace(old_state, new_state, 1)

crop_sheet = r'''function proofCropSheet() {
  if (!proofCrop) return '';
  const position = Math.max(0, Math.min(1, Number(proofCrop.position) || 0.5));
  return `<div class="sheet-backdrop proof-crop-layer"><section class="sheet compact-sheet proof-crop-sheet" role="dialog" aria-modal="true" aria-label="Crop proof" data-sheet><div class="sheet-handle"></div><div class="sheet-head"><div><p class="eyebrow">POSITION PROOF</p><h2>Choose what shows.</h2></div><button class="icon-btn" type="button" data-proof-crop-cancel aria-label="Cancel crop">×</button></div><p class="proof-sheet-copy">Drag the photo up or down. This is the only version that will be uploaded.</p><div class="proof-crop-frame" data-proof-crop-frame><img class="proof-crop-image" data-proof-crop-image src="${esc(proofCrop.previewUrl)}" alt="Crop preview" style="object-position:50% ${Math.round(position * 100)}%"></div><div class="proof-crop-actions"><button class="btn primary full" type="button" data-proof-crop-use>Use crop</button><button class="text-btn" type="button" data-proof-crop-cancel>Cancel</button></div></section></div>`;
}

function openProofCrop(review, sourceFile, { dual = false, selfieFile = null } = {}) {
  if (!review || !sourceFile) return false;
  if (proofCrop?.previewUrl) URL.revokeObjectURL(proofCrop.previewUrl);
  const previewUrl = URL.createObjectURL(sourceFile);
  proofCrop = {
    habitId: review.habitId,
    review,
    sourceFile,
    selfieFile,
    dual,
    previewUrl,
    position: 0.5,
  };
  render();
  return true;
}

function closeProofCrop() {
  if (proofCrop?.previewUrl) URL.revokeObjectURL(proofCrop.previewUrl);
  proofCrop = null;
  render();
}

async function handleUseProofCrop() {
  const crop = proofCrop;
  if (!crop || busy) return;
  try {
    const cropped = await cropProofFile(crop.sourceFile, crop.position);
    const artifact = crop.dual
      ? await composeDualProof(cropped, crop.selfieFile)
      : cropped;
    if (proofCrop?.previewUrl === crop.previewUrl) {
      URL.revokeObjectURL(crop.previewUrl);
      proofCrop = null;
    }
    await uploadProofArtifact(crop.review, artifact);
  } catch (error) {
    notify(readableError(error), 4200);
  }
}

'''
marker = 'function dualRoleChoiceSheet() {'
assert marker in app and 'function proofCropSheet()' not in app
app = app.replace(marker, crop_sheet + marker, 1)

old_submit_pattern = r"async function handleProofSubmit\(\) \{[\s\S]*?(?=async function loadProofThumbnail)"
new_submit = r'''async function uploadProofArtifact(review, artifact) {
  if (!review || !artifact || busy) return false;
  const habit = getState().habits.find((item) => item.id === review.habitId);
  if (!habit) return false;
  const checkInDate = today();
  let nextReview = review;
  if (artifact !== review.file) {
    const previewUrl = URL.createObjectURL(artifact);
    if (review.previewUrl) URL.revokeObjectURL(review.previewUrl);
    nextReview = createProofReviewState({ file: artifact, habitId: review.habitId, previewUrl });
  }
  nextReview = { ...nextReview, file: artifact, artifactFinalized: true, status: 'uploading', error: null };
  proofReview = nextReview;
  busy = true;
  render();
  try {
    await repo.completeWithProof(review.habitId, checkInDate, artifact);
    if (proofReview?.file === artifact) clearProofReview();
    proofHabit = null;
    clearDualProof();
    notify(`Proof saved · ${habit.title} 🧾`, 5000, { action: { label: 'Undo', onClick: () => handleUndoCheckIn(review.habitId, checkInDate) } });
    haptic(35);
    return true;
  } catch (error) {
    if (proofReview?.file === artifact) {
      proofReview = transitionProofReview(proofReview, { type: 'failed', error: readableError(error) });
      proofReview = { ...proofReview, artifactFinalized: true };
    }
    return false;
  } finally {
    busy = false;
    render();
  }
}

async function handleProofSubmit() {
  const review = proofReview;
  if (!review || review.status === 'uploading' || busy) return;
  if (networkBootLoading || !authoritativeReady) {
    notify('Refreshing your latest data…', 2200);
    return;
  }
  await refreshCoordinator?.waitForIdle();
  if (busy || proofReview !== review) return;
  if (review.artifactFinalized) {
    await uploadProofArtifact(review, review.file);
    return;
  }
  try {
    const matchingDual = dualProof?.habitId === review.habitId && dualProof.mainFile && dualProof.selfieFile;
    const cropSource = matchingDual ? dualProof.mainFile : review.file;
    const inspection = await inspectProofFile(cropSource);
    if (proofReview !== review) return;
    if (inspection.needsCrop) {
      openProofCrop(review, cropSource, {
        dual: Boolean(matchingDual),
        selfieFile: matchingDual ? dualProof.selfieFile : null,
      });
      return;
    }
    await uploadProofArtifact(review, review.file);
  } catch (error) {
    if (proofReview === review) {
      proofReview = transitionProofReview(review, { type: 'failed', error: readableError(error) });
      render();
    }
  }
}


'''
app, count = re.subn(old_submit_pattern, new_submit, app, count=1)
assert count == 1

crop_bindings = r'''function bindProofCropActions() {
  app.querySelectorAll('[data-proof-crop-cancel]').forEach((element) => { element.onclick = closeProofCrop; });
  app.querySelector('[data-proof-crop-use]')?.addEventListener('click', () => { void handleUseProofCrop(); });
  const frame = app.querySelector('[data-proof-crop-frame]');
  const image = app.querySelector('[data-proof-crop-image]');
  if (!frame || !image || !proofCrop) return;
  let dragging = false;
  let startY = 0;
  let startPosition = proofCrop.position;
  const updatePosition = (clientY) => {
    if (!dragging || !proofCrop) return;
    const deltaY = clientY - startY;
    const next = Math.max(0, Math.min(1, startPosition - (deltaY / Math.max(1, frame.clientHeight))));
    proofCrop.position = next;
    image.style.objectPosition = `50% ${Math.round(next * 100)}%`;
  };
  frame.addEventListener('pointerdown', (event) => {
    dragging = true;
    startY = event.clientY;
    startPosition = proofCrop?.position ?? 0.5;
    frame.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  });
  frame.addEventListener('pointermove', (event) => updatePosition(event.clientY));
  const finish = (event) => {
    if (!dragging) return;
    updatePosition(event.clientY);
    dragging = false;
    frame.releasePointerCapture?.(event.pointerId);
  };
  frame.addEventListener('pointerup', finish);
  frame.addEventListener('pointercancel', () => { dragging = false; });
}

'''
marker = 'function bindProofActions() {'
assert marker in app and 'function bindProofCropActions()' not in app
app = app.replace(marker, crop_bindings + marker, 1)

old_sheets = '${stakeSheet()}${dualRoleChoiceSheet()}${proofSourceSheet()}${proofReviewSheet()}'
new_sheets = '${stakeSheet()}${proofCropSheet()}${dualRoleChoiceSheet()}${proofSourceSheet()}${proofReviewSheet()}'
assert old_sheets in app
app = app.replace(old_sheets, new_sheets, 1)

old_bind = "  bindInviteActions();\n  bindProofActions();\n  app.querySelector('[data-manual-refresh]')"
new_bind = "  bindInviteActions();\n  bindProofActions();\n  bindProofCropActions();\n  app.querySelector('[data-manual-refresh]')"
assert old_bind in app
app = app.replace(old_bind, new_bind, 1)

# Finish deleting obsolete live-camera event bindings left behind by the earlier UI patch.
app, count = re.subn(
    r"  app\.querySelectorAll\('\[data-camera-mode\]'\)[\s\S]*?(?=  app\.querySelector\('\[data-retry-mutation\]'\))",
    '', app, count=1,
)
assert count == 1

# Closing any sheet must release the local crop URL without triggering an intermediate render.
old_close = "  proofHabit = null;\n  clearProofReview();"
new_close = "  if (proofCrop?.previewUrl) URL.revokeObjectURL(proofCrop.previewUrl);\n  proofCrop = null;\n  proofHabit = null;\n  clearProofReview();"
assert old_close in app
app = app.replace(old_close, new_close, 1)

old_draft = "    || Boolean(dualProof)\n    || Boolean(proofReview);"
new_draft = "    || Boolean(dualProof)\n    || Boolean(proofCrop)\n    || Boolean(proofReview);"
assert old_draft in app
app = app.replace(old_draft, new_draft, 1)

# Auth changes should not retain a crop object URL either.
old_boot = "  stopRefreshCoordinator();\n  clearProofReview();\n  proofHabit = null;"
new_boot = "  stopRefreshCoordinator();\n  if (proofCrop?.previewUrl) URL.revokeObjectURL(proofCrop.previewUrl);\n  proofCrop = null;\n  clearProofReview();\n  proofHabit = null;"
assert old_boot in app
app = app.replace(old_boot, new_boot, 1)

APP.write_text(app)

css = CSS.read_text()
if '.proof-crop-frame{' not in css:
    css += "\n.proof-crop-sheet{overflow:hidden}.proof-crop-frame{position:relative;width:100%;aspect-ratio:3/4;overflow:hidden;border:var(--rule-hairline) solid var(--color-rule);border-radius:var(--radius-lg);background:var(--color-ink);touch-action:none;cursor:grab}.proof-crop-frame:active{cursor:grabbing}.proof-crop-image{display:block;width:100%;height:100%;object-fit:cover;object-position:50% 50%;user-select:none;-webkit-user-drag:none;pointer-events:none}.proof-crop-actions{display:grid;gap:var(--space-2);margin-top:var(--space-3)}\n"
CSS.write_text(css)
