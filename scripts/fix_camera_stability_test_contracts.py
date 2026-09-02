from pathlib import Path

path = Path('test/dual-updates-polish.test.mjs')
text = path.read_text()
old = "  assert.match(card, /proof-card-header[^`]*\\$\\{rejectionControl\\}/s);"
new = "  assert.match(card, /proof-card-heading-copy[\\s\\S]*\\$\\{rejectionControl\\}<\\/div>\\$\\{proofPreview\\}/);"
if text.count(old) != 1:
    raise SystemExit(f'reject regression: expected 1 match, found {text.count(old)}')
path.write_text(text.replace(old, new, 1))

path = Path('test/habit-ui.test.mjs')
text = path.read_text()
old = """test('background refresh keeps unsaved form drafts mounted', () => {
  assert.match(app, /function hasUnsavedDraft\\(\\)/);
  assert.match(app, /lastRefreshAt = new Date\\(\\)\\.toISOString\\(\\);\\s*if \\(!hasUnsavedDraft\\(\\)\\) renderPreservingScroll\\(\\);/);
  assert.match(app, /onNetworkChange:\\s*\\(value\\) => \\{[\\s\\S]{0,180}if \\(!hasUnsavedDraft\\(\\)\\) renderPreservingScroll\\(\\);/);
});"""
new = """test('background refresh keeps unsaved drafts and a scrolled Friends feed mounted', () => {
  assert.match(app, /function hasUnsavedDraft\\(\\)/);
  assert.match(app, /Boolean\\(dualProof\\)/);
  assert.match(app, /function shouldDeferFriendsRefreshRender\\(\\)/);
  assert.match(app, /lastRefreshAt = new Date\\(\\)\\.toISOString\\(\\);\\s*if \\(!hasUnsavedDraft\\(\\) && !shouldDeferFriendsRefreshRender\\(\\)\\) renderPreservingScroll\\(\\);/);
  assert.match(app, /onNetworkChange:\\s*\\(value\\) => \\{[\\s\\S]{0,240}if \\(!hasUnsavedDraft\\(\\) && !shouldDeferFriendsRefreshRender\\(\\)\\) renderPreservingScroll\\(\\);/);
});"""
if text.count(old) != 1:
    raise SystemExit(f'background refresh regression: expected 1 match, found {text.count(old)}')
path.write_text(text.replace(old, new, 1))
