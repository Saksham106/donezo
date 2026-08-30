import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile(new URL('../supabase/migrations/0020_baton_comments_badges_wrapped.sql', import.meta.url), 'utf8');

test('0020 creates exact-circle baton, immutable handoff, comment, and preference data', () => {
  assert.match(migration, /create table if not exists public\.batons/i);
  assert.match(migration, /create table if not exists public\.baton_handoffs/i);
  assert.match(migration, /unique index.*batons_one_active_per_circle/i);
  assert.match(migration, /create table if not exists public\.check_in_comments/i);
  assert.match(migration, /char_length\(body\) between 1 and 180/i);
  assert.match(migration, /create table if not exists public\.baton_preferences/i);
  assert.match(migration, /alter table public\.baton_handoffs enable row level security/i);
});

test('0020 uses server-authoritative RPCs and prevents cross-circle or forged authors', () => {
  assert.match(migration, /create or replace function public\.pass_baton/i);
  assert.match(migration, /auth\.uid\(\)/i);
  assert.match(migration, /source_check_in_id/i);
  assert.match(migration, /expires_at > now\(\)/i);
  assert.match(migration, /recipient.*active member|active.*recipient/i);
  const passBaton = migration.match(/create or replace function public\.pass_baton[\s\S]*?create or replace function public\.set_baton_opt_out/i)?.[0] || '';
  assert.match(passBaton, /cm\.circle_id = baton\.circle_id and cm\.user_id = caller/i);
  assert.match(migration, /create or replace function public\.add_check_in_comment/i);
  assert.match(migration, /insert into public\.check_in_comments[\s\S]*auth\.uid\(\)/i);
  assert.match(migration, /comment.*same.*circle|same.*circle.*comment/i);
  assert.match(migration, /create or replace function public\.delete_check_in_comment/i);
  assert.match(migration, /author_id = auth\.uid\(\)/i);
  assert.match(migration, /revoke insert.*check_in_comments.*authenticated/i);
  assert.match(migration, /revoke update, delete on table public\.baton_handoffs/i);
});

test('0020 fails closed with RLS and trigger guards rather than client-provided authority', () => {
  assert.match(migration, /security definer/i);
  assert.match(migration, /set search_path = ''/i);
  assert.match(migration, /immutable|raise exception.*immutable/i);
  assert.match(migration, /check_in_comments_select_circle_members/i);
  assert.match(migration, /batons_select_circle_members/i);
  assert.doesNotMatch(migration, /grant all on table public\.(batons|check_in_comments)/i);
});
