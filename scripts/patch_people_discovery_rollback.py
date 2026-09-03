from pathlib import Path

path = Path('src/app.js')
app = path.read_text()

handlers = [
    ('handlePeopleAdd', 'async function handlePeopleCancel('),
    ('handlePeopleCancel', 'async function handlePeopleAccept('),
    ('handlePeopleAccept', 'function queuePeopleSearch('),
]

for name, end_marker in handlers:
    start_marker = f'async function {name}('
    start = app.index(start_marker)
    end = app.index(end_marker, start)
    block = app[start:end]
    assert 'const previousSuggestions = peopleSuggestions;' in block
    assert 'const previousDiscovery = discoveryProfilePerson;' not in block
    block = block.replace(
        '  const previousSuggestions = peopleSuggestions;\n',
        '  const previousSuggestions = peopleSuggestions;\n  const previousDiscovery = discoveryProfilePerson;\n',
        1,
    )
    catch_anchor = '    peopleSuggestions = previousSuggestions;\n'
    assert catch_anchor in block
    block = block.replace(
        catch_anchor,
        catch_anchor + '    discoveryProfilePerson = previousDiscovery;\n',
        1,
    )
    app = app[:start] + block + app[end:]

path.write_text(app)
