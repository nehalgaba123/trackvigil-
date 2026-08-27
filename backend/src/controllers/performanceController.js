const { getReshapedTracks } = require('../services/data_service');
const { getAlerts, getAnalytics } = require('../services/analyticsService');

const getBenchmarkMetrics = async (req, res) => {
  try {
    // 1. Data Processing Time (CSV Parsing & Reshaping)
    const t0 = performance.now();
    const trackData = await getReshapedTracks();
    const dataProcessingTimeMs = +(performance.now() - t0).toFixed(2);

    // 2. Analytics & Alert Response Time
    const t1 = performance.now();
    const alertData = getAlerts();
    const analyticsData = getAnalytics();
    const analyticsResponseTimeMs = +(performance.now() - t1).toFixed(2);

    // 3. Chainage Query Response Time (Point/Range lookup)
    const t2 = performance.now();
    const sampleChainage = trackData.tracks[0]?.chainage || 0;
    const lookupResult = trackData.tracks.find((t) => t.chainage === sampleChainage);
    const chainageQueryTimeMs = +(performance.now() - t2).toFixed(2);

    res.json({
      status: 'ok',
      dataset_size_tracks: trackData.tracks.length,
      metrics: {
        data_processing_time_ms: dataProcessingTimeMs,
        analytics_response_time_ms: analyticsResponseTimeMs,
        chainage_query_response_time_ms: chainageQueryTimeMs,
      },
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to run performance benchmarks', code: 500 });
  }
};

module.exports = { getBenchmarkMetrics };