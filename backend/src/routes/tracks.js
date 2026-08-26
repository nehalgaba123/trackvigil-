const express = require('express');
const router = express.Router();
const { getTracks } = require('../controllers/tracksController');

// GET /tracks?source=uploaded|synthetic
router.get('/', getTracks);

module.exports = router;