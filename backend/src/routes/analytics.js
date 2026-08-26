const express = require('express');
const router = express.Router();
const { getAnalyticsTrends } = require('../controllers/analyticsController');

// GET /analytics?source=uploaded|synthetic
router.get('/', getAnalyticsTrends);

module.exports = router;