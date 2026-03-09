import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function logMessage({ instance, to, type, status, error = null }) {
  const { error: dbError } = await supabase
    .from('whatsapp_logs')
    .insert({ instance, to, type, status, error });

  if (dbError) {
    console.error('[logger] Error guardando log:', dbError.message);
  }
}

export async function getLogs({ instance, limit = 20 }) {
  let query = supabase
    .from('whatsapp_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (instance) query = query.eq('instance', instance);

  const { data, error } = await query;
  if (error) throw error;
  return data;
}
