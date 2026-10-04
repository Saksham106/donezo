import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { uiSource } from './helpers/ui-source.mjs';

const app = uiSource;
const social = readFileSync(new URL('../social.css', import.meta.url), 'utf8');

test('standalone proof viewer is removed while signed proof urls stay lazy-loaded inline', () => {
  assert.doesNotMatch(app, /function proofViewerSheet/);
  assert.doesNotMatch(app, /proofViewerRequestId/);
  assert.doesNotMatch(app, /let proofViewer\s*=/);
  assert.match(app, /IntersectionObserver/);
  assert.match(app, /getProofUrl/);
  assert.match(app, /data-proof-image/);
});
