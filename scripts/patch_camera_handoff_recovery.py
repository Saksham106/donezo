from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
path = ROOT / 'src/app.js'
text = path.read_text()


def replace_once(old, new, label):
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected 1 exact match, found {count}')
    text = text.replace(old, new, 1)

replace_once(
    """document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') requestPortraitLock();
});""",
    """document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  requestPortraitLock();
  void startDualCameraIfNeeded();
});""",
    'visibility camera recovery',
)

replace_once(
    """function stopDualCamera() {
  dualCameraRequestId += 1;
  stopMediaStream(dualCameraStream);
  dualCameraStream = null;
}

function clearDualProof() {""",
    """function stopDualCamera() {
  dualCameraRequestId += 1;
  stopMediaStream(dualCameraStream);
  dualCameraStream = null;
}

function openNativeCameraFallback(input) {
  stopDualCamera();
  input?.click();
}

function clearDualProof() {""",
    'native camera handoff helper',
)

replace_once(
    """  app.querySelector('[data-dual-fallback-main]')?.addEventListener('click', () => dualProofMainInput?.click());
  app.querySelector('[data-dual-fallback-selfie]')?.addEventListener('click', () => proofSelfieInput?.click());""",
    """  app.querySelector('[data-dual-fallback-main]')?.addEventListener('click', () => openNativeCameraFallback(dualProofMainInput));
  app.querySelector('[data-dual-fallback-selfie]')?.addEventListener('click', () => openNativeCameraFallback(proofSelfieInput));""",
    'native fallback bindings',
)

if "function openNativeCameraFallback(input)" not in text:
    raise SystemExit('handoff helper missing after patch')
if "void startDualCameraIfNeeded();" not in text:
    raise SystemExit('visibility recovery missing after patch')

path.write_text(text)
