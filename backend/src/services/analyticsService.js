const fs = require('fs');
const path = require('path');

// Points directly to Person 4's output directory
const ANALYTICS_DIR = path.resolve(__dirname, '../../../analytics/output');

function readJsonFile(filename, fallbackKey, defaultSource = 'uploaded') {
  const filePath = path.join(ANALYTICS_DIR, filename);
  if (fs.existsSync(filePath)) {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  }
  // Graceful fallback if analytics hasn't run yet
  return { source: defaultSource, [fallbackKey]: [] };
}

const getAlerts = (source) => readJsonFile('alerts.json', 'alerts', source);
const getAnalytics = (source) => readJsonFile('trends.json', 'trends', source);
const getPriority = (source) => readJsonFile('priority.json', 'priority', source);

module.exports = { getAlerts, getAnalytics, getPriority };