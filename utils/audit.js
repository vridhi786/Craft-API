import { supabase } from '../config/supabase.js';

/** Records an admin action. Never throws: auditing must not break the operation it describes. */
export async function audit(req, action, entity, entityId, meta = {}) {
  try {
    const { error } = await supabase.from('audit_logs').insert({
      admin_id: req.admin?.id ?? null,
      admin_email: req.admin?.email ?? null,
      action,
      entity,
      entity_id: entityId ? String(entityId) : null,
      meta,
      ip: req.ip,
    });
    if (error) console.error('Audit log failed:', error.message);
  } catch (err) {
    console.error('Audit log failed:', err.message);
  }
}
