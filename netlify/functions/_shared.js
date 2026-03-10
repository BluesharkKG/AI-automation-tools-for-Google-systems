import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;

export const adminClient = createClient(supabaseUrl, serviceRole);

export const milestones = {
  1: 'BOGO reward',
  5: '25% off any map',
  8: '15% off any map',
  10: '50% off any map',
  12: '75% off any map',
  15: 'BOGO reward'
};

export function json(statusCode, payload) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  };
}

export async function getAuthedUser(event) {
  const token = event.headers.authorization?.replace('Bearer ', '');
  if (!token) throw new Error('Missing token');
  const { data, error } = await adminClient.auth.getUser(token);
  if (error || !data.user) throw new Error('Invalid token');
  return data.user;
}

export async function requireAdmin(event) {
  const user = await getAuthedUser(event);
  const { data: profile, error } = await adminClient
    .from('user_profiles')
    .select('role')
    .eq('id', user.id)
    .single();
  if (error || profile.role !== 'admin') throw new Error('Admin only');
  return user;
}

export async function getUserByUsername(username) {
  const normalized = username.trim().toLowerCase();
  const email = `${normalized}@mapmakerjls.local`;
  const { data, error } = await adminClient.auth.admin.listUsers();
  if (error) throw error;
  const user = data.users.find((u) => u.email === email);
  if (!user) throw new Error('User not found');
  return user;
}

export async function syncRewards(userId) {
  const { data: progress, error } = await adminClient
    .from('user_stamp_progress')
    .select('stamp_count')
    .eq('user_id', userId)
    .single();
  if (error) throw error;

  const toUnlock = Object.entries(milestones)
    .map(([stamp, reward_name]) => ({ user_id: userId, milestone_stamp: Number(stamp), reward_name }))
    .filter((r) => r.milestone_stamp <= progress.stamp_count);

  for (const reward of toUnlock) {
    await adminClient
      .from('user_rewards')
      .upsert({ ...reward, unlocked_at: new Date().toISOString() }, { onConflict: 'user_id,milestone_stamp' });
  }
}
