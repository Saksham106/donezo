from pathlib import Path

path = Path('src/app.js')
text = path.read_text()

def replace_once(old, new, label):
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected 1 match, found {count}')
    text = text.replace(old, new, 1)

replace_once(
    '<button class="btn primary full" type="button" data-proof-camera>Take photo</button><button class="btn full" type="button" data-proof-gallery>Choose from library</button>',
    '<button class="btn primary full" type="button" data-proof-camera>Take photo</button><button class="btn full" type="button" data-proof-donezo-camera>Use Donezo camera</button><button class="btn full" type="button" data-proof-gallery>Choose from library</button>',
    'proof source camera hierarchy',
)

replace_once(
    ': `<div class="proof-review-actions"><button class="btn" type="button" data-proof-retake ${uploading ? \'disabled\' : \'\'}>Retake</button><button class="btn" type="button" data-proof-choose ${uploading ? \'disabled\' : \'\'}>Choose another</button></div>`;',
    ': `<div class="proof-review-actions"><button class="btn" type="button" data-proof-retake ${uploading ? \'disabled\' : \'\'}>Retake</button><button class="btn" type="button" data-proof-choose ${uploading ? \'disabled\' : \'\'}>Choose another</button></div><button class="btn full proof-add-selfie-btn" type="button" data-proof-add-selfie ${uploading ? \'disabled\' : \'\'}>Add selfie · make it Dual</button>`;',
    'native review dual upgrade',
)

replace_once(
    "  app.querySelectorAll('[data-proof-camera]').forEach((element) => { element.onclick = () => {\n    if (!proofHabit) return;\n    dualProof = createDualProofState(proofHabit, 'single');\n    proofHabit = null;\n    render();\n  }; });\n",
    "  app.querySelectorAll('[data-proof-camera]').forEach((element) => { element.onclick = () => chooseProofInput(proofInput); });\n  app.querySelectorAll('[data-proof-donezo-camera]').forEach((element) => { element.onclick = () => {\n    if (!proofHabit) return;\n    dualProof = createDualProofState(proofHabit, 'single');\n    proofHabit = null;\n    render();\n  }; });\n",
    'proof camera bindings',
)

replace_once(
    "  app.querySelectorAll('[data-proof-retake]').forEach((element) => { element.onclick = () => {\n    if (!proofReview) return;\n    const habitId = proofReview.habitId;\n    clearProofReview();\n    clearDualProof();\n    dualProof = createDualProofState(habitId, 'single');\n    render();\n  }; });\n",
    "  app.querySelectorAll('[data-proof-retake]').forEach((element) => { element.onclick = () => replaceProofSelection(proofInput); });\n  app.querySelectorAll('[data-proof-add-selfie]').forEach((element) => { element.onclick = () => {\n    if (!proofReview) return;\n    const habitId = proofReview.habitId;\n    const mainFile = proofReview.file;\n    dualProof = { ...createDualProofState(habitId, 'dual'), phase: 'selfie', mainFile };\n    proofSelfieInput?.click();\n  }; });\n",
    'native retake and dual upgrade bindings',
)

replace_once(
    '  return `<section class="friends-heading"><p class="eyebrow">YOUR PEOPLE</p><div class="friends-heading-row"><h1>Friends</h1><div class="friends-heading-actions">${refreshButton}${peopleButton}</div></div></section><div class="activity-list">${activities || empty}${loadMore}</div>`;',
    '  return `<section class="friends-heading"><div class="friends-heading-row"><h1>Friends</h1><div class="friends-heading-actions">${refreshButton}${peopleButton}</div></div></section><div class="activity-list">${activities || empty}${loadMore}</div>`;',
    'Friends eyebrow removal',
)

replace_once(
    "  app.querySelectorAll('[data-comment-open]').forEach((element) => { element.onclick = () => { commentCheckInId = element.dataset.commentOpen; render(); }; });",
    "  app.querySelectorAll('[data-comment-open]').forEach((element) => { element.onclick = () => openCommentSheet(element.dataset.commentOpen); });",
    'comment open binding',
)

comment_helpers = r'''
function closeCommentSheet() {
  commentCheckInId = null;
  app.querySelector('.comment-sheet')?.closest('.sheet-backdrop')?.remove();
}

function bindCommentSheetActions() {
  const sheet = app.querySelector('.comment-sheet');
  if (!sheet) return;
  const backdrop = sheet.closest('.sheet-backdrop');
  backdrop?.addEventListener('click', (event) => {
    if (event.target === backdrop) closeCommentSheet();
  });
  sheet.querySelector('[data-close-social-sheet]')?.addEventListener('click', closeCommentSheet);
  sheet.querySelector('#comment-form')?.addEventListener('submit', handleCommentSubmit);
  sheet.querySelectorAll('[data-delete-comment]').forEach((element) => {
    element.onclick = () => handleDeleteComment(element.dataset.deleteComment);
  });
  sheet.querySelectorAll('[data-friend-profile]').forEach((element) => {
    element.onclick = () => openFriendProfile(element.dataset.friendProfile);
  });
  bindSheetSwipeDismiss();
}

function refreshCommentSheet() {
  if (!commentCheckInId) return;
  app.querySelector('.comment-sheet')?.closest('.sheet-backdrop')?.remove();
  app.querySelector('.app-shell')?.insertAdjacentHTML('beforeend', commentSheet());
  bindCommentSheetActions();
}

function openCommentSheet(checkInId) {
  if (!checkInId) return;
  commentCheckInId = checkInId;
  app.querySelector('.comment-sheet')?.closest('.sheet-backdrop')?.remove();
  app.querySelector('.app-shell')?.insertAdjacentHTML('beforeend', commentSheet());
  bindCommentSheetActions();
}

'''
replace_once('\nfunction batonSheet() {', '\n' + comment_helpers + 'function batonSheet() {', 'comment overlay helpers')

# Keep optimistic comment updates inside the reply overlay instead of rebuilding
# the proof feed underneath it.
for start, end, label in [
    ('async function handleCommentSubmit(event) {', 'async function handleUndoCommentDelete(comment) {', 'comment submit'),
    ('async function handleUndoCommentDelete(comment) {', 'async function handleDeleteComment(commentId) {', 'comment undo'),
    ('async function handleDeleteComment(commentId) {', 'async function handleBatonSubmit(event) {', 'comment delete'),
]:
    a = text.index(start)
    b = text.index(end, a)
    block = text[a:b]
    if 'renderPreservingScroll();' not in block:
        raise SystemExit(f'{label}: missing renderPreservingScroll')
    text = text[:a] + block.replace('renderPreservingScroll();', 'refreshCommentSheet();') + text[b:]

replace_once(
    "      if (shouldClose) {\n        resetVisuals();\n        closeSheets();\n        render();\n        return;\n      }",
    "      if (shouldClose) {\n        resetVisuals();\n        if (sheet.classList.contains('comment-sheet')) {\n          closeCommentSheet();\n          return;\n        }\n        closeSheets();\n        render();\n        return;\n      }",
    'comment swipe close',
)

# Revoke the old single-photo preview when a native selfie successfully upgrades
# it into a composite.
replace_once(
    "      const previewUrl = URL.createObjectURL(output);\n      proofReview = createProofReviewState({ file: output, habitId: dualProof.habitId, previewUrl });",
    "      const previewUrl = URL.createObjectURL(output);\n      if (proofReview?.previewUrl) URL.revokeObjectURL(proofReview.previewUrl);\n      proofReview = createProofReviewState({ file: output, habitId: dualProof.habitId, previewUrl });",
    'dual upgrade preview cleanup',
)

path.write_text(text)
