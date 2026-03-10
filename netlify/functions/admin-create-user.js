import { adminClient, json, requireAdmin } from './_shared.js';

export const handler = async (event) => {
  try {
    await requireAdmin(event);
    const { username, password, role = 'user' } = JSON.parse(event.body || '{}');
    if (!username || !password) return json(400, { error: 'username and password required' });

    const email = `${username.trim().toLowerCase()}@mapmakerjls.local`;
    const { data, error } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { username: username.trim().toLowerCase() }
    });
    if (error) throw error;

    const userId = data.user.id;
    await adminClient.from('user_profiles').insert({ id: userId, username: username.trim().toLowerCase(), role });
    await adminClient.from('user_stamp_progress').insert({ user_id: userId, stamp_count: 0 });

    return json(200, { message: `Created ${username} (${role})` });
  } catch (err) {
    return json(401, { error: err.message });
  }
};
