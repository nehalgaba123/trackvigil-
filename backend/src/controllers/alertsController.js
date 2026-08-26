const { getAlerts } = require('../services/analyticsService');

const getAlertsData = (req, res) => {
  try {
    const requestedSource = req.query.source;
    const data = getAlerts(requestedSource);
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to fetch alerts', code: 500 });
  }
};

module.exports = { getAlertsData };