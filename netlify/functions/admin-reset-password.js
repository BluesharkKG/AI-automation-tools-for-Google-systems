import { adminClient, json, requireAdmin, getUserByUsername } from './_shared.js';

export const handler = async (event) => {
  try {
    await requireAdmin(event);
    const { username, password } = JSON.parse(event.body || '{}');
    if (!username || !password) return json(400, { error: 'username and password required' });

    const user = await getUserByUsername(username);
    const { error } = await adminClient.auth.admin.updateUserById(user.id, { password });
    if (error) throw error;
    return json(200, { message: `Password reset for ${username}` });
  } catch (err) {
    return json(401, { error: err.message });
  }
};
