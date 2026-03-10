import { adminClient, json, requireAdmin, getUserByUsername, syncRewards } from './_shared.js';

export const handler = async (event) => {
  try {
    await requireAdmin(event);
    const { username, delta } = JSON.parse(event.body || '{}');
    if (!username || Number.isNaN(delta)) return json(400, { error: 'username and numeric delta required' });

    const user = await getUserByUsername(username);
    const { data: progress, error } = await adminClient
      .from('user_stamp_progress')
      .select('stamp_count')
      .eq('user_id', user.id)
      .single();
    if (error) throw error;

    const stamp_count = Math.max(0, Math.min(15, progress.stamp_count + Number(delta)));
    const { error: updateErr } = await adminClient
      .from('user_stamp_progress')
      .update({ stamp_count })
      .eq('user_id', user.id);
    if (updateErr) throw updateErr;

    await syncRewards(user.id);
    return json(200, { message: `Updated ${username} to ${stamp_count}/15 stamps` });
  } catch (err) {
    return json(401, { error: err.message });
  }
};
