from pathlib import Path
import subprocess

path = Path('test/fluid-performance.test.mjs')
text = subprocess.check_output(
    ['git', 'show', 'origin/main:test/fluid-performance.test.mjs'],
    text=True,
)
old = """test('optimistic reply success refreshes server ids and undo contains no dead event scaffolding', () => {
  const submit = section(app, 'async function handleCommentSubmit(', 'async function handleUndoCommentDelete(');
  const replace = submit.indexOf('repo.replaceOptimisticComment(temp.id, saved)');
  const rerender = submit.indexOf('renderPreservingScroll()', replace);
  assert.ok(replace >= 0 && rerender > replace);
  const undo = section(app, 'async function handleUndoCommentDelete(', 'async function handleDeleteComment(');
  assert.doesNotMatch(undo, /fakeEvent/);
});
"""
new = """test('optimistic reply success refreshes server ids without rebuilding the proof feed', () => {
  const submit = section(app, 'async function handleCommentSubmit(', 'async function handleUndoCommentDelete(');
  const replace = submit.indexOf('repo.replaceOptimisticComment(temp.id, saved)');
  const overlayRefresh = submit.indexOf('refreshCommentSheet()', replace);
  assert.ok(replace >= 0 && overlayRefresh > replace);
  assert.doesNotMatch(submit, /renderPreservingScroll\\(\\)/);
  const undo = section(app, 'async function handleUndoCommentDelete(', 'async function handleDeleteComment(');
  assert.doesNotMatch(undo, /fakeEvent/);
});
"""
if text.count(old) != 1:
    raise SystemExit(f'performance reply contract: expected 1 match, found {text.count(old)}')
path.write_text(text.replace(old, new, 1))
