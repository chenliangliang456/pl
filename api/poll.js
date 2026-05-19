const { setCors, readJsonBody, sendJson, sendError } = require('./_helpers');
const { runPoll } = require('../lib/generate');

module.exports = async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    return sendJson(res, 405, { message: '仅支持 POST' });
  }

  try {
    const body = await readJsonBody(req);
    const data = await runPoll(body);
    return sendJson(res, 200, data);
  } catch (err) {
    console.error('poll error:', err);
    return sendError(res, err);
  }
};
