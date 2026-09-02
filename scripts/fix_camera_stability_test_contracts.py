from pathlib import Path

path = Path('test/dual-updates-polish.test.mjs')
text = path.read_text()
old = "  assert.match(card, /proof-card-header[^`]*\\$\\{rejectionControl\\}/s);"
new = "  assert.match(card, /proof-card-heading-copy[\\s\\S]*\\$\\{rejectionControl\\}<\\/div>\\$\\{proofPreview\\}/);"
if text.count(old) != 1:
    raise SystemExit(f'reject regression: expected 1 match, found {text.count(old)}')
path.write_text(text.replace(old, new, 1))
