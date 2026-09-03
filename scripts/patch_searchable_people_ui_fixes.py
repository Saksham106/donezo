from pathlib import Path

app_path = Path('src/app.js')
app = app_path.read_text()
old = "  peopleSearchRequestId += 1;\n  const requestId = peopleSearchRequestId;"
new = "  const requestId = ++peopleSearchRequestId;"
if app.count(old) != 1:
    raise SystemExit(f'people search request increment: expected 1 match, found {app.count(old)}')
app_path.write_text(app.replace(old, new, 1))

test_path = Path('test/fluid-performance.test.mjs')
test = test_path.read_text()
old = """  const peopleOpen = section(app, \"app.querySelectorAll('[data-people-open]')\", \"app.querySelectorAll('[data-invite-from-people]')\");
  assert.match(peopleOpen, /primeFriendInvite\\(\\)/);
"""
new = """  const peopleOpen = section(app, \"app.querySelectorAll('[data-people-open]')\", \"app.querySelectorAll('[data-invite-from-people]')\");
  assert.match(peopleOpen, /openPeopleSheet/);
  const peopleOpenHelper = section(app, 'function openPeopleSheet()', 'function checkInUndoSheet()');
  assert.match(peopleOpenHelper, /primeFriendInvite\\(\\)/);
"""
if test.count(old) != 1:
    raise SystemExit(f'people invite priming assertion: expected 1 match, found {test.count(old)}')
test_path.write_text(test.replace(old, new, 1))
