# TrackVigil — Railway Track Monitoring Dashboard

Frontend-only demo (SIH hackathon prototype) for railway track geometry
monitoring. No backend — all data is generated in-browser.

## Run locally

```bash
npm install
npm run dev
```

Then open the printed local URL (usually http://localhost:5173).

## Build for the demo video / deployment

```bash
npm run build
npm run preview
```

## Project structure

```
index.html              entry HTML
src/main.jsx             mounts the React app
src/index.css            Tailwind base styles
src/RailTrackDashboard.jsx   the entire app (single component file)
```
