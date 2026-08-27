const express = require('express');
const cors = require('cors');

// Route modules
const tracksRoute = require('./src/routes/tracks');
const alertsRoute = require('./src/routes/alerts');
const analyticsRoute = require('./src/routes/analytics');
const performanceRoute = require('./src/routes/performance');

// Controllers for root-level direct mounts
const { getPriorityList } = require('./src/controllers/analyticsController');

const app = express();
const PORT = process.env.PORT || 5001;

// Global middleware
app.use(cors());
app.use(express.json());

// Mount route modules
app.use('/tracks', tracksRoute);
app.use('/alerts', alertsRoute);
app.use('/analytics', analyticsRoute);
app.use('/performance', performanceRoute);

// Direct mount for GET /priority matching api_contract.md
app.get('/priority', getPriorityList);

// Root healthcheck
app.get('/', (req, res) => {
  res.json({ status: 'TrackVigil API is running' });
});

app.listen(PORT, () => {
  console.log(`TrackVigil Backend running on http://localhost:${PORT}`);
});
