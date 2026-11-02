import { sendSuccess } from '../utils/ApiResponse.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { audit } from '../utils/audit.js';
import { uploadImages } from '../services/uploadService.js';

export const uploadTo = (folder) =>
  asyncHandler(async (req, res) => {
    const images = await uploadImages(req.files, folder);
    await audit(req, 'upload.images', folder, undefined, { count: images.length });
    sendSuccess(res, { status: 201, message: 'Images uploaded', data: images });
  });
