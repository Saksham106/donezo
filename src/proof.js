export const MAX_PROOF_BYTES = 4 * 1024 * 1024;
export const ALLOWED_PROOF_TYPES = Object.freeze(['image/jpeg', 'image/png', 'image/webp', 'image/heic']);

export function validateProofFile(file) {
  if (!file) return { valid: false, error: 'Choose a photo first' };
  if (!ALLOWED_PROOF_TYPES.includes(file.type)) {
    return { valid: false, error: 'Use JPG, PNG, WebP, or HEIC' };
  }
  if (!Number.isFinite(file.size) || file.size < 0 || file.size > MAX_PROOF_BYTES) {
    return { valid: false, error: 'Keep proof under 4 MB' };
  }
  return { valid: true, error: null };
}

export function formatProofFileSize(bytes) {
  const size = Math.max(0, Number(bytes) || 0);
  if (size < 1024) return `${Math.round(size)} B`;
  if (size < 1024 * 1024) return `${Math.round((size / 1024) * 10) / 10} KB`;
  return `${Math.round((size / (1024 * 1024)) * 10) / 10} MB`;
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
