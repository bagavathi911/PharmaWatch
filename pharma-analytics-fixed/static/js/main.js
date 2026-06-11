'use strict';

const PLOTLY_CFG = { displayModeBar: false, responsive: true };

const PLOTLY_LAYOUT_BASE = {
  paper_bgcolor: 'rgba(0,0,0,0)',
  plot_bgcolor: 'rgba(0,0,0,0)',
  font: { family: "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif", size: 12, color: '#4b5563' },
  margin: { t: 10, r: 10, b: 40, l: 50 },
  xaxis: { gridcolor: '#f3f4f6', linecolor: '#e5e7eb', tickfont: { size: 11 } },
  yaxis: { gridcolor: '#f3f4f6', linecolor: '#e5e7eb', tickfont: { size: 11 } },
};

// ── DOM refs ──
const $ = id => document.getElementById(id);
const drugSearch   = $('drugSearch');
const searchBtn    = $('searchBtn');
const clearBtn     = $('clearBtn');
const filterReaction = $('filterReaction');
const filterYear   = $('filterYear');
const filterAge    = $('filterAge');
const loaderOverview = $('loaderOverview');
const overviewSection = $('overviewSection');
const drugResultSection = $('drugResultSection');
const errorBox     = $('errorBox');
const errorMsg     = $('errorMsg');

// ── Utils ──
function fmt(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000)     return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}

function showError(msg) {
  errorBox.style.display = 'flex';
  errorMsg.textContent   = msg;
  setTimeout(() => errorBox.style.display = 'none', 6000);
}

function hideError() { errorBox.style.display = 'none'; }

function setLoading(on) {
  searchBtn.textContent = on ? 'Analyzing…' : 'Analyze';
  searchBtn.disabled    = on;
}

// ── Load overview data on page load ──
async function loadOverview() {
  loaderOverview.style.display = 'block';
  overviewSection.style.display = 'none';

  try {
    const res  = await fetch('/api/overview');
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    $('kpiTotal').textContent  = fmt(data.total_reports);
    $('kpiDrugs').textContent  = '10+';
    $('kpiSevere').textContent = data.severe_pct + '%';

    renderTopDrugs(data.top_drugs);
    renderSeverityPie(data.severity_dist);
    renderYearlyTrend(data.yearly_trend);
    renderHeatmap(data.heatmap);

    loaderOverview.style.display  = 'none';
    overviewSection.style.display = 'grid';
  } catch (e) {
    loaderOverview.style.display = 'none';
    showError('Failed to load overview data: ' + e.message);
  }
}

// ── Drug search ──
async function searchDrug() {
  const drug = drugSearch.value.trim();
  if (!drug) { showError('Please enter a drug name.'); return; }

  hideError();
  setLoading(true);
  drugResultSection.style.display = 'none';

  const params = new URLSearchParams({ drug });
  if (filterReaction.value) params.set('reaction', filterReaction.value);
  if (filterYear.value)     params.set('year',     filterYear.value);
  if (filterAge.value)      params.set('age_group', filterAge.value);

  try {
    const res  = await fetch('/api/search?' + params.toString());
    const data = await res.json();

    if (!res.ok || data.error) throw new Error(data.error || 'Unknown error');

    populateDrugResults(data);
    drugResultSection.style.display = 'block';
    drugResultSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (e) {
    showError(e.message);
  } finally {
    setLoading(false);
  }
}

function populateDrugResults(d) {
  const name = d.drug.charAt(0).toUpperCase() + d.drug.slice(1);
  $('drugResultTitle').textContent = name + ' — Drug Insights';

  $('drTotal').textContent    = fmt(d.total_reports);
  $('drSevere').textContent   = fmt(d.severity.serious);
  $('drSeverePct').textContent = d.severity.severe_pct + '%';
  $('drAge').textContent      = d.dominant_age;

  const risk = d.prediction.risk_level;
  const riskEl = $('drRisk');
  riskEl.textContent = risk;
  riskEl.className   = 'drug-stat-value ' + risk.toLowerCase();

  // AI Card
  $('aiSummary').textContent = d.ai_summary;

  const badge = $('predBadge');
  badge.textContent = '⚠ ' + risk + ' Risk';
  badge.className   = 'prediction-badge ' + risk.toLowerCase();

  const score = d.prediction.severity_score;
  setTimeout(() => {
    $('meterFill').style.width  = score + '%';
    $('meterValue').textContent = score + '/100';
  }, 100);

  // Charts
  renderReactionsChart(d.reactions, name);
  renderDrugSeverityPie(d.severity);
  renderAgeDistChart(d.age_dist, name);
}

// ────────────── CHART RENDERERS ──────────────

function renderTopDrugs(drugs) {
  const names  = drugs.map(d => d.drug.length > 20 ? d.drug.slice(0, 20) + '…' : d.drug);
  const counts = drugs.map(d => d.count);

  Plotly.newPlot('chartTopDrugs', [{
    type: 'bar',
    x: counts,
    y: names,
    orientation: 'h',
    marker: {
      color: counts.map((_, i) => `rgba(37, 99, 235, ${1 - i * 0.07})`),
    },
    hovertemplate: '<b>%{y}</b><br>Reports: %{x:,}<extra></extra>',
  }], {
    ...PLOTLY_LAYOUT_BASE,
    margin: { t: 10, r: 20, b: 40, l: 160 },
    xaxis: { ...PLOTLY_LAYOUT_BASE.xaxis, title: { text: 'Report Count', font: { size: 11 } } },
    yaxis: { ...PLOTLY_LAYOUT_BASE.yaxis, autorange: 'reversed' },
  }, PLOTLY_CFG);
}

function renderSeverityPie(dist) {
  Plotly.newPlot('chartSeverity', [{
    type: 'pie',
    labels: dist.map(d => d.label),
    values: dist.map(d => d.count),
    marker: { colors: ['#dc2626', '#2563eb', '#d97706', '#16a34a'] },
    hovertemplate: '<b>%{label}</b><br>%{value:,} reports<br>%{percent}<extra></extra>',
    hole: 0.45,
    textfont: { size: 12 },
  }], {
    ...PLOTLY_LAYOUT_BASE,
    margin: { t: 10, r: 10, b: 10, l: 10 },
    legend: { orientation: 'h', y: -0.15, font: { size: 11 } },
    showlegend: true,
  }, PLOTLY_CFG);
}

function renderYearlyTrend(trend) {
  Plotly.newPlot('chartYearly', [{
    type: 'scatter',
    mode: 'lines+markers',
    x: trend.map(t => t.year),
    y: trend.map(t => t.count),
    line: { color: '#2563eb', width: 2.5, shape: 'spline' },
    marker: { color: '#2563eb', size: 7 },
    fill: 'tozeroy',
    fillcolor: 'rgba(37, 99, 235, 0.08)',
    hovertemplate: '<b>%{x}</b><br>Reports: %{y:,}<extra></extra>',
  }], {
    ...PLOTLY_LAYOUT_BASE,
    xaxis: { ...PLOTLY_LAYOUT_BASE.xaxis, title: { text: 'Year', font: { size: 11 } }, tickformat: 'd' },
    yaxis: { ...PLOTLY_LAYOUT_BASE.yaxis, title: { text: 'Reports', font: { size: 11 } } },
  }, PLOTLY_CFG);
}

function renderHeatmap(heatmap) {
  const ageGroups = heatmap.map(h => h.age_group);
  const serious   = heatmap.map(h => h.serious);
  const notSer    = heatmap.map(h => h.not_serious);

  Plotly.newPlot('chartHeatmap', [{
    type: 'heatmap',
    z: [serious, notSer],
    x: ageGroups,
    y: ['Serious', 'Not Serious'],
    colorscale: [
      [0,   '#eff6ff'],
      [0.5, '#93c5fd'],
      [1,   '#1d4ed8']
    ],
    hovertemplate: 'Age: %{x}<br>Category: %{y}<br>Count: %{z:,}<extra></extra>',
    showscale: true,
    colorbar: { thickness: 14, len: 0.8, tickfont: { size: 10 } },
  }], {
    ...PLOTLY_LAYOUT_BASE,
    margin: { t: 10, r: 80, b: 40, l: 90 },
    xaxis: { ...PLOTLY_LAYOUT_BASE.xaxis, title: { text: 'Age Group', font: { size: 11 } } },
    yaxis: { ...PLOTLY_LAYOUT_BASE.yaxis },
  }, PLOTLY_CFG);
}

function renderReactionsChart(reactions, drugName) {
  const labels = reactions.map(r => r.reaction.length > 22 ? r.reaction.slice(0, 22) + '…' : r.reaction);
  const counts = reactions.map(r => r.count);

  Plotly.newPlot('chartReactions', [{
    type: 'bar',
    x: counts,
    y: labels,
    orientation: 'h',
    marker: { color: counts.map((_, i) => `rgba(220, 38, 38, ${1 - i * 0.08})`) },
    hovertemplate: '<b>%{y}</b><br>%{x:,} cases<extra></extra>',
  }], {
    ...PLOTLY_LAYOUT_BASE,
    margin: { t: 10, r: 20, b: 40, l: 170 },
    xaxis: { ...PLOTLY_LAYOUT_BASE.xaxis, title: { text: 'Case Count', font: { size: 11 } } },
    yaxis: { ...PLOTLY_LAYOUT_BASE.yaxis, autorange: 'reversed' },
  }, PLOTLY_CFG);
}

function renderDrugSeverityPie(sev) {
  Plotly.newPlot('chartDrugSeverity', [{
    type: 'pie',
    labels: ['Serious', 'Not Serious'],
    values: [sev.serious, sev.not_serious],
    marker: { colors: ['#dc2626', '#2563eb'] },
    hovertemplate: '<b>%{label}</b><br>%{value:,}<br>%{percent}<extra></extra>',
    hole: 0.5,
    textinfo: 'percent+label',
    textfont: { size: 12 },
  }], {
    ...PLOTLY_LAYOUT_BASE,
    margin: { t: 10, r: 10, b: 30, l: 10 },
    showlegend: false,
    annotations: [{
      text: sev.severe_pct + '%<br>Severe',
      x: 0.5, y: 0.5,
      xanchor: 'center', yanchor: 'middle',
      showarrow: false,
      font: { size: 13, color: '#dc2626', family: 'system-ui' },
    }],
  }, PLOTLY_CFG);
}

function renderAgeDistChart(ageDist, drugName) {
  const COLORS = ['#bfdbfe', '#93c5fd', '#60a5fa', '#2563eb'];

  Plotly.newPlot('chartAgeDist', [{
    type: 'bar',
    x: ageDist.map(a => a.age_group),
    y: ageDist.map(a => a.count),
    marker: { color: COLORS },
    hovertemplate: '<b>Age %{x}</b><br>%{y:,} reports<extra></extra>',
    text: ageDist.map(a => fmt(a.count)),
    textposition: 'outside',
    textfont: { size: 11, color: '#4b5563' },
  }], {
    ...PLOTLY_LAYOUT_BASE,
    margin: { t: 30, r: 20, b: 40, l: 60 },
    xaxis: { ...PLOTLY_LAYOUT_BASE.xaxis, title: { text: 'Age Group', font: { size: 11 } } },
    yaxis: { ...PLOTLY_LAYOUT_BASE.yaxis, title: { text: 'Report Count', font: { size: 11 } } },
  }, PLOTLY_CFG);
}

// ── Event Listeners ──
searchBtn.addEventListener('click', searchDrug);
drugSearch.addEventListener('keydown', e => { if (e.key === 'Enter') searchDrug(); });

clearBtn.addEventListener('click', () => {
  drugSearch.value        = '';
  filterReaction.value    = '';
  filterYear.value        = '';
  filterAge.value         = '';
  drugResultSection.style.display = 'none';
  hideError();
});

// ── Boot ──
loadOverview();
