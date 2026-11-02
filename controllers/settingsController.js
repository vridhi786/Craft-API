import { sendSuccess } from '../utils/ApiResponse.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { audit } from '../utils/audit.js';
import { getSettings, saveSettings, toPublicSettings } from '../services/settingsService.js';
import { flatten } from '../utils/flatten.js';

export const getPublicSettings = asyncHandler(async (_req, res) => {
  res.set('Cache-Control', 'public, max-age=60');
  sendSuccess(res, { message: 'Settings retrieved', data: toPublicSettings(await getSettings()) });
});

export const getAdminSettings = asyncHandler(async (_req, res) => {
  sendSuccess(res, { data: await getSettings({ fresh: true }) });
});

export const updateSettings = asyncHandler(async (req, res) => {
  const saved = await saveSettings(req.body);
  await audit(req, 'settings.update', 'SiteSettings', 'main', { fields: Object.keys(flatten(req.body)) });
  sendSuccess(res, { message: 'Settings saved', data: saved });
});
