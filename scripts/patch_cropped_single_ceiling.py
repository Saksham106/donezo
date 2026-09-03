from pathlib import Path

APP = Path('src/app.js')
app = APP.read_text()

old = '''    const cropped = await cropProofFile(crop.sourceFile, crop.position);
    const artifact = crop.dual
      ? await composeDualProof(cropped, crop.selfieFile)
      : cropped;
    if (proofCrop?.previewUrl === crop.previewUrl) {
'''
new = '''    const cropped = await cropProofFile(crop.sourceFile, crop.position);
    const artifact = crop.dual
      ? await composeDualProof(cropped, crop.selfieFile)
      : cropped.size > MAX_PROOF_BYTES
        ? await compressProofFile(cropped)
        : cropped;
    const validation = validateProofFile(artifact);
    if (!validation.valid) throw new Error(validation.error);
    if (proofCrop?.previewUrl === crop.previewUrl) {
'''
assert old in app, 'expected crop confirmation block not found'
app = app.replace(old, new, 1)
APP.write_text(app)
