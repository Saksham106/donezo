import test from 'node:test';
import assert from 'node:assert/strict';
import { safeStaticPath } from '../src/server-path.js';

test('safeStaticPath resolves normal assets inside the static root', () => {
  assert.equal(safeStaticPath('/app/dist', '/app.js'), '/app/dist/app.js');
});

test('safeStaticPath rejects traversal outside the static root', () => {
  assert.throws(() => safeStaticPath('/app/dist', '/../../etc/passwd'), /Invalid path/);
  assert.throws(() => safeStaticPath('/app/dist', '/%2e%2e/%2e%2e/etc/passwd'), /Invalid path/);
});
