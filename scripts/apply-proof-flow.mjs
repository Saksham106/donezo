import { readFile, writeFile } from 'node:fs/promises';

const appPath = 'src/app.js';
const socialPath = 'social.css';
let app = await readFile(appPath, 'utf8');
let social = await readFile(socialPath, 'utf8');

if (app.includes('function proofReviewSheet()') && app.includes('function proofViewerSheet()')) {
  console.log('Proof flow already applied.');
  process.exit(0);
}

function replaceOnce(search, replacement, label) {
  if (!app.includes(search)) throw new Error(`${label}: source pattern not found`);
  app = app.replace(search, replacement);
}

replaceOnce(
  "import { buildAuthRedirectUrl, buildInviteLink, clearInviteParam, parseInviteParam, validateInviteCode } from './invite.js';\n",
  "import { buildAuthRedirectUrl, buildInviteLink, clearInviteParam, parseInviteParam, validateInviteCode } from './invite.js';\nimport { createProofReviewState, formatProofFileSize, transitionProofReview, validateProofFile } from './proof.js';\n",
  'proof helper import',
);

replaceOnce(
  "const proofInput = document.querySelector('#proof-input');\n",
  "const proofInput = document.querySelector('#proof-input');\nconst proofGalleryInput = document.querySelector('#proof-gallery-input');\n",
  'gallery input',
);

replaceOnce(
  "let proofHabit = null;\n",
  "let proofHabit = null;\nlet proofReview = null;\nlet proofViewer = null;\n",
  'proof state',
);

const proofSheets = `function proofSourceSheet() {
  if (!proofHabit || proofReview) return '';
  const habit = getState()?.habits.find((item) => item.id === proofHabit);
  if (!habit) return '';
  return \`<div class="sheet-backdrop" data-close-sheet><section class="sheet compact-sheet proof-source-sheet" role="dialog" aria-modal="true" aria-label="Add proof" data-sheet><div class="sheet-handle"></div><div class="sheet-head"><div><p class="eyebrow">ADD PROOF</p><h2>\${esc(habit.emoji)} \${esc(habit.title)}</h2></div><button class="icon-btn" type="button" data-proof-source-close aria-label="Close">×</button></div><p class="proof-sheet-copy">Camera first, library if the receipt already exists.</p><button class="btn primary full" type="button" data-proof-camera>Take photo</button><button class="btn full" type="button" data-proof-gallery>Choose from library</button></section></div>\`;
}

function proofReviewSheet() {
  if (!proofReview) return '';
  const habit = getState()?.habits.find((item) => item.id === proofReview.habitId);
  if (!habit) return '';
  const uploading = proofReview.status === 'uploading';
  const submitLabel = uploading ? 'Uploading…' : proofReview.status === 'error' ? 'Retry proof' : 'Submit proof';
  return \`<div class="sheet-backdrop"><section class="sheet proof-review-sheet" role="dialog" aria-modal="true" aria-label="Review proof" data-sheet><div class="sheet-handle"></div><div class="sheet-head"><div><p class="eyebrow">REVIEW PROOF</p><h2>\${esc(habit.emoji)} \${esc(habit.title)}</h2></div><button class="icon-btn" type="button" data-proof-review-close aria-label="Cancel proof" \${uploading ? 'disabled' : ''}>×</button></div><div class="proof-preview-frame"><img src="\${esc(proofReview.previewUrl)}" alt="Selected proof for \${esc(habit.title)}"></div><div class="proof-file-meta"><strong>Looks usable?</strong><span>\${esc(formatProofFileSize(proofReview.file.size))} · max 4 MB</span></div>\${proofReview.error ? \`<div class="proof-error" role="alert"><strong>That didn’t upload.</strong><p>\${esc(proofReview.error)} Your photo is still here, so you can retry.</p></div>\` : ''}<div class="proof-review-actions"><button class="btn" type="button" data-proof-retake \${uploading ? 'disabled' : ''}>Retake</button><button class="btn" type="button" data-proof-choose \${uploading ? 'disabled' : ''}>Choose another</button></div><button class="btn primary full proof-submit-btn" type="button" data-proof-submit \${uploading ? 'disabled aria-busy="true"' : ''}>\${submitLabel}</button><button class="text-btn" type="button" data-proof-review-close \${uploading ? 'disabled' : ''}>Cancel</button></section></div>\`;
}

function proofViewerSheet() {
  if (!proofViewer) return '';
  const loading = proofViewer.status === 'loading';
  const actor = member(proofViewer.userId);
  const body = loading
    ? '<div class="proof-viewer-loading" role="status"><span></span><p>Loading proof…</p></div>'
    : proofViewer.status === 'error'
      ? \`<div class="proof-viewer-error" role="alert"><strong>Couldn’t load that proof.</strong><p>\${esc(proofViewer.error || 'The signed link may have expired.')}</p><button class="btn primary" type="button" data-proof-viewer-retry>Try again</button></div>\`
      : \`<div class="proof-viewer-image-wrap"><img data-proof-viewer-image src="\${esc(proofViewer.url)}" alt="Proof for \${esc(proofViewer.habitTitle)}"></div>\`;
  return \`<div class="sheet-backdrop"><section class="sheet proof-viewer-sheet" role="dialog" aria-modal="true" aria-label="View proof" data-sheet><div class="sheet-handle"></div><div class="sheet-head"><div><p class="eyebrow">PROOF</p><h2>\${esc(proofViewer.habitTitle)}</h2></div><button class="icon-btn" type="button" data-proof-viewer-close aria-label="Close proof">×</button></div><div class="proof-viewer-context"><strong>\${esc(actor?.name || 'Friend')}</strong><span>\${esc(proofViewer.whenLabel || '')}</span></div>\${body}</section></div>\`;
}

function clearProofReview() {
  if (proofReview?.previewUrl) URL.revokeObjectURL(proofReview.previewUrl);
  proofReview = null;
}

function dismissProofReview() {
  clearProofReview();
  proofHabit = null;
  render();
}

function chooseProofInput(input) {
  if (!proofHabit && proofReview?.habitId) proofHabit = proofReview.habitId;
  input?.click();
}

function replaceProofSelection(input) {
  if (!proofReview) return;
  proofHabit = proofReview.habitId;
  input?.click();
}

async function handleProofFileSelection(input) {
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  const habitId = proofHabit || proofReview?.habitId;
  if (!habitId) return;
  const validation = validateProofFile(file);
  if (!validation.valid) {
    notify(validation.error, 3400);
    return;
  }
  const previewUrl = URL.createObjectURL(file);
  if (proofReview?.previewUrl) URL.revokeObjectURL(proofReview.previewUrl);
  proofReview = createProofReviewState({ file, habitId, previewUrl });
  proofHabit = null;
  render();
}

async function handleProofSubmit() {
  const review = proofReview;
  if (!review || review.status === 'uploading' || busy) return;
  await refreshCoordinator?.waitForIdle();
  if (busy || proofReview !== review) return;
  const habit = getState().habits.find((item) => item.id === review.habitId);
  if (!habit) return;
  busy = true;
  proofReview = transitionProofReview(review, { type: 'uploading' });
  render();
  try {
    await repo.completeWithProof(review.habitId, today(), review.file);
    if (proofReview?.previewUrl === review.previewUrl) clearProofReview();
    proofHabit = null;
    notify(\`Proof saved · \${habit.title} 🧾\`);
  } catch (error) {
    if (proofReview?.previewUrl === review.previewUrl) {
      proofReview = transitionProofReview(proofReview, { type: 'failed', error: readableError(error) });
    }
  } finally {
    busy = false;
    render();
  }
}

async function loadProofViewerUrl() {
  const current = proofViewer;
  if (!current) return;
  proofViewer = { ...current, status: 'loading', url: null, error: null };
  render();
  try {
    const url = await repo.getProofUrl(current.path);
    if (!proofViewer || proofViewer.path !== current.path) return;
    proofViewer = { ...proofViewer, status: 'ready', url, error: null };
  } catch (error) {
    if (!proofViewer || proofViewer.path !== current.path) return;
    proofViewer = { ...proofViewer, status: 'error', url: null, error: readableError(error) };
  }
  render();
}

function bindProofActions() {
  app.querySelectorAll('[data-proof-camera]').forEach((element) => { element.onclick = () => chooseProofInput(proofInput); });
  app.querySelectorAll('[data-proof-gallery]').forEach((element) => { element.onclick = () => chooseProofInput(proofGalleryInput); });
  app.querySelectorAll('[data-proof-source-close]').forEach((element) => { element.onclick = () => { proofHabit = null; render(); }; });
  app.querySelectorAll('[data-proof-retake]').forEach((element) => { element.onclick = () => replaceProofSelection(proofInput); });
  app.querySelectorAll('[data-proof-choose]').forEach((element) => { element.onclick = () => replaceProofSelection(proofGalleryInput); });
  app.querySelectorAll('[data-proof-review-close]').forEach((element) => { element.onclick = dismissProofReview; });
  app.querySelectorAll('[data-proof-submit]').forEach((element) => { element.onclick = handleProofSubmit; });
  app.querySelectorAll('[data-proof-viewer-close]').forEach((element) => { element.onclick = () => { proofViewer = null; render(); }; });
  app.querySelectorAll('[data-proof-viewer-retry]').forEach((element) => { element.onclick = loadProofViewerUrl; });
  app.querySelector('[data-proof-viewer-image]')?.addEventListener('error', () => {
    if (!proofViewer) return;
    proofViewer = { ...proofViewer, status: 'error', url: null, error: 'That signed proof link expired. Tap try again.' };
    render();
  });
}

`;

replaceOnce('function render() {', `${proofSheets}function render() {`, 'proof sheets');

replaceOnce(
  '${habitSheet()}${settingsSheet()}${nudgeComposerSheet()}${nudgeInboxSheet()}${inviteSheet()}</div>`;',
  '${habitSheet()}${settingsSheet()}${nudgeComposerSheet()}${nudgeInboxSheet()}${inviteSheet()}${proofSourceSheet()}${proofReviewSheet()}${proofViewerSheet()}</div>`;',
  'sheet render list',
);

replaceOnce(
  "  bindInviteActions();\n  app.querySelector('[data-manual-refresh]')?.addEventListener('click', handleManualRefresh);",
  "  bindInviteActions();\n  bindProofActions();\n  app.querySelector('[data-manual-refresh]')?.addEventListener('click', handleManualRefresh);",
  'proof bindings',
);

replaceOnce(
  "  inviteSheetOpen = false;\n  if (window.location.search.includes('nudges=')) history.replaceState({}, '', window.location.pathname);",
  "  inviteSheetOpen = false;\n  proofHabit = null;\n  clearProofReview();\n  proofViewer = null;\n  if (window.location.search.includes('nudges=')) history.replaceState({}, '', window.location.pathname);",
  'sheet cleanup',
);

replaceOnce(
  "  if (habit.proofMode === 'photo') {\n    proofHabit = id;\n    proofInput.click();\n    return;\n  }",
  "  if (habit.proofMode === 'photo') {\n    proofHabit = id;\n    render();\n    return;\n  }",
  'habit proof source',
);

replaceOnce(
  "  proofHabit = checkIn.habitId;\n  proofInput.click();",
  "  proofHabit = checkIn.habitId;\n  render();",
  'redo proof source',
);

const viewPattern = /async function handleProofView\(path\) \{[\s\S]*?\n\}/;
if (!viewPattern.test(app)) throw new Error('proof viewer handler: source pattern not found');
app = app.replace(viewPattern, `async function handleProofView(path) {
  const activity = getState().friendActivities.find((item) => item.proofPath === path);
  if (!activity) {
    notify('Could not find that proof', 3000);
    return;
  }
  proofViewer = {
    path,
    status: 'loading',
    url: null,
    error: null,
    userId: activity.userId,
    habitTitle: activity.habitTitle,
    whenLabel: formatWhen(activity.when),
  };
  render();
  await loadProofViewerUrl();
}`);

replaceOnce(
  "async function handleSignOut() {\n  stopRefreshCoordinator();\n  await supabase.auth.signOut();\n}",
  "async function handleSignOut() {\n  stopRefreshCoordinator();\n  clearProofReview();\n  proofHabit = null;\n  proofViewer = null;\n  await supabase.auth.signOut();\n}",
  'signout proof cleanup',
);

const inputPattern = /proofInput\.addEventListener\('change', async \(\) => \{[\s\S]*?\n\}\);/;
if (!inputPattern.test(app)) throw new Error('proof input handler: source pattern not found');
app = app.replace(inputPattern, `proofInput.addEventListener('change', () => handleProofFileSelection(proofInput));
proofGalleryInput.addEventListener('change', () => handleProofFileSelection(proofGalleryInput));`);

replaceOnce(
  "async function boot(nextSession) {\n  stopRefreshCoordinator();",
  "async function boot(nextSession) {\n  stopRefreshCoordinator();\n  clearProofReview();\n  proofHabit = null;\n  proofViewer = null;",
  'boot proof cleanup',
);

if (!social.includes('.proof-review-sheet')) {
  social += `\n/* proof review + viewer */\n.proof-sheet-copy{margin:-.2rem 0 var(--space-4);color:var(--color-muted);font-size:var(--text-sm);line-height:1.45}.proof-source-sheet>.btn+.btn{margin-top:var(--space-2)}.proof-review-sheet,.proof-viewer-sheet{padding-bottom:calc(var(--space-5) + env(safe-area-inset-bottom))}.proof-preview-frame,.proof-viewer-image-wrap{display:grid;place-items:center;width:100%;overflow:hidden;border:var(--rule-hairline) solid var(--color-rule);border-radius:var(--radius-lg);background:var(--color-ink)}.proof-preview-frame{aspect-ratio:4/5;max-height:52dvh}.proof-preview-frame img,.proof-viewer-image-wrap img{display:block;width:100%;height:100%;max-width:100%;object-fit:contain}.proof-viewer-image-wrap{height:min(62dvh,34rem)}.proof-file-meta,.proof-viewer-context{display:flex;align-items:center;justify-content:space-between;gap:var(--space-3);margin-top:var(--space-3)}.proof-file-meta span,.proof-viewer-context span{color:var(--color-muted);font-size:var(--text-xs)}.proof-review-actions{display:grid;grid-template-columns:1fr 1fr;gap:var(--space-2);margin:var(--space-4) 0 var(--space-2)}.proof-submit-btn{margin-top:var(--space-2)}.proof-error,.proof-viewer-error{margin-top:var(--space-3);padding:var(--space-3);border:var(--rule-hairline) solid color-mix(in oklch,var(--color-coral) 42%,var(--color-rule));border-radius:var(--radius-md);background:var(--color-coral-soft);color:var(--color-coral-ink)}.proof-error p,.proof-viewer-error p{margin:.3rem 0 0;font-size:var(--text-xs);line-height:1.45}.proof-viewer-error .btn{margin-top:var(--space-3)}.proof-viewer-loading{display:grid;place-items:center;min-height:14rem;color:var(--color-muted)}.proof-viewer-loading span{width:2rem;height:2rem;border:.2rem solid var(--color-rule);border-top-color:var(--color-coral);border-radius:50%;animation:donezo-refresh-spin .8s linear infinite}.proof-viewer-loading p{margin:var(--space-3) 0 0;font-size:var(--text-sm)}@media(max-width:374px){.proof-review-actions{grid-template-columns:1fr}.proof-preview-frame{max-height:48dvh}.proof-viewer-image-wrap{height:56dvh}}\n`;
}

await writeFile(appPath, app);
await writeFile(socialPath, social);
