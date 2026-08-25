'use strict';
const { query, withCors } = require('../../lib/turso');

module.exports = async (req, res) => {
  withCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'method not allowed' });

  const { ref } = req.query;
  if (!/^[A-Za-z0-9]{1,20}$/.test(ref || '')) return res.status(400).json({ error: 'ongeldige club_ref' });

  try {
    const clubRows = await query('SELECT * FROM clubs WHERE id = ?', [ref]);
    if (!clubRows.length) return res.status(404).json({ error: 'club not found' });
    const teams = await query('SELECT id, name, category, poule_id FROM teams WHERE club_id = ? ORDER BY name COLLATE NOCASE', [ref]);
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate');
    res.status(200).json({ club: clubRows[0], teams });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
