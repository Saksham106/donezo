import { compressProofFile, validateProofFile } from './proof.js';
import { decodeProofImage } from './proof-image.js';

export function createDualProofState(habitId, firstFile = null, firstRole = null) {
  const role = firstRole === 'main' || firstRole === 'selfie' ? firstRole : null;
  return {
    habitId,
    mainFile: role === 'main' ? firstFile : null,
    selfieFile: role === 'selfie' ? firstFile : null,
    firstRole: role,
    error: null,
  };
}

export function setDualProofFile(state, role, file) {
  if (!state || !file || !['main', 'selfie'].includes(role)) return state;
  return role === 'main'
    ? { ...state, mainFile: file, error: null }
    : { ...state, selfieFile: file, error: null };
}

export function compositionGeometry(main, selfie, {
  maxDimension = 2048,
  insetRatio = 0.3,
  marginRatio = 0.03,
} = {}) {
  const mainWidth = Number(main?.width || main?.naturalWidth || 0);
  const mainHeight = Number(main?.height || main?.naturalHeight || 0);
  const selfieWidth = Number(selfie?.width || selfie?.naturalWidth || 0);
  const selfieHeight = Number(selfie?.height || selfie?.naturalHeight || 0);
  if (!mainWidth || !mainHeight || !selfieWidth || !selfieHeight) throw new Error('Could not read both proof photos');

  const scale = Math.min(1, maxDimension / Math.max(mainWidth, mainHeight));
  const width = Math.max(1, Math.round(mainWidth * scale));
  const height = Math.max(1, Math.round(mainHeight * scale));
  const inset = Math.max(72, Math.round(width * insetRatio));
  const margin = Math.max(8, Math.round(width * marginRatio));
  const sourceSize = Math.min(selfieWidth, selfieHeight);
  const sourceX = Math.max(0, Math.round((selfieWidth - sourceSize) / 2));
  const sourceY = Math.max(0, Math.round((selfieHeight - sourceSize) / 2));

  return {
    width,
    height,
    main: { sourceWidth: mainWidth, sourceHeight: mainHeight, destWidth: width, destHeight: height },
    selfie: {
      sourceX,
      sourceY,
      sourceWidth: sourceSize,
      sourceHeight: sourceSize,
      destX: Math.max(0, width - inset - margin),
      destY: margin,
      destWidth: inset,
      destHeight: inset,
    },
  };
}

function roundedRect(context, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.arcTo(x + width, y, x + width, y + height, r);
  context.arcTo(x + width, y + height, x, y + height, r);
  context.arcTo(x, y + height, x, y, r);
  context.arcTo(x, y, x + width, y, r);
  context.closePath();
}

async function encodeComposite({ mainImage, selfieImage, geometry }) {
  if (typeof document === 'undefined') throw new Error('This browser could not compose that proof.');
  const canvas = document.createElement('canvas');
  canvas.width = geometry.width;
  canvas.height = geometry.height;
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('This browser could not compose that proof.');

  context.fillStyle = '#111';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(mainImage, 0, 0, geometry.main.sourceWidth, geometry.main.sourceHeight, 0, 0, geometry.width, geometry.height);

  const inset = geometry.selfie;
  const radius = Math.max(12, Math.round(inset.destWidth * 0.08));
  context.save();
  roundedRect(context, inset.destX, inset.destY, inset.destWidth, inset.destHeight, radius);
  context.clip();
  context.drawImage(
    selfieImage,
    inset.sourceX,
    inset.sourceY,
    inset.sourceWidth,
    inset.sourceHeight,
    inset.destX,
    inset.destY,
    inset.destWidth,
    inset.destHeight,
  );
  context.restore();
  context.save();
  context.strokeStyle = 'rgba(255,255,255,.92)';
  context.lineWidth = Math.max(3, Math.round(inset.destWidth * 0.012));
  roundedRect(context, inset.destX, inset.destY, inset.destWidth, inset.destHeight, radius);
  context.stroke();
  context.restore();

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.88));
  canvas.width = 1;
  canvas.height = 1;
  if (!blob) throw new Error('This browser could not compose that proof.');
  return blob;
}

export async function composeDualProof(mainFile, selfieFile, {
  maxDimension = 2048,
  insetRatio = 0.3,
  marginRatio = 0.03,
  decodeImage = decodeProofImage,
  encodeComposite: encode = encodeComposite,
  compressFile = compressProofFile,
  now = Date.now,
} = {}) {
  if (!mainFile || !selfieFile) throw new Error('Take both proof photos first');
  const mainImage = await decodeImage(mainFile);
  const selfieImage = await decodeImage(selfieFile);
  try {
    const geometry = compositionGeometry(mainImage, selfieImage, { maxDimension, insetRatio, marginRatio });
    const blob = await encode({ mainImage, selfieImage, geometry });
    const timestamp = now();
    const raw = new File([blob], `dual-proof-${timestamp}.jpg`, { type: 'image/jpeg', lastModified: timestamp });
    const compressed = await compressFile(raw);
    const validation = validateProofFile(compressed);
    if (!validation.valid) throw new Error(validation.error);
    return compressed;
  } finally {
    mainImage?.close?.();
    selfieImage?.close?.();
  }
}
