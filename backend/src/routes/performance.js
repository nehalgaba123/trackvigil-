const express = require('express');
const router = express.Router();
const { getBenchmarkMetrics } = require('../controllers/performanceController');

// GET /performance/benchmark
router.get('/benchmark', getBenchmarkMetrics);

module.exports = router;