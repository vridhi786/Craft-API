import { v2 as cloudinary } from 'cloudinary';
import { env } from './environment.js';

export const isCloudStorageConfigured = () =>
  Boolean(env.cloudinary.cloudName && env.cloudinary.apiKey && env.cloudinary.apiSecret);

let configured = false;
function ensureConfigured() {
  if (configured) return;
  cloudinary.config({
    cloud_name: env.cloudinary.cloudName,
    api_key: env.cloudinary.apiKey,
    api_secret: env.cloudinary.apiSecret,
    secure: true,
  });
  configured = true;
}

/** Uploads an in-memory image buffer to Cloudinary. Secrets never leave the server. */
export function uploadBuffer(buffer, folder) {
  ensureConfigured();
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder: `crafters-workshop/${folder}`, resource_type: 'image', overwrite: false },
      (err, result) => (err ? reject(err) : resolve(result))
    );
    stream.end(buffer);
  });
}

export async function deleteImage(publicId) {
  if (!publicId || !isCloudStorageConfigured()) return;
  ensureConfigured();
  await cloudinary.uploader.destroy(publicId).catch(() => {});
}
