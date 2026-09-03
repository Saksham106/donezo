import { decodeProofImage, proofImageSize } from './proof-image.js';

export const PROOF_CROP_RATIO = 3 / 4;

export function needsProofCrop(width, height, ratio = PROOF_CROP_RATIO) {
  const w = Number(width || 0);
  const h = Number(height || 0);
  return w > 0 && h > 0 && h > w / ratio;
}

export function cropGeometry(width, height, position = 0.5, ratio = PROOF_CROP_RATIO) {
  const w = Math.max(1, Math.round(Number(width) || 0));
  const h = Math.max(1, Math.round(Number(height) || 0));
  const cropHeight = Math.min(h, Math.round(w / ratio));
  const maxY = Math.max(0, h - cropHeight);
  const numericPosition = Number(position);
  const normalizedPosition = Number.isFinite(numericPosition) ? Math.max(0, Math.min(1, numericPosition)) : 0.5;
  const sourceY = Math.round(maxY * normalizedPosition);
  return {
    sourceX: 0,
    sourceY,
    sourceWidth: w,
    sourceHeight: cropHeight,
    outputWidth: w,
    outputHeight: cropHeight,
  };
}

async function encodeProofCrop({ image, geometry, quality = 0.9 }) {
  if (typeof document === 'undefined') throw new Error('This browser could not crop that photo.');
  const canvas = document.createElement('canvas');
  canvas.width = geometry.outputWidth;
  canvas.height = geometry.outputHeight;
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('This browser could not crop that photo.');
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(
    image,
    geometry.sourceX,
    geometry.sourceY,
    geometry.sourceWidth,
    geometry.sourceHeight,
    0,
    0,
    geometry.outputWidth,
    geometry.outputHeight,
  );
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
  canvas.width = 1;
  canvas.height = 1;
  if (!blob) throw new Error('This browser could not crop that photo.');
  return blob;
}

export async function inspectProofFile(file, { decodeImage = decodeProofImage } = {}) {
  if (!file) throw new Error('Choose a photo first');
  const image = await decodeImage(file);
  try {
    const { width, height } = proofImageSize(image);
    return { width, height, needsCrop: needsProofCrop(width, height) };
  } finally {
    image?.close?.();
  }
}

export async function cropProofFile(file, position = 0.5, {
  decodeImage = decodeProofImage,
  encodeCrop = encodeProofCrop,
  quality = 0.9,
} = {}) {
  if (!file) throw new Error('Choose a photo first');
  const image = await decodeImage(file);
  try {
    const { width, height } = proofImageSize(image);
    const geometry = cropGeometry(width, height, position);
    const blob = await encodeCrop({ image, geometry, quality });
    if (!blob || !Number.isFinite(blob.size) || blob.size <= 0) throw new Error('This browser could not crop that photo.');
    const baseName = String(file.name || 'proof').replace(/\.[^.]+$/, '') || 'proof';
    return new File([blob], `${baseName}-cropped.jpg`, {
      type: 'image/jpeg',
      lastModified: Number(file.lastModified) || Date.now(),
    });
  } finally {
    image?.close?.();
  }
}
