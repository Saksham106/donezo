import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { uiSource } from './helpers/ui-source.mjs';

const app = uiSource;
const migrationUrl = new URL('../supabase/migrations/20260902_fix_selected_friend_proof_snapshot.sql', import.meta.url);
const migration = existsSync(migrationUrl) ? readFileSync(migrationUrl, 'utf8') : '';

function section(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0, `missing start: ${start}`);
  assert.ok(to > from, `missing end: ${end}`);
  return source.slice(from, to);
}

test('selected-friends proof snapshot avoids ambiguous viewer identifiers', () => {
  assert.match(migration, /create or replace function private\.snapshot_check_in_audience_members\(\)/i);
  assert.doesNotMatch(migration, /\bviewer\s+uuid\s*;/i);
  assert.doesNotMatch(migration, /selected\s*\(viewer\)/i);
  assert.match(migration, /selected_viewer_id/i);
  assert.match(migration, /private\.are_direct_friends\(habit\.owner_id,\s*selected_viewer_id\)/i);
});
