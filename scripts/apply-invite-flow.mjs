import { readFile, writeFile } from 'node:fs/promises';

const appPath = 'src/app.js';
const cssPath = 'social.css';
const packagePath = 'package.json';
let app = await readFile(appPath, 'utf8');
let css = await readFile(cssPath, 'utf8');

function replaceOnce(source, search, replacement, label) {
  const count = source.split(search).length - 1;
  if (count !== 1) throw new Error(`${label}: expected exactly one match, found ${count}`);
  return source.replace(search, replacement);
}

function replaceRegex(source, regex, replacement, label) {
  const match = source.match(regex);
  if (!match) throw new Error(`${label}: pattern not found`);
  return source.replace(regex, replacement);
}

app = replaceOnce(
  app,
  "import { createRefreshCoordinator } from './refresh.js';\n",
  "import { createRefreshCoordinator } from './refresh.js';\nimport { buildAuthRedirectUrl, buildInviteLink, clearInviteParam, parseInviteParam, validateInviteCode } from './invite.js';\n",
  'invite import',
);

app = replaceOnce(
  app,
  "let nudgeComposerUserId = null;\nlet refreshCoordinator = null;",
  "let nudgeComposerUserId = null;\nlet inviteSheetOpen = false;\nlet createdCircleInvite = null;\nlet pendingInvite = parseInviteParam(window.location.href);\nlet inviteMessage = pendingInvite.present && !pendingInvite.valid\n  ? 'That invite link looks busted. Paste a fresh 12-character code or dismiss it.'\n  : '';\nlet refreshCoordinator = null;",
  'invite state',
);

app = replaceOnce(
  app,
  "    bolt: '<path d=\"m13 2-8 11h6l-1 9 9-12h-6z\"/>',\n",
  "    bolt: '<path d=\"m13 2-8 11h6l-1 9 9-12h-6z\"/>',\n    share: '<path d=\"M12 16V3\"/><path d=\"m7 8 5-5 5 5\"/><path d=\"M5 13v7h14v-7\"/>',\n",
  'share icon',
);

const authAndOnboarding = `function authScreen() {
  const signingUp = authMode === 'sign-up';
  const inviteContext = pendingInvite.present
    ? pendingInvite.valid
      ? \`<div class="invite-context" role="status"><strong>Invite ready</strong><p>Sign in first. You’ll confirm joining your friend’s circle next.</p><button class="text-btn compact" type="button" data-dismiss-invite>Not my invite</button></div>\`
      : \`<div class="invite-context error" role="alert"><strong>Invite link looks off</strong><p>\${esc(inviteMessage || 'Ask your friend for a fresh invite link.')}</p><button class="text-btn compact" type="button" data-dismiss-invite>Dismiss invite</button></div>\`
    : '';
  return \`<div class="standalone-screen auth-shell"><header class="auth-brand"><span>ϟ</span><strong>Donezo</strong></header><section class="auth-card"><p class="eyebrow">ACCOUNTABILITY WITH FRIENDS</p><h1>\${signingUp ? 'Start showing up.' : 'Welcome back.'}</h1><p>\${pendingInvite.present ? 'Your invite stays with you while you sign in.' : signingUp ? 'Create an account, then make or join a circle.' : 'Your habits and your people are waiting.'}</p>\${inviteContext}\${authMessage ? \`<div class="form-message">\${esc(authMessage)}</div>\` : ''}<form id="auth-form" class="form auth-form">\${signingUp ? '<label>Name<input name="name" autocomplete="name" maxlength="60" required placeholder="Your name"></label>' : ''}<label>Email<input name="email" type="email" autocomplete="email" required placeholder="you@example.com"></label><label>Password<input name="password" type="password" autocomplete="current-password" minlength="8" required placeholder="8+ characters"></label><button class="btn primary full" \${busy ? 'disabled' : ''}>\${busy ? 'Working…' : signingUp ? 'Create account' : 'Sign in'}</button></form><button class="text-btn" id="auth-mode">\${signingUp ? 'Already have an account? Sign in' : 'New here? Create an account'}</button></section></div>\`;
}

function createCircleForm(primary = false) {
  return \`<form id="create-circle-form" class="form \${primary ? 'onboard-primary' : 'onboard-secondary'}"><h2>Create a circle</h2><p class="form-intro">Start a fresh group, then invite your people.</p><label>Circle name<input name="name" maxlength="60" required placeholder="Donezo Crew"></label><button class="btn \${primary ? 'primary ' : ''}full" \${busy ? 'disabled' : ''}>Create circle</button></form>\`;
}

function joinCircleForm(primary = false) {
  const value = pendingInvite.present ? (pendingInvite.valid ? pendingInvite.code : pendingInvite.raw || '') : '';
  return \`<form id="join-circle-form" class="form \${primary ? 'onboard-primary' : 'onboard-secondary'}"><h2>Join friends</h2><p class="form-intro">\${pendingInvite.present ? 'You came in through an invite. Confirm the code, then tap Join circle.' : 'Paste the 12-character code a friend sent you.'}</p>\${inviteMessage ? \`<div class="form-message">\${esc(inviteMessage)}</div>\` : ''}<label>Invite code<input name="code" minlength="12" maxlength="12" autocapitalize="none" required placeholder="a1b2c3d4e5f6" value="\${esc(value)}"></label><button class="btn \${primary ? 'primary ' : ''}full" \${busy ? 'disabled' : ''}>Join circle</button>\${pendingInvite.present ? '<button class="text-btn compact" type="button" data-dismiss-invite>Not this invite</button>' : ''}</form>\`;
}

function onboardingScreen() {
  const inviteFirst = pendingInvite.present;
  const detail = inviteFirst
    ? (pendingInvite.valid ? 'Your friend sent an invite. Confirm it below before anything happens.' : 'That invite needs attention. Paste a fresh code or dismiss it.')
    : 'Create a circle now, then invite your people.';
  return \`<div class="standalone-screen onboarding-screen"><header class="topbar standalone-topbar"><div class="brand"><span>ϟ</span><strong>Donezo</strong></div><button class="text-btn compact" id="sign-out">Sign out</button></header><main class="onboarding-content">\${pageHeading(inviteFirst ? 'Join your friends' : 'Set up your circle', inviteFirst ? 'INVITE FOUND' : 'ONE LAST STEP', detail)}<div class="onboard-grid \${inviteFirst ? 'invite-first' : ''}">\${inviteFirst ? \`\${joinCircleForm(true)}<div class="or"><span>OR</span></div>\${createCircleForm(false)}\` : \`\${createCircleForm(true)}<div class="or"><span>OR</span></div>\${joinCircleForm(false)}\`}</div></main></div>\`;
}

function creatorInviteScreen() {
  const code = createdCircleInvite || getState()?.circleInviteCode || '';
  return \`<div class="standalone-screen creator-success"><header class="topbar standalone-topbar"><div class="brand"><span>ϟ</span><strong>Donezo</strong></div></header><main class="creator-success-body"><p class="eyebrow">CIRCLE CREATED</p><h1>You’re in. Bring the group.</h1><p>Share the invite now, or jump into the app and do it later from Squad.</p><button class="btn primary full" type="button" data-share-invite>Share invite</button><button class="btn full" type="button" data-continue-app>Continue to app</button><button class="text-btn" type="button" data-copy-code>Copy raw code · \${esc(code)}</button></main></div>\`;
}

function myHabits`;

app = replaceRegex(
  app,
  /function authScreen\(\) \{[\s\S]*?\n\}\n\nfunction onboardingScreen\(\) \{[\s\S]*?\n\}\n\nfunction myHabits/,
  authAndOnboarding,
  'auth/onboarding block',
);

const squadBlock = `function squadScreen() {
  const state = getState();
  const people = state.members;
  const peopleRows = people.map((person) => {
    const progress = progressFor(person.id);
    const isMe = person.id === state.currentUserId;
    return \`<div class="friend-row"><div class="avatar">\${esc(person.avatar)}</div><span><strong>\${isMe ? \`\${esc(person.name)} · You\` : esc(person.name)}</strong><small>\${progress.completed}/\${progress.total} today · 🔥 \${person.currentStreak}</small></span>\${isMe ? '<span class="you-pill">you</span>' : \`<button class="btn small-btn" data-nudge="\${person.id}" \${busy ? 'disabled' : ''}>Nudge</button>\`}</div>\`;
  }).join('');
  const activities = state.friendActivities.map(activityCard).join('');
  const syncText = lastRefreshAt ? \`Synced \${formatWhen(lastRefreshAt)}\` : 'Ready to sync';
  const refreshButton = \`<button class="btn small-btn refresh-btn \${manualRefreshLoading ? 'loading' : ''}" data-manual-refresh \${manualRefreshLoading ? 'disabled' : ''}><span aria-hidden="true">↻</span>\${manualRefreshLoading ? 'Refreshing…' : 'Refresh'}</button>\`;
  const inviteButton = \`<button class="invite-icon-btn" type="button" data-invite-open aria-label="Invite friends" title="Invite friends">\${icon('share')}</button>\`;
  return \`\${pageHeading('Squad', \`\${state.members.length} PEOPLE · \${state.circleName || 'YOUR CIRCLE'}\`, 'Receipts, pressure, and a little public shame.')}<div class="squad-refresh-row"><small>\${esc(syncText)}</small><div class="squad-actions">\${refreshButton}\${inviteButton}</div></div><div class="section-head first"><h2>People</h2><span>\${people.length}</span></div><div class="friends-list">\${peopleRows}</div><div class="section-head"><h2>Recent activity</h2><span>\${state.friendActivities.length}</span></div><div class="activity-list">\${activities || '<div class="empty compact-empty"><b>No receipts yet.</b><p>Somebody has to go first.</p></div>'}</div>\`;
}

function leagueScreen`;

app = replaceRegex(app, /function squadScreen\(\) \{[\s\S]*?\n\}\n\nfunction leagueScreen/, squadBlock, 'squad block');

const inviteSheet = `function inviteSheet() {
  if (!inviteSheetOpen) return '';
  const code = getState()?.circleInviteCode || '';
  return \`<div class="sheet-backdrop" data-close-sheet><section class="sheet compact-sheet invite-sheet" role="dialog" aria-modal="true" aria-label="Invite friends" data-sheet><div class="sheet-handle"></div><div class="sheet-head"><div><p class="eyebrow">INVITE FRIENDS</p><h2>Bring in the squad</h2></div><button class="icon-btn" type="button" data-close-invite aria-label="Close">×</button></div><p class="invite-sheet-copy">Share the link. They’ll still have to confirm before joining.</p><button class="btn primary full" type="button" data-share-invite>Share invite</button><div class="raw-code-row"><div><small>Raw code</small><code>\${esc(code)}</code></div><button class="btn small-btn" type="button" data-copy-code>Copy code</button></div></section></div>\`;
}

function render()`;
app = replaceOnce(app, 'function render() {', inviteSheet, 'invite sheet insertion');

app = replaceOnce(
  app,
  "    app.querySelector('#auth-mode')?.addEventListener('click', () => {\n      authMode = authMode === 'sign-in' ? 'sign-up' : 'sign-in';\n      authMessage = '';\n      render();\n    });\n    return;",
  "    app.querySelector('#auth-mode')?.addEventListener('click', () => {\n      authMode = authMode === 'sign-in' ? 'sign-up' : 'sign-in';\n      authMessage = '';\n      render();\n    });\n    bindInviteActions();\n    return;",
  'auth invite bindings',
);

app = replaceOnce(
  app,
  "  const state = getState();\n  if (!state?.circleId) {",
  "  const state = getState();\n  if (createdCircleInvite && state?.circleId) {\n    app.innerHTML = creatorInviteScreen();\n    bindInviteActions();\n    return;\n  }\n  if (!state?.circleId) {",
  'creator success render',
);

app = replaceOnce(
  app,
  "    app.querySelector('#join-circle-form')?.addEventListener('submit', handleJoinCircle);\n    app.querySelector('#sign-out')?.addEventListener('click', handleSignOut);\n    return;",
  "    app.querySelector('#join-circle-form')?.addEventListener('submit', handleJoinCircle);\n    app.querySelector('#sign-out')?.addEventListener('click', handleSignOut);\n    bindInviteActions();\n    return;",
  'onboarding invite bindings',
);

app = replaceOnce(
  app,
  "${nudgeInboxSheet()}</div>`;",
  "${nudgeInboxSheet()}${inviteSheet()}</div>`;",
  'invite sheet render',
);

app = replaceOnce(
  app,
  "  app.querySelector('#copy-invite')?.addEventListener('click', handleCopyInvite);\n  app.querySelector('[data-manual-refresh]')?.addEventListener('click', handleManualRefresh);",
  "  bindInviteActions();\n  app.querySelector('[data-manual-refresh]')?.addEventListener('click', handleManualRefresh);",
  'app invite bindings',
);

app = replaceOnce(
  app,
  "  nudgeComposerUserId = null;\n  nudgeInboxOpen = false;",
  "  nudgeComposerUserId = null;\n  nudgeInboxOpen = false;\n  inviteSheetOpen = false;",
  'close invite sheet',
);

app = replaceOnce(
  app,
  "emailRedirectTo: window.location.origin",
  "emailRedirectTo: pendingInvite.present ? (pendingInvite.valid ? buildAuthRedirectUrl(window.location.href, pendingInvite.code) : window.location.href) : window.location.origin",
  'auth redirect',
);

app = replaceRegex(
  app,
  /async function handleCreateCircle\(event\) \{[\s\S]*?\n\}/,
  `async function handleCreateCircle(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  await runMutation(async () => {
    await repo.createCircle(String(form.get('name')));
    createdCircleInvite = getState().circleInviteCode;
    return true;
  }, 'Circle created');
}`,
  'create circle handler',
);

app = replaceRegex(
  app,
  /async function handleJoinCircle\(event\) \{[\s\S]*?\n\}/,
  `async function handleJoinCircle(event) {
  event.preventDefault();
  if (busy) return;
  const form = new FormData(event.currentTarget);
  const validation = validateInviteCode(String(form.get('code')));
  if (!validation.valid) {
    inviteMessage = 'Invite codes are 12 letters/numbers. Paste a fresh one or dismiss this invite.';
    render();
    return;
  }
  busy = true;
  inviteMessage = '';
  const submit = event.currentTarget.querySelector('button[type="submit"]') || event.currentTarget.querySelector('button');
  if (submit) { submit.disabled = true; submit.textContent = 'Joining…'; }
  try {
    await repo.joinCircle(validation.code);
    pendingInvite = { present: false, valid: false, code: null, raw: null };
    history.replaceState({}, '', clearInviteParam(window.location.href));
    notify('You’re in. Time to lock in.');
  } catch (error) {
    const message = readableError(error);
    inviteMessage = /invalid|expired/i.test(message)
      ? 'That invite is invalid or expired. Ask your friend for a fresh link, or enter a different code.'
      : \`Couldn’t join that circle. \${message}\`;
    notify(inviteMessage, 3600);
  } finally {
    busy = false;
    render();
  }
}`,
  'join circle handler',
);

app = replaceRegex(
  app,
  /async function handleCopyInvite\(\) \{[\s\S]*?\n\}/,
  `function activeInviteCode() {
  return createdCircleInvite || getState()?.circleInviteCode || '';
}

async function handleShareInvite() {
  const code = activeInviteCode();
  if (!validateInviteCode(code).valid) {
    notify('Invite code is not ready yet. Try again in a sec.', 3200);
    return;
  }
  const url = buildInviteLink(window.location.href, code);
  const payload = {
    title: 'Join my Donezo circle',
    text: 'Join my Donezo circle — we’re trying to actually lock in.',
    url,
  };
  if (typeof navigator.share === 'function') {
    try {
      await navigator.share(payload);
      return;
    } catch (error) {
      if (error?.name === 'AbortError') return;
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    notify('Invite link copied');
  } catch {
    notify(url, 6000);
  }
}

async function handleCopyRawInvite() {
  const code = activeInviteCode();
  try {
    await navigator.clipboard.writeText(code);
    notify('Raw invite code copied');
  } catch {
    notify(\`Invite code: \${code}\`, 5000);
  }
}

function dismissPendingInvite() {
  pendingInvite = { present: false, valid: false, code: null, raw: null };
  inviteMessage = '';
  history.replaceState({}, '', clearInviteParam(window.location.href));
  render();
}

function bindInviteActions() {
  app.querySelectorAll('[data-dismiss-invite]').forEach((element) => { element.onclick = dismissPendingInvite; });
  app.querySelectorAll('[data-invite-open]').forEach((element) => { element.onclick = () => { inviteSheetOpen = true; render(); }; });
  app.querySelectorAll('[data-close-invite]').forEach((element) => { element.onclick = () => { inviteSheetOpen = false; render(); }; });
  app.querySelectorAll('[data-share-invite]').forEach((element) => { element.onclick = handleShareInvite; });
  app.querySelectorAll('[data-copy-code]').forEach((element) => { element.onclick = handleCopyRawInvite; });
  app.querySelectorAll('[data-continue-app]').forEach((element) => { element.onclick = () => { createdCircleInvite = null; tab = 'today'; render(); }; });
}`,
  'invite handlers',
);

await writeFile(appPath, app);

if (!css.includes('/* compact invite flow */')) {
  css += `\n/* compact invite flow */\n.squad-actions{display:flex;align-items:center;gap:var(--space-2)}.invite-icon-btn{display:grid;place-items:center;width:2.25rem;height:2.25rem;flex:0 0 auto;border:var(--rule-hairline) solid var(--color-rule-strong);border-radius:var(--radius-round);background:var(--color-surface);color:var(--color-ink)}.invite-icon-btn svg{width:1.05rem;height:1.05rem}.invite-icon-btn:hover{background:var(--color-coral-soft);border-color:var(--color-coral)}.invite-context{margin:var(--space-4) 0;padding:var(--space-3) var(--space-4);border:var(--rule-hairline) solid var(--color-rule);border-radius:var(--radius-md);background:var(--color-coral-soft)}.invite-context.error{background:var(--color-warning-soft)}.invite-context strong{display:block}.invite-context p{margin:.3rem 0 var(--space-2);color:var(--color-muted);font-size:var(--text-xs);line-height:1.45}.invite-context code{font-family:var(--font-mono)}.form-intro{margin:-.35rem 0 var(--space-4);color:var(--color-muted);font-size:var(--text-xs);line-height:1.45}.onboard-secondary{background:transparent}.invite-sheet-copy{margin:-.25rem 0 var(--space-4);color:var(--color-muted);font-size:var(--text-sm);line-height:1.45}.raw-code-row{display:flex;align-items:center;justify-content:space-between;gap:var(--space-3);margin-top:var(--space-3);padding:var(--space-3);border:var(--rule-hairline) solid var(--color-rule);border-radius:var(--radius-md);background:var(--color-surface)}.raw-code-row>div{min-width:0}.raw-code-row small{display:block;color:var(--color-muted);font-size:var(--text-2xs)}.raw-code-row code{display:block;margin-top:.15rem;overflow-wrap:anywhere;font-family:var(--font-mono);font-size:var(--text-sm)}.creator-success{display:grid;align-content:center}.creator-success-body{width:100%;max-width:30rem;margin:auto}.creator-success-body h1{margin:0;font-family:var(--font-display);font-size:clamp(2rem,9vw,3rem);letter-spacing:-.05em;line-height:1}.creator-success-body>p:not(.eyebrow){margin:var(--space-3) 0 var(--space-6);color:var(--color-muted);line-height:1.5}.creator-success-body>.btn+.btn{margin-top:var(--space-3)}@media(max-width:374px){.squad-actions{gap:.3rem}.invite-icon-btn{width:2.1rem;height:2.1rem}}\n`;
  await writeFile(cssPath, css);
}

const pkg = JSON.parse(await readFile(packagePath, 'utf8'));
if (!pkg.scripts.check.includes('src/invite.js')) {
  pkg.scripts.check = pkg.scripts.check.replace('node --check src/refresh.js', 'node --check src/refresh.js && node --check src/invite.js');
  await writeFile(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);
}
