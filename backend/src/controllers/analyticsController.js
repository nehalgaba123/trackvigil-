const { getAnalytics, getPriority } = require('../services/analyticsService');

const getAnalyticsTrends = (req, res) => {
  try {
    const requestedSource = req.query.source;
    const data = getAnalytics(requestedSource);
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to fetch analytics trends', code: 500 });
  }
};

const getPriorityList = (req, res) => {
  try {
    const requestedSource = req.query.source;
    const data = getPriority(requestedSource);
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to fetch maintenance priority', code: 500 });
  }
};

module.exports = { getAnalyticsTrends, getPriorityList };