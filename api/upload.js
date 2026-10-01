// Vercel serverless function: uploads a user's records to Google Drive
// Folder layout:  Special Branch Data Bank / <user name>_<id> / <Section>_<date>.gsheet
const PROJECT = 'special-branch-data-bank';
const API_KEY = 'AIzaSyD0MKj1njDN1mRkgmCiEl8TaiQyHG32l7s'; // Firebase web key (public)
const ROOT = 'Special Branch Data Bank';

const J = async (r) => {
  const t = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((t.error && t.error.message) || t.error_description || 'HTTP ' + r.status);
  return t;
};

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  try {
    const { G_CLIENT_ID, G_CLIENT_SECRET, G_REFRESH_TOKEN } = process.env;
    if (!G_CLIENT_ID || !G_CLIENT_SECRET || !G_REFRESH_TOKEN)
      return res.status(500).json({ error: 'Drive is not configured on the server yet.' });

    // 1) Who is calling? (verify the Firebase login token)
    const idt = (req.headers.authorization || '').replace('Bearer ', '');
    if (!idt) return res.status(401).json({ error: 'Not signed in.' });
    const lk = await J(await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${API_KEY}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken: idt }) }));
    const uid = lk.users[0].localId;

    // 2) Must be an approved user (read with the user's own token, so Firestore rules apply)
    const ud = await J(await fetch(`https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/users/${uid}`,
      { headers: { Authorization: 'Bearer ' + idt } }));
    if (!ud.fields || !ud.fields.status || ud.fields.status.stringValue !== 'approved')
      return res.status(403).json({ error: 'Your account is not approved.' });
    const uname = ((ud.fields.name && ud.fields.name.stringValue) || 'user').replace(/[^\p{L}\p{N} _-]/gu, '').trim() || 'user';

    // 3) Validate data
    const { section, party, cols, rows } = req.body || {};
    if (!section || !Array.isArray(cols) || !Array.isArray(rows) || !rows.length || rows.length > 500)
      return res.status(400).json({ error: 'Invalid data.' });

    // 4) Google Drive access (admin's Drive, via stored refresh token)
    const tk = await J(await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: G_CLIENT_ID, client_secret: G_CLIENT_SECRET, refresh_token: G_REFRESH_TOKEN, grant_type: 'refresh_token' }) }));
    const A = { Authorization: 'Bearer ' + tk.access_token };
    const folder = async (nm, parent) => {
      const q = `name='${nm.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}' and mimeType='application/vnd.google-apps.folder' and trashed=false` + (parent ? ` and '${parent}' in parents` : '');
      const f = await J(await fetch('https://www.googleapis.com/drive/v3/files?fields=files(id)&q=' + encodeURIComponent(q), { headers: A }));
      if (f.files.length) return f.files[0].id;
      const c = await J(await fetch('https://www.googleapis.com/drive/v3/files?fields=id', {
        method: 'POST', headers: { ...A, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: nm, mimeType: 'application/vnd.google-apps.folder', parents: parent ? [parent] : undefined }) }));
      return c.id;
    };
    const rootId = await folder(ROOT);
    const userId = await folder(`${uname}_${uid.slice(0, 6)}`, rootId);

    // 5) Build CSV and upload it as a Google Sheet
    const cell = (v) => { let t = String(v == null ? '' : v); if (/^[=+\-@]/.test(t)) t = ' ' + t; return '"' + t.replace(/"/g, '""') + '"'; };
    const csv = '\ufeff' + [cols, ...rows].map((r) => r.map(cell).join(',')).join('\r\n');
    const stamp = new Date(Date.now() + 5 * 3600e3).toISOString().slice(0, 16).replace('T', '_').replace(':', '-');
    const fname = `${String(section).replace(/[^\p{L}\p{N} _-]/gu, '')}${party ? '_' + String(party).replace(/[^\p{L}\p{N} _-]/gu, '') : ''}_${stamp}`;
    const bd = 'sbdb' + Date.now();
    const body = `--${bd}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name: fname, mimeType: 'application/vnd.google-apps.spreadsheet', parents: [userId] })}\r\n--${bd}\r\nContent-Type: text/csv; charset=UTF-8\r\n\r\n${csv}\r\n--${bd}--`;
    const up = await J(await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', {
      method: 'POST', headers: { ...A, 'Content-Type': 'multipart/related; boundary=' + bd }, body }));
    return res.status(200).json({ ok: true, id: up.id, count: rows.length });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'Upload failed.' });
  }
};
