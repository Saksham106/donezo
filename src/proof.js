export const MAX_PROOF_BYTES = 4 * 1024 * 1024;
export const ALLOWED_PROOF_TYPES = Object.freeze(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);

const PROOF_TYPE_ALIASES = Object.freeze({
  'image/jpeg': 'image/jpeg',
  'image/jpg': 'image/jpeg',
  'image/png': 'image/png',
  'image/webp': 'image/webp',
  'image/heic': 'image/heic',
  'image/heif': 'image/heif',
});

const PROOF_EXTENSION_TYPES = Object.freeze({
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
});

export function proofMimeType(file) {
  const explicit = PROOF_TYPE_ALIASES[String(file?.type || '').trim().toLowerCase()];
  if (explicit) return explicit;
  const generic = !file?.type || String(file.type).toLowerCase() === 'application/octet-stream';
  if (!generic) return null;
  const extension = String(file?.name || '').toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  return PROOF_EXTENSION_TYPES[extension] || null;
}

export function validateProofFile(file) {
  if (!file) return { valid: false, error: 'Choose a photo first' };
  if (!proofMimeType(file)) {
    return { valid: false, error: 'Use JPG, PNG, WebP, HEIC, or HEIF' };
  }
  if (!Number.isFinite(file.size) || file.size < 0 || file.size > MAX_PROOF_BYTES) {
    return { valid: false, error: 'Keep proof under 4 MB' };
  }
  if (file.size === 0) return { valid: false, error: 'That photo is empty. Choose another one.' };
  return { valid: true, error: null };
}

async function decodeProofImage(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      // Safari can decode camera-roll formats through <img> even when createImageBitmap cannot.
    }
  }
  if (typeof Image !== 'function' || typeof URL?.createObjectURL !== 'function') {
    throw new Error('This browser could not read that photo. Choose a smaller photo or a screenshot.');
  }
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = 'async';
    image.src = url;
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error('This browser could not read that photo. Choose a smaller photo or a screenshot.'));
    });
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function encodeProofImage(image, width, height, quality) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('This browser could not resize that photo.');
  context.fillStyle = '#fff';
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
  canvas.width = 1;
  canvas.height = 1;
  if (!blob) throw new Error('This browser could not resize that photo.');
  return blob;
}

export async function compressProofFile(file, {
  maxBytes = MAX_PROOF_BYTES,
  maxDimension = 2048,
  decodeImage = decodeProofImage,
  encodeImage = encodeProofImage,
} = {}) {
  if (!file) throw new Error('Choose a photo first');
  if (!proofMimeType(file)) throw new Error('Use JPG, PNG, WebP, HEIC, or HEIF');
  if (!Number.isFinite(file.size) || file.size <= 0) throw new Error('That photo is empty. Choose another one.');
  if (file.size <= maxBytes) return file;

  const image = await decodeImage(file);
  try {
    const sourceWidth = Number(image?.width || image?.naturalWidth);
    const sourceHeight = Number(image?.height || image?.naturalHeight);
    if (!sourceWidth || !sourceHeight) throw new Error('This browser could not read that photo. Choose a smaller photo or a screenshot.');
    const initialScale = Math.min(1, maxDimension / Math.max(sourceWidth, sourceHeight));
    let width = Math.max(1, Math.round(sourceWidth * initialScale));
    let height = Math.max(1, Math.round(sourceHeight * initialScale));
    const qualities = [0.88, 0.78, 0.68, 0.58, 0.48];

    for (let sizePass = 0; sizePass < 4; sizePass += 1) {
      for (const quality of qualities) {
        const blob = await encodeImage(image, width, height, quality);
        if (blob?.size > 0 && blob.size <= maxBytes) {
          const baseName = String(file.name || 'proof').replace(/\.[^.]+$/, '') || 'proof';
          return new File([blob], `${baseName}-compressed.jpg`, {
            type: 'image/jpeg',
            lastModified: Number(file.lastModified) || Date.now(),
          });
        }
      }
      width = Math.max(1, Math.round(width * 0.78));
      height = Math.max(1, Math.round(height * 0.78));
    }
    throw new Error('Couldn’t shrink this photo under 4 MB. Choose a smaller one.');
  } finally {
    image?.close?.();
  }
}

export function formatProofFileSize(bytes) {
  const size = Math.max(0, Number(bytes) || 0);
  if (size < 1024) return `${Math.round(size)} B`;
  if (size < 1024 * 1024) return `${Math.round((size / 1024) * 10) / 10} KB`;
  return `${Math.round((size / (1024 * 1024)) * 10) / 10} MB`;
}

export function imageFileFromPasteData(dataTransfer) {
  const files = [...(dataTransfer?.files || [])];
  const direct = files.find((file) => file?.type?.startsWith('image/'));
  if (direct) return direct;
  for (const item of [...(dataTransfer?.items || [])]) {
    if (item?.kind !== 'file' || !item.type?.startsWith('image/')) continue;
    const file = item.getAsFile?.();
    if (file) return file;
  }
  return null;
}

export async function readClipboardImage(clipboard) {
  if (!clipboard || typeof clipboard.read !== 'function') {
    throw new Error('Clipboard photo access is not supported here. Try pressing and holding to paste, or choose from your library.');
  }
  const items = await clipboard.read();
  for (const item of items) {
    const type = item.types?.find((candidate) => candidate.startsWith('image/'));
    if (!type) continue;
    const blob = await item.getType(type);
    const extension = ({
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
      'image/heic': 'heic',
      'image/heif': 'heif',
    })[type] || 'png';
    return new File([blob], `pasted-proof.${extension}`, { type, lastModified: Date.now() });
  }
  throw new Error('No photo found in your clipboard. Copy an image, then try again.');
}

export function createProofReviewState({ file, habitId, previewUrl }) {
  return {
    file,
    habitId,
    previewUrl,
    status: 'ready',
    error: null,
  };
}

export function transitionProofReview(state, action) {
  if (action.type === 'selected') {
    return createProofReviewState({
      file: action.file,
      habitId: action.habitId,
      previewUrl: action.previewUrl,
    });
  }
  if (!state) return null;
  if (action.type === 'uploading') return { ...state, status: 'uploading', error: null };
  if (action.type === 'failed') return { ...state, status: 'error', error: String(action.error || 'Proof upload failed') };
  return state;
}
