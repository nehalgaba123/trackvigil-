const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');

const CSV_PATH = path.resolve(__dirname, '../../../data/processed/cleaned_data.csv');

async function getReshapedTracks(source = 'uploaded') {
  return new Promise((resolve, reject) => {
    const chainageMap = new Map();

    if (!fs.existsSync(CSV_PATH)) {
      return resolve({ source: 'synthetic', tracks: [] });
    }

    fs.createReadStream(CSV_PATH)
      .pipe(csv())
      .on('data', (row) => {
        const chainage = parseFloat(row.chainage);
        const { date, parameter, value } = row;
        const numVal = parseFloat(value);

        if (!chainageMap.has(chainage)) {
          chainageMap.set(chainage, {
            chainage,
            parameters: {
              gauge: { current: null, unit: 'mm', history: [] },
              alignment: { current: null, unit: 'mm', history: [] },
              twist: { current: null, unit: 'mm', history: [] },
              unevenness: { current: null, unit: 'mm', history: [] },
              crossLevel: { current: null, unit: 'mm', history: [] },
              railWear: { current: null, unit: 'mm', history: [] },
            },
          });
        }

        const entry = chainageMap.get(chainage);
        if (entry.parameters[parameter]) {
          entry.parameters[parameter].history.push({ date, value: numVal });
        }
      })
      .on('end', () => {
        // Sort history by date and set current reading
        for (const track of chainageMap.values()) {
          for (const paramKey of Object.keys(track.parameters)) {
            const paramObj = track.parameters[paramKey];
            paramObj.history.sort((a, b) => new Date(a.date) - new Date(b.date));
            if (paramObj.history.length > 0) {
              paramObj.current = paramObj.history[paramObj.history.length - 1].value;
            }
          }
        }

        resolve({
          source: source || 'uploaded',
          tracks: Array.from(chainageMap.values()).sort((a, b) => a.chainage - b.chainage),
        });
      })
      .on('error', (err) => reject(err));
  });
}

module.exports = { getReshapedTracks };