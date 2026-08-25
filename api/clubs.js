'use strict';
const { query, withCors } = require('../lib/turso');

module.exports = async (req, res) => {
  withCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'method not allowed' });

  try {
    const rows = await query('SELECT id, name, city, logo FROM clubs ORDER BY name COLLATE NOCASE');
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate');
    res.status(200).json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
