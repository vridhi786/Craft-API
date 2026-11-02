import { isCloudStorageConfigured, uploadBuffer } from '../config/cloud-storage.js';
import { ApiError } from '../utils/ApiError.js';

export async function uploadImages(files, folder) {
  if (!isCloudStorageConfigured()) {
    throw new ApiError(503, 'STORAGE_NOT_CONFIGURED', 'Image storage is not configured. Set the CLOUDINARY_* environment variables.');
  }
  try {
    const results = await Promise.all(files.map((f) => uploadBuffer(f.buffer, folder)));
    return results.map((r) => ({ url: r.secure_url, publicId: r.public_id, width: r.width, height: r.height }));
  } catch (err) {
    console.error('Cloud upload failed:', err.message);
    throw new ApiError(502, 'UPLOAD_FAILED', 'The image could not be stored. Please try again.');
  }
}
