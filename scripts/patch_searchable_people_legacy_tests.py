from pathlib import Path

friends_path = Path('test/friends-ui.test.mjs')
friends = friends_path.read_text()

old = """  assert.match(people, /Friend requests/);
  assert.match(people, /data-accept-friend/);
"""
new = """  assert.match(people, /Requests/);
  assert.match(people, /data-people-accept/);
"""
if friends.count(old) != 1:
    raise SystemExit(f'friend request copy contract: expected 1 match, found {friends.count(old)}')
friends = friends.replace(old, new, 1)

old = """  assert.match(app, /people\\.length === 1 \\? 'friend' : 'friends'/);
"""
new = """  const people = slice('peopleSheet', 'proofRejectSheet');
  assert.match(people, /Suggested for you/);
  assert.match(people, /<h3>Friends<\\/h3>/);
"""
if friends.count(old) != 1:
    raise SystemExit(f'old People count copy contract: expected 1 match, found {friends.count(old)}')
friends_path.write_text(friends.replace(old, new, 1))

mobile_path = Path('test/mobile-social-v2.test.mjs')
mobile = mobile_path.read_text()
old = """  assert.match(app, /No habits today/);
"""
new = """  const people = app.slice(app.indexOf('function peopleSheet()'), app.indexOf('function proofRejectSheet'));
  assert.match(people, /Search people/);
  assert.doesNotMatch(people, /progressFor\\(/);
"""
if mobile.count(old) != 1:
    raise SystemExit(f'old People habit progress contract: expected 1 match, found {mobile.count(old)}')
mobile_path.write_text(mobile.replace(old, new, 1))
