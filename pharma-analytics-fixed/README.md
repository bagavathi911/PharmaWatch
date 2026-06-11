# PharmaWatch — Adverse Drug Event Analytics

A pharmaceutical analytics platform using OpenFDA data, Plotly charts, and Groq AI insights.

## Project Structure

```
pharma-analytics/
├── app.py                  ← Flask backend
├── requirements.txt
├── templates/
│   └── index.html          ← Main UI
└── static/
    ├── css/style.css
    └── js/main.js
```

## Setup

### 1. Install dependencies
```bash
pip install -r requirements.txt
```

### 2. Get your FREE Groq API key
- Go to https://console.groq.com
- Sign up (free, no credit card)
- Create an API key

### 3. Set your Groq API key

**Option A — Environment variable (recommended):**
```bash
# Windows
set GROQ_API_KEY=your_key_here

# Mac/Linux
export GROQ_API_KEY=your_key_here
```

**Option B — Edit app.py directly:**
```python
GROQ_API_KEY = "your_key_here"   # line 8 in app.py
```

### 4. Run the app
```bash
python app.py
```

Open your browser at: **http://localhost:5000**

---

## Features

| Feature | Details |
|---|---|
| **Data Source** | OpenFDA Drug Event API (public, no key needed) |
| **AI Summaries** | Groq LLaMA-3 (free tier) |
| **Charts** | Plotly.js — bar, pie, heatmap, line |
| **Overview** | Top 10 drugs, severity pie, yearly trend, age heatmap |
| **Drug Search** | Per-drug: reactions, severity, age groups, AI summary |
| **Filters** | Drug name, reaction type, year, age group |
| **Prediction** | Rule-based severity score (0–100) + risk level |

## Example Drug Searches

Try searching: `Aspirin`, `Ibuprofen`, `Metformin`, `Lisinopril`, `Warfarin`, `Paracetamol`

---

## Notes

- OpenFDA has rate limits (~240 requests/min). The overview page makes ~15 API calls on load.
- The AI summary falls back to a template if the Groq API key is not set.
- Data is real-time from FDA's public database.
