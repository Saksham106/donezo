const INVITE_PATTERN = /^[a-z0-9]{12}$/;

export function validateInviteCode(value) {
  const code = String(value || '').trim().toLowerCase();
  return INVITE_PATTERN.test(code)
    ? { valid: true, code }
    : { valid: false, code: null };
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