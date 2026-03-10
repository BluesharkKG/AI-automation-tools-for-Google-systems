import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = window.__MAPMAKER_CONFIG__?.supabaseUrl || localStorage.getItem('MAPMAKER_SUPABASE_URL');
const SUPABASE_ANON_KEY = window.__MAPMAKER_CONFIG__?.supabaseAnonKey || localStorage.getItem('MAPMAKER_SUPABASE_ANON_KEY');

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.warn('Missing Supabase config. Set window.__MAPMAKER_CONFIG__ in config.js or localStorage keys.');
}

export const supabase = createClient(SUPABASE_URL || '', SUPABASE_ANON_KEY || '');

export function usernameToEmail(username) {
  return `${username.trim().toLowerCase()}@mapmakerjls.local`;
}

export async function requireAuth(redirect = '/login') {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    window.location.href = redirect;
    return null;
  }
  return session;
}

export async function getProfile() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase.from('user_profiles').select('*').eq('id', user.id).single();
  if (error) throw error;
  return data;
}

export async function fetchDashboardData() {
  const { data, error } = await supabase
    .from('user_stamp_overview')
    .select('*')
    .single();
  if (error) throw error;

  const { data: rewards, error: rErr } = await supabase
    .from('user_reward_status')
    .select('*')
    .order('milestone_stamp', { ascending: true });
  if (rErr) throw rErr;

  return { overview: data, rewards };
}

export async function apiPost(path, body) {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(`/api/${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session?.access_token || ''}`
    },
    body: JSON.stringify(body)
  });
  const payload = await res.json();
  if (!res.ok) throw new Error(payload.error || 'Request failed');
  return payload;
}
