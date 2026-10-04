// Sign in / sign up, and sign out. Owns the single Supabase client.
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from '../config.js';
import { buildAuthRedirectUrl } from '../invite.js';
import { clearStateCache } from '../state-cache.js';
import { optimisticPatches, ui } from './state.js';
import { esc, readableError } from './util.js';
import { render } from './render.js';
import { stopRefreshCoordinator } from './sync.js';
import { resetProofFlow } from './checkin.js';
import { clearPendingInvite } from './people.js';

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

export function authScreen() {
  const signingUp = ui.authMode === 'sign-up';
  const invite = ui.pendingInvite;
  const inviteContext = invite.present
    ? invite.valid
      ? `<div class="dz-card invite-context" role="status"><strong>Invite ready</strong><p>Sign in first. You’ll confirm the friend request next.</p><button class="dz-link" type="button" data-dismiss-invite>Not my invite</button></div>`
      : `<div class="dz-card invite-context error" role="alert"><strong>Invite link looks off</strong><p>${esc(ui.inviteMessage || 'Ask your friend for a fresh invite link.')}</p><button class="dz-link" type="button" data-dismiss-invite>Dismiss invite</button></div>`
    : '';
  const lead = invite.present ? 'Your invite stays with you while you sign in.' : signingUp ? 'Create an account, then add your friends.' : 'Your habits and your people are waiting.';
  return `<div class="dz-auth"><header class="dz-wordmark">donezo</header><section class="dz-auth-card"><h1>${signingUp ? 'Start showing up.' : 'Welcome back.'}</h1><p>${lead}</p>${inviteContext}${ui.authMessage ? `<div class="form-message">${esc(ui.authMessage)}</div>` : ''}<form id="auth-form" class="form auth-form">${signingUp ? '<label>Name<input name="name" autocomplete="name" maxlength="60" required placeholder="Your name"></label>' : ''}<label>Email<input name="email" type="email" autocomplete="email" required placeholder="you@example.com"></label><label>Password<input name="password" type="password" autocomplete="current-password" minlength="8" required placeholder="8+ characters"></label><button class="dz-btn primary full" ${ui.busy ? 'disabled' : ''}>${ui.busy ? 'Working…' : signingUp ? 'Create account' : 'Sign in'}</button></form><button class="dz-link" type="button" id="auth-mode">${signingUp ? 'Already have an account? Sign in' : 'New here? Create an account'}</button></section></div>`;
}

async function handleAuth(event) {
  event.preventDefault();
  if (ui.busy) return;
  ui.busy = true;
  ui.authMessage = '';
  render();
  const form = new FormData(event.currentTarget);
  const email = String(form.get('email')).trim();
  const password = String(form.get('password'));
  const invite = ui.pendingInvite;
  try {
    if (ui.authMode === 'sign-up') {
      const name = String(form.get('name')).trim();
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { display_name: name }, emailRedirectTo: invite.present ? (invite.valid ? buildAuthRedirectUrl(window.location.href, invite.code) : window.location.href) : window.location.origin },
      });
      if (error) throw error;
      if (!data.session) ui.authMessage = 'Check your email, confirm the account, then sign in.';
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
    }
  } catch (error) {
    ui.authMessage = readableError(error);
  } finally {
    ui.busy = false;
    render();
  }
}

export async function handleSignOut() {
  const userId = ui.session?.user?.id;
  ui.bootGeneration += 1;
  ui.authoritativeReady = false;
  ui.prefetchedFriendInvite = null;
  ui.friendInvitePromise = null;
  ui.friendInvitePreparing = false;
  stopRefreshCoordinator();
  resetProofFlow();
  optimisticPatches.clear();
  clearTimeout(ui.reconciliationTimer);
  if (userId) await clearStateCache(userId);
  await supabase.auth.signOut();
}

export function bindAuth(root) {
  root.querySelector('#auth-form')?.addEventListener('submit', handleAuth);
  root.querySelector('#auth-mode')?.addEventListener('click', () => {
    ui.authMode = ui.authMode === 'sign-in' ? 'sign-up' : 'sign-in';
    ui.authMessage = '';
    render();
  });
  root.querySelectorAll('[data-dismiss-invite]').forEach((element) => { element.onclick = () => { clearPendingInvite(); render(); }; });
}

export function bindSignOut(root) {
  root.querySelectorAll('#sign-out').forEach((element) => { element.onclick = handleSignOut; });
}
