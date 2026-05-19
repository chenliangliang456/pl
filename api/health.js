const { setCors, sendJson, sendError } = require('./_helpers');
const { getHealthPayload } = require('../lib/generate');

module.exports = async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') {
    return sendJson(res, 405, { message: '仅支持 GET' });
  }

  try {
    return sendJson(res, 200, getHealthPayload());
  } catch (err) {
    return sendError(res, err);
  }
};
