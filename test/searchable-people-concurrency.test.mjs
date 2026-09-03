import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const migrationUrl = new URL('../supabase/migrations/20260903003000_harden_searchable_people_username_generation.sql', import.meta.url);
const migration = existsSync(migrationUrl) ? readFileSync(migrationUrl, 'utf8') : '';

test('automatic username generation serializes same-base concurrent signups', () => {
  assert.match(migration, /create or replace function private\.generated_donezo_username/i);
  assert.match(migration, /pg_advisory_xact_lock/i);
  assert.match(migration, /hashtextextended|hashtext/i);
  assert.match(migration, /public\.profiles[\s\S]*username\s*=\s*candidate/i);
});
