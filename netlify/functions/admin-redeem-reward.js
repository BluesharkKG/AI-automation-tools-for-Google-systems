import { adminClient, json, requireAdmin, getUserByUsername } from './_shared.js';

export const handler = async (event) => {
  try {
    await requireAdmin(event);
    const { username, milestone_stamp } = JSON.parse(event.body || '{}');
    if (!username || !milestone_stamp) return json(400, { error: 'username and milestone_stamp required' });

    const user = await getUserByUsername(username);
    const { data, error } = await adminClient
      .from('user_rewards')
      .select('unlocked_at')
      .eq('user_id', user.id)
      .eq('milestone_stamp', milestone_stamp)
      .single();
    if (error || !data.unlocked_at) throw new Error('Reward not unlocked');

    const { error: upErr } = await adminClient
      .from('user_rewards')
      .update({ redeemed_at: new Date().toISOString() })
      .eq('user_id', user.id)
      .eq('milestone_stamp', milestone_stamp);
    if (upErr) throw upErr;

    return json(200, { message: `Marked ${username} reward ${milestone_stamp} as redeemed` });
  } catch (err) {
    return json(401, { error: err.message });
  }
};
