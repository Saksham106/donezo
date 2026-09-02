from pathlib import Path

path = Path('src/app.js')
text = path.read_text()
old = "  const cameraSession = dualProof?.habitId === habit.id;\n  const dual = cameraSession && dualProof?.mode === 'dual';"
new = "  const cameraSession = dualProof?.habitId === habit.id && (dualProof?.mode === 'single' || Boolean(dualProof?.selfieFile));\n  const dual = cameraSession && dualProof?.mode === 'dual';"
if text.count(old) != 1:
    raise SystemExit(f'native dual cancel guard: expected 1 match, found {text.count(old)}')
path.write_text(text.replace(old, new, 1))
