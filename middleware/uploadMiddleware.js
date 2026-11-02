import multer from 'multer';
import { ApiError } from '../utils/ApiError.js';
import { detectImageType } from '../utils/imageType.js';

const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp']);
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const parser = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_BYTES, files: 10 },
  fileFilter: (_req, file, cb) =>
    ALLOWED.has(file.mimetype) ? cb(null, true) : cb(new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Only JPEG, PNG or WebP images are allowed')),
});

/** Accepts up to `max` images in multipart field "images" and verifies real content via magic bytes. */
export const imageUpload = (max = 10) => [
  parser.array('images', max),
  (req, _res, next) => {
    if (!req.files || req.files.length === 0) return next(ApiError.badRequest('No image received (field name must be "images")', 'NO_FILE'));
    for (const file of req.files) {
      const real = detectImageType(file.buffer);
      if (!real || real !== file.mimetype) {
        return next(new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', `"${file.originalname}" is not a valid JPEG, PNG or WebP image`));
      }
    }
    return next();
  },
];
