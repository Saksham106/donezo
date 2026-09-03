export async function decodeProofImage(file) {
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

export function proofImageSize(image) {
  const width = Number(image?.width || image?.naturalWidth || 0);
  const height = Number(image?.height || image?.naturalHeight || 0);
  if (!width || !height) throw new Error('This browser could not read that photo.');
  return { width, height };
}
