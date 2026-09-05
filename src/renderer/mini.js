const formatNumber = (num) => new Intl.NumberFormat('en-US').format(num || 0);

const elInput = document.getElementById('val-input');
const elOutput = document.getElementById('val-output');
const elSteps = document.getElementById('val-steps');
const elCost = document.getElementById('val-cost');
const miniBar = document.getElementById('mini-bar');
const btnDashboard = document.getElementById('btn-open-dashboard');

let isFetching = false;
let pollingTimer = null;

async function updateMiniStats() {
  if (isFetching) return;
  isFetching = true;

  try {
    if (!window.electronAPI || !window.electronAPI.getStats) return;

    const res = await window.electronAPI.getStats();
    if (!res || res.error) return;

    const session = res.currentSession || (res.sessions && res.sessions[0]) || null;

    if (session && session.metrics) {
      const inTokens = session.metrics.inputTokens || 0;
      const outTokens = session.metrics.outputTokens || 0;
      const steps = session.stepCount || session.userMessageCount || 0;
      const cost = session.metrics.estimatedCostUsd || 0;

      if (elInput) elInput.innerText = formatNumber(inTokens);
      if (elOutput) elOutput.innerText = formatNumber(outTokens);
      if (elSteps) elSteps.innerText = formatNumber(steps);
      if (elCost) elCost.innerText = `$${cost.toFixed(4)}`;
    } else {
      if (elInput) elInput.innerText = '0';
      if (elOutput) elOutput.innerText = '0';
      if (elSteps) elSteps.innerText = '0';
      if (elCost) elCost.innerText = '$0.0000';
    }
  } catch (err) {
    console.error('Error updating mini stats:', err);
  } finally {
    isFetching = false;
    // Auto-resize check after DOM update
    requestAnimationFrame(() => {
      if (miniBar && window.electronAPI && window.electronAPI.resizeMiniWidget) {
        const width = miniBar.offsetWidth;
        if (width > 0) window.electronAPI.resizeMiniWidget(width);
      }
    });
    pollingTimer = setTimeout(updateMiniStats, 2500);
  }
}

function openDashboard() {
  if (window.electronAPI && window.electronAPI.openDashboard) {
    window.electronAPI.openDashboard();
  }
}

// Click on action button or any metric card opens full dashboard
if (btnDashboard) {
  btnDashboard.addEventListener('click', (e) => {
    e.stopPropagation();
    openDashboard();
  });
}

document.querySelectorAll('.metric-item').forEach((card) => {
  card.addEventListener('click', (e) => {
    e.stopPropagation();
    openDashboard();
  });
});

// Double click anywhere on the widget bar also opens full dashboard
if (miniBar) {
  miniBar.addEventListener('dblclick', openDashboard);
}

// Observe size changes to auto-expand widget smoothly when numbers reach 6-7 digits
if (miniBar && window.ResizeObserver) {
  const ro = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const width = entry.borderBoxSize ? entry.borderBoxSize[0].inlineSize : entry.contentRect.width;
      if (width > 0 && window.electronAPI && window.electronAPI.resizeMiniWidget) {
        window.electronAPI.resizeMiniWidget(width);
      }
    }
  });
  ro.observe(miniBar);
}

// Initial update
updateMiniStats();
