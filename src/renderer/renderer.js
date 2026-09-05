const COLORS = ['#10b981', '#3b82f6', '#06b6d4', '#8b5cf6', '#ec4899', '#f59e0b', '#64748b'];

let allStats = [];
let totalSupportedModels = 19;
let currentFilter = localStorage.getItem('token_analytics_filter') || 'all';
let currentActiveSession = null;
let latestContextLimits = null;
let donutChart = null;

const formatNumber = (num) => new Intl.NumberFormat('en-US').format(num || 0);

let isLoading = false;
let pollingTimer = null;

async function loadData() {
  if (isLoading) return;
  isLoading = true;
  try {
    let res = null;
    if (window.electronAPI && window.electronAPI.getStats) {
      res = await window.electronAPI.getStats();
    } else if (window.__TAURI__) {
      const invoke = window.__TAURI__.core?.invoke || window.__TAURI__.invoke;
      if (invoke) {
        res = await invoke('get_stats');
      }
    }
    if (!res) return;
    if (res && res.error) {
      console.error('Backend Error:', res.error);
      const tableBody = document.getElementById('table-body');
      if (tableBody) tableBody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: #f43f5e; padding: 24px 0;">Error: ${res.error}</td></tr>`;
    } else if (res && res.sessions) {
      if (res.totalSupportedModels) {
        totalSupportedModels = res.totalSupportedModels;
      }
      latestContextLimits = res.contextLimits || null;
      currentActiveSession = res.currentSession || (res.sessions[0] || null);
      allStats = res.sessions;
      updateActiveSessionUI(currentActiveSession, latestContextLimits);
      updateUI();
    }
  } catch (err) {
    console.error('Error in renderer loadData:', err);
  } finally {
    isLoading = false;
    // When window is minimized or hidden in tray, pause polling completely (0% CPU, 0 disk I/O, 0 memory churn)
    if (!document.hidden) {
      pollingTimer = setTimeout(loadData, 2500);
    }
  }
}

// React to visibility changes to instantly resume polling when window is restored
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    if (pollingTimer) clearTimeout(pollingTimer);
    loadData();
  } else {
    if (pollingTimer) clearTimeout(pollingTimer);
  }
});

function updateUI() {
  const now = Date.now();
  const count24h = allStats.filter((s) => now - s.lastUpdated <= 24 * 60 * 60 * 1000).length;
  const count7d = allStats.filter((s) => now - s.lastUpdated <= 7 * 24 * 60 * 60 * 1000).length;
  const countAll = allStats.length;

  const btn24h = document.querySelector('.filter-btn[data-filter="24h"]');
  const btn7d = document.querySelector('.filter-btn[data-filter="7d"]');
  const btnAll = document.querySelector('.filter-btn[data-filter="all"]');
  if (btn24h) btn24h.innerText = `24 Hours (${count24h})`;
  if (btn7d) btn7d.innerText = `7 Days (${count7d})`;
  if (btnAll) btnAll.innerText = `All Time (${countAll})`;

  const filtered = allStats.filter((s) => {
    if (currentFilter === '24h') {
      return now - s.lastUpdated <= 24 * 60 * 60 * 1000;
    }
    if (currentFilter === '7d') {
      return now - s.lastUpdated <= 7 * 24 * 60 * 60 * 1000;
    }
    return true;
  });

  // Calculate top metrics
  let totalTokens = 0;
  let totalCost = 0;
  let totalCalls = 0;
  const uniqueModels = new Set();

  filtered.forEach((s) => {
    totalTokens += s.metrics.totalTokens;
    totalCost += s.metrics.estimatedCostUsd;
    totalCalls += s.userMessageCount;
    if (s.modelBreakdown) {
      Object.keys(s.modelBreakdown).forEach((mKey) => {
        uniqueModels.add(s.modelBreakdown[mKey].modelName);
      });
    } else if (s.detectedModelName) {
      uniqueModels.add(s.detectedModelName);
    }
  });

  document.getElementById('val-total-requests').innerText = formatNumber(totalCalls);
  document.getElementById('sub-conversations').innerText = `${filtered.length} conversations`;
  document.getElementById('val-total-tokens').innerText = formatNumber(totalTokens);
  document.getElementById('val-total-cost').innerText = `$${totalCost.toFixed(4)}`;
  document.getElementById('val-models-used').innerText = `${uniqueModels.size} / ${totalSupportedModels}`;
  document.getElementById('val-avg-tokens').innerText = totalCalls > 0 ? formatNumber(Math.floor(totalTokens / totalCalls)) : '0';

  // Model aggregation
  const modelTableMap = {};
  filtered.forEach((s) => {
    if (s.modelBreakdown && Object.keys(s.modelBreakdown).length > 0) {
      Object.values(s.modelBreakdown).forEach((metric) => {
        const name = metric.modelName;
        if (!modelTableMap[name]) {
          modelTableMap[name] = { name, inputTokens: 0, outputTokens: 0, totalTokens: 0, calls: 0, cost: 0 };
        }
        modelTableMap[name].inputTokens += metric.inputTokens;
        modelTableMap[name].outputTokens += metric.outputTokens;
        modelTableMap[name].totalTokens += metric.totalTokens;
        modelTableMap[name].calls += metric.stepCount || 1;
        modelTableMap[name].cost += metric.estimatedCostUsd;
      });
    } else {
      const name = s.detectedModelName || 'Unknown';
      if (!modelTableMap[name]) {
        modelTableMap[name] = { name, inputTokens: 0, outputTokens: 0, totalTokens: 0, calls: 0, cost: 0 };
      }
      modelTableMap[name].inputTokens += s.metrics.inputTokens;
      modelTableMap[name].outputTokens += s.metrics.outputTokens;
      modelTableMap[name].totalTokens += s.metrics.totalTokens;
      modelTableMap[name].calls += s.userMessageCount;
      modelTableMap[name].cost += s.metrics.estimatedCostUsd;
    }
  });

  const modelTableData = Object.values(modelTableMap).sort((a, b) => b.totalTokens - a.totalTokens);
  const totalChartSteps = modelTableData.reduce((acc, m) => acc + m.calls, 0);

  // Update Donut Center Text
  document.getElementById('donut-total-steps').innerText = formatNumber(totalChartSteps);

  // Render Table
  const tableBody = document.getElementById('table-body');
  if (modelTableData.length === 0) {
    tableBody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: #94a3b8; padding: 24px 0;">No data available for this period.</td></tr>`;
  } else {
    tableBody.innerHTML = modelTableData.map((m, idx) => `
      <tr>
        <td>
          <div class="model-badge">
            <div class="legend-color" style="background-color: ${COLORS[idx % COLORS.length]};"></div>
            <span>${m.name}</span>
          </div>
        </td>
        <td>${formatNumber(m.inputTokens)}</td>
        <td>${formatNumber(m.outputTokens)}</td>
        <td><strong>${formatNumber(m.totalTokens)}</strong></td>
        <td>${formatNumber(m.calls)}</td>
        <td class="table-cost">$${m.cost.toFixed(4)}</td>
      </tr>
    `).join('');
  }

  // Render Custom Legend
  const legendContainer = document.getElementById('custom-legend-container');
  if (modelTableData.length === 0) {
    legendContainer.innerHTML = `<div style="text-align: center; color: #94a3b8; padding: 16px 0;">No model usage in this period.</div>`;
  } else {
    legendContainer.innerHTML = modelTableData.map((m, idx) => {
      const percentage = totalChartSteps > 0 ? ((m.calls / totalChartSteps) * 100).toFixed(1) : '0';
      return `
        <div class="legend-item">
          <div class="legend-label">
            <div class="legend-color" style="background-color: ${COLORS[idx % COLORS.length]};"></div>
            <span>${m.name}</span>
          </div>
          <div class="legend-stats">
            <span style="color: #94a3b8;">${formatNumber(m.calls)}</span>
            <span style="color: #0f172a;">${percentage}%</span>
          </div>
        </div>
      `;
    }).join('');
  }

  // Render Charts
  updateActiveSessionUI(currentActiveSession, latestContextLimits);
  renderDonutChart(modelTableData);
}

function formatRelativeTime(timestamp) {
  if (!timestamp) return 'Just now';
  const diffSec = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${Math.floor(diffHours / 24)}d ago`;
}

function updateActiveSessionUI(currentSession, contextLimits) {
  if (!currentSession) {
    const titleEl = document.getElementById('active-session-title');
    if (titleEl) titleEl.innerText = 'No active conversation found';
    const idEl = document.getElementById('active-session-id');
    if (idEl) idEl.innerText = 'ID: --';
    const modelEl = document.getElementById('active-model-name');
    if (modelEl) modelEl.innerText = 'Idle';
    const tokensEl = document.getElementById('active-context-tokens');
    if (tokensEl) tokensEl.innerText = '0';
    const percentEl = document.getElementById('active-context-percent');
    if (percentEl) percentEl.innerText = '0% of context window';
    const fillEl = document.getElementById('active-progress-fill');
    if (fillEl) fillEl.style.width = '0%';
    const remEl = document.getElementById('active-context-remaining');
    if (remEl) remEl.innerText = 'Remaining runway: --';
    return;
  }

  const titleEl = document.getElementById('active-session-title');
  if (titleEl) titleEl.innerText = currentSession.title || 'Ongoing Conversation';

  const idEl = document.getElementById('active-session-id');
  if (idEl) idEl.innerText = `ID: ${currentSession.conversationId}`;

  const modelEl = document.getElementById('active-model-name');
  if (modelEl) modelEl.innerText = currentSession.detectedModelName || 'AI Model';

  const contextTokens = currentSession.metrics ? currentSession.metrics.totalTokens : 0;
  let maxLimit = 1_000_000;
  let limitLabel = '1M Context Window';

  if (contextLimits && currentSession.detectedModel && contextLimits[currentSession.detectedModel]) {
    maxLimit = contextLimits[currentSession.detectedModel].limit;
    limitLabel = contextLimits[currentSession.detectedModel].label;
  } else if (currentSession.detectedModel && currentSession.detectedModel.includes('claude')) {
    maxLimit = 200_000;
    limitLabel = '200K Context Window';
  }

  const percent = Math.min(100, Math.round((contextTokens / maxLimit) * 1000) / 10);
  const tokensEl = document.getElementById('active-context-tokens');
  if (tokensEl) tokensEl.innerText = formatNumber(contextTokens);

  const percentEl = document.getElementById('active-context-percent');
  if (percentEl) percentEl.innerText = `${percent}% of ${limitLabel}`;

  const fill = document.getElementById('active-progress-fill');
  if (fill) {
    fill.style.width = `${Math.max(1, percent)}%`;
    fill.classList.remove('warning', 'danger');

    const statusEl = document.getElementById('active-context-status');
    if (statusEl) statusEl.className = '';

    if (percent >= 80) {
      fill.classList.add('danger');
      if (statusEl) {
        statusEl.className = 'status-danger';
        statusEl.innerText = '⚠ High context load (Approaching compaction limit)';
      }
    } else if (percent >= 50) {
      fill.classList.add('warning');
      if (statusEl) {
        statusEl.className = 'status-warning';
        statusEl.innerText = '⚡ Moderate context usage';
      }
    } else {
      if (statusEl) {
        statusEl.className = 'status-optimal';
        statusEl.innerText = '● Optimal context efficiency';
      }
    }
  }

  const remaining = Math.max(0, maxLimit - contextTokens);
  const remEl = document.getElementById('active-context-remaining');
  if (remEl) remEl.innerText = `Runway: ${formatNumber(remaining)} tokens`;

  const inEl = document.getElementById('active-input-tokens');
  if (inEl && currentSession.metrics) inEl.innerText = formatNumber(currentSession.metrics.inputTokens);

  const outEl = document.getElementById('active-output-tokens');
  if (outEl && currentSession.metrics) outEl.innerText = formatNumber(currentSession.metrics.outputTokens);

  const stepEl = document.getElementById('active-step-count');
  if (stepEl) stepEl.innerText = `${formatNumber(currentSession.stepCount || currentSession.userMessageCount)} steps`;

  const costEl = document.getElementById('active-session-cost');
  if (costEl && currentSession.metrics) costEl.innerText = `$${currentSession.metrics.estimatedCostUsd.toFixed(4)}`;

  const timeEl = document.getElementById('active-last-updated');
  if (timeEl) timeEl.innerText = formatRelativeTime(currentSession.lastUpdated);
}

function renderDonutChart(modelTableData) {
  const donutCircle = document.getElementById('donut-circle');
  if (!donutCircle) return;

  const totalSteps = modelTableData.reduce((acc, m) => acc + m.calls, 0);

  if (modelTableData.length === 0 || totalSteps === 0) {
    donutCircle.style.background = 'conic-gradient(#cbd5e1 0% 100%)';
    return;
  }

  let currentPercent = 0;
  const stops = [];

  modelTableData.forEach((m, idx) => {
    const color = COLORS[idx % COLORS.length];
    const percentage = (m.calls / totalSteps) * 100;
    const start = currentPercent;
    currentPercent += percentage;
    stops.push(`${color} ${start.toFixed(2)}% ${currentPercent.toFixed(2)}%`);
  });

  donutCircle.style.background = `conic-gradient(${stops.join(', ')})`;
}

// Setup time filter event listeners & initial active state
document.querySelectorAll('.filter-btn').forEach((btn) => {
  if (btn.getAttribute('data-filter') === currentFilter) {
    btn.classList.add('active');
  } else {
    btn.classList.remove('active');
  }

  btn.addEventListener('click', (e) => {
    document.querySelectorAll('.filter-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    currentFilter = btn.getAttribute('data-filter') || 'all';
    localStorage.setItem('token_analytics_filter', currentFilter);
    updateUI();
  });
});

// Initial Load & Polling (Live Auto-Sync)
loadData();

// --- Settings Modal & Auto-Start Controller ---
const settingsModal = document.getElementById('settings-modal');
const btnOpenSettings = document.getElementById('btn-open-settings');
const btnCloseSettings = document.getElementById('btn-close-settings');
const btnDoneSettings = document.getElementById('btn-done-settings');
const toggleAutostart = document.getElementById('toggle-autostart');
const settingsStatusMsg = document.getElementById('settings-status-msg');

async function checkAutostartStatus() {
  if (window.__TAURI__) {
    const invoke = window.__TAURI__.core?.invoke || window.__TAURI__.invoke;
    if (invoke) {
      try {
        const isEnabled = await invoke('get_autostart_status');
        if (toggleAutostart) {
          toggleAutostart.checked = !!isEnabled;
        }
      } catch (err) {
        console.error('Failed to get autostart status:', err);
      }
    }
  }
}

function openSettingsModal() {
  if (!settingsModal) return;
  settingsModal.style.display = 'flex';
  if (settingsStatusMsg) settingsStatusMsg.textContent = '';
  checkAutostartStatus();
}

function closeSettingsModal() {
  if (!settingsModal) return;
  settingsModal.style.display = 'none';
}

if (btnOpenSettings) btnOpenSettings.addEventListener('click', openSettingsModal);
if (btnCloseSettings) btnCloseSettings.addEventListener('click', closeSettingsModal);
if (btnDoneSettings) btnDoneSettings.addEventListener('click', closeSettingsModal);

if (settingsModal) {
  settingsModal.addEventListener('click', (e) => {
    if (e.target === settingsModal) {
      closeSettingsModal();
    }
  });
}

if (toggleAutostart) {
  toggleAutostart.addEventListener('change', async (e) => {
    const enable = e.target.checked;
    if (settingsStatusMsg) {
      settingsStatusMsg.style.color = '#64748b';
      settingsStatusMsg.textContent = 'Updating...';
    }
    if (window.__TAURI__) {
      const invoke = window.__TAURI__.core?.invoke || window.__TAURI__.invoke;
      if (invoke) {
        try {
          const res = await invoke('set_autostart', { enable });
          toggleAutostart.checked = !!res;
          if (settingsStatusMsg) {
            settingsStatusMsg.style.color = '#10b981';
            settingsStatusMsg.textContent = res ? '✓ Auto-start enabled' : '✓ Auto-start disabled';
            setTimeout(() => {
              if (settingsStatusMsg) settingsStatusMsg.textContent = '';
            }, 3000);
          }
        } catch (err) {
          console.error('Failed to toggle autostart:', err);
          toggleAutostart.checked = !enable;
          if (settingsStatusMsg) {
            settingsStatusMsg.style.color = '#f43f5e';
            settingsStatusMsg.textContent = 'Failed to update registry';
          }
        }
      }
    }
  });
}

const btnOpenDataFolder = document.getElementById('btn-open-data-folder');
if (btnOpenDataFolder) {
  btnOpenDataFolder.addEventListener('click', async (e) => {
    e.preventDefault();
    if (window.__TAURI__) {
      const invoke = window.__TAURI__.core?.invoke || window.__TAURI__.invoke;
      if (invoke) {
        try {
          await invoke('open_data_folder');
        } catch (err) {
          console.error('Failed to open data folder:', err);
        }
      }
    }
  });
}



