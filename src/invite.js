// Circle invites are legacy 12-character codes. New direct-friend invites use
// 24 hexadecimal characters (96 random bits). Accept both during migration.
const INVITE_PATTERN = /^(?:[a-z0-9]{12}|[a-f0-9]{24})$/;

export function normalizeInviteInput(value) {
  let raw = String(value || '').trim();
  try {
    const url = new URL(raw);
    if (url.searchParams.has('invite')) raw = url.searchParams.get('invite') || '';
  } catch {
    // A raw code is expected most of the time.
  }
  return raw.replace(/\s+/g, '').toLowerCase();
}

export function validateInviteCode(value) {
  const code = normalizeInviteInput(value);
  return INVITE_PATTERN.test(code)
    ? { valid: true, code }
    : { valid: false, code: null };
}

export async function redeemInvite(repository, value) {
  const validated = validateInviteCode(value);
  if (!validated.valid) throw new Error('Invalid invite code');
  const { code } = validated;

  if (code.length === 24) {
    if (typeof repository?.acceptFriendInvite !== 'function') throw new Error('Friend invites are not supported');
    return repository.acceptFriendInvite(code);
  }

  if (typeof repository?.acceptFriendInvite === 'function') {
    try {
      return await repository.acceptFriendInvite(code);
    } catch (error) {
      if (typeof repository?.joinCircle !== 'function' || !/invalid|expired|not found/i.test(error?.message || '')) throw error;
    }
  }

  if (typeof repository?.joinCircle === 'function') return repository.joinCircle(code);
  throw new Error('Invite redemption is not supported');
}

export function parseInviteParam(input) {
  const url = new URL(input);
  if (!url.searchParams.has('invite')) {
    return { present: false, valid: false, code: null, raw: null };
  }
  const raw = url.searchParams.get('invite') || '';
  const result = validateInviteCode(raw);
  return { present: true, valid: result.valid, code: result.code, raw };
}

export function buildInviteLink(input, code) {
  const validated = validateInviteCode(code);
  if (!validated.valid) throw new Error('Invalid invite code');
  const url = new URL(input);
  url.search = '';
  url.hash = '';
  url.searchParams.set('invite', validated.code);
  return url.toString();
}

export function buildAuthRedirectUrl(input, code) {
  return buildInviteLink(input, code);
}

export function clearInviteParam(input) {
  const url = new URL(input);
  url.searchParams.delete('invite');
  return url.toString();
}