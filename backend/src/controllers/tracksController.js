const { getReshapedTracks } = require('../services/data_service');

const getTracks = async (req, res) => {
  try {
    const requestedSource = req.query.source;
    const data = await getReshapedTracks(requestedSource);
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to fetch tracks', code: 500 });
  }
};

module.exports = { getTracks };