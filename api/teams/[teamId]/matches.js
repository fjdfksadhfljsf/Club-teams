'use strict';
const { query, withCors } = require('../../../lib/turso');

module.exports = async (req, res) => {
  withCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'method not allowed' });

  const teamId = parseInt(req.query.teamId, 10);
  if (!Number.isInteger(teamId)) return res.status(400).json({ error: 'ongeldig team_id' });

  const days = parseInt(req.query.days || '90', 10);
  const maxDate = new Date();
  maxDate.setDate(maxDate.getDate() + (Number.isFinite(days) ? days : 90));
  const maxDateStr = maxDate.toISOString().split('T')[0];

  try {
    const matches = await query(
      `SELECT id, date, time, home_name, away_name, is_home FROM matches
       WHERE team_id = ? AND date >= date('now') AND date <= ? AND is_home = 1
       ORDER BY date, time`,
      [teamId, maxDateStr]
    );
    res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate');
    res.status(200).json({ team_id: teamId, matches });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
