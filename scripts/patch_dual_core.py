from pathlib import Path

p = Path('src/store.js')
text = p.read_text()


def rep(old, new, expected=1):
    global text
    count = text.count(old)
    if count != expected:
        raise SystemExit(f'expected {expected}, found {count}: {old[:120]!r}')
    text = text.replace(old, new, expected)


rep("import { proofMimeType } from './proof.js';", "import { proofMimeType, requiresPhotoProof } from './proof.js';")
rep("if (!['photo', 'none'].includes(proofMode)) throw new Error('Choose a valid proof mode');", "if (!['photo', 'dual_photo', 'none'].includes(proofMode)) throw new Error('Choose a valid proof mode');")
rep("if (habit.proofMode === 'photo') throw new Error('Photo habits use the proof flow');", "if (requiresPhotoProof(habit.proofMode)) throw new Error('Photo habits use the proof flow');", 2)
rep(
    "const [notificationPreferencesResult, membershipsResult, friendshipsResult, requestsResult] = await Promise.all([",
    "const [notificationPreferencesResult, membershipsResult, friendshipsResult, requestsResult, userUpdateStateResult] = await Promise.all([",
)
rep(
    "      client.from('friend_requests').select('*').order('created_at', { ascending: false }),\n    ]);",
    "      client.from('friend_requests').select('*').order('created_at', { ascending: false }),\n      client.from('user_update_state').select('last_seen_at').eq('user_id', user.id).maybeSingle(),\n    ]);",
)
rep(
    "const firstError = [notificationPreferencesResult, membershipsResult, friendshipsResult, requestsResult].find((result) => result.error);",
    "const firstError = [notificationPreferencesResult, membershipsResult, friendshipsResult, requestsResult, userUpdateStateResult].find((result) => result.error);",
)
rep(
    "      batonPreference: batonPreferenceResult.data,\n      notificationPreferences,\n    });",
    "      batonPreference: batonPreferenceResult.data,\n      notificationPreferences,\n      userUpdateState: userUpdateStateResult.data,\n    });",
)
rep(
    "    notificationPreferences,\n  };",
    "    notificationPreferences,\n    updatesLastSeenAt: rows.userUpdateState?.last_seen_at || null,\n  };",
)

old = """  function applyNudgeRead(nudgeId, readAt = new Date().toISOString()) {
    const nudge = (state.nudges || []).find((item) => item.id === nudgeId && item.toUserId === user.id);
    if (!nudge) return null;
    const previous = nudge.readAt || null;
    nudge.readAt = readAt;
    return previous;
  }
"""
new = old + """
  function applyUpdatesSeen(markedAt = new Date().toISOString()) {
    const value = String(markedAt || new Date().toISOString());
    state.updatesLastSeenAt = value;
    state.nudges = (state.nudges || []).map((nudge) => (
      nudge.toUserId === user.id && !nudge.readAt ? { ...nudge, readAt: value } : nudge
    ));
    return value;
  }
"""
rep(old, new)

old = """  async function markNudgeRead(nudgeId) {
    const readAt = new Date().toISOString();
    const { error } = await client.from('nudges').update({ read_at: readAt }).eq('id', nudgeId).eq('to_user_id', user.id);
    if (error) throw appError(error, 'Could not mark nudge read');
    return { id: nudgeId, readAt };
  }
"""
new = old + """
  async function markUpdatesSeen() {
    const { data, error } = await client.rpc('mark_updates_seen');
    if (error) throw appError(error, 'Could not mark Updates seen');
    return applyUpdatesSeen(data || new Date().toISOString());
  }
"""
rep(old, new)
rep("    applyNudgeRead,\n", "    applyNudgeRead,\n    applyUpdatesSeen,\n")
rep("    markNudgeRead,\n", "    markNudgeRead,\n    markUpdatesSeen,\n")
p.write_text(text)
