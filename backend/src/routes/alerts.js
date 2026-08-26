const express = require('express');
const router = express.Router();
const { getAlertsData } = require('../controllers/alertsController');

// GET /alerts?source=uploaded|synthetic
router.get('/', getAlertsData);

module.exports = router;