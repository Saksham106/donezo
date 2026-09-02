from pathlib import Path

path = Path('src/app.js')
text = path.read_text()
old = """async function handleManualRefresh() {
  const coordinator = refreshCoordinator;
  if (!coordinator || manualRefreshLoading) return;
  manualRefreshLoading = true;
  renderPreservingScroll();
  const result = await coordinator.request('manual');
  if (coordinator !== refreshCoordinator) return;
  manualRefreshLoading = false;

  if (result.status === 'refreshed') notify('Synced just now');
  else if (result.status === 'failed') notify('Refresh flopped. Keeping your last good data.', 3600);
  else if (result.reason === 'offline') notify('Still offline. Showing your last sync.', 3200);
  else if (result.reason === 'busy') notify('Finish that action first, then refresh.', 2800);

  renderPreservingScroll();
}
"""
new = """function syncManualRefreshButton() {
  const refreshButton = app.querySelector('[data-manual-refresh]');
  if (!refreshButton) return;
  refreshButton.classList.toggle('loading', manualRefreshLoading);
  refreshButton.disabled = manualRefreshLoading;
}

async function handleManualRefresh() {
  const coordinator = refreshCoordinator;
  if (!coordinator || manualRefreshLoading) return;
  manualRefreshLoading = true;
  syncManualRefreshButton();
  const result = await coordinator.request('manual');
  if (coordinator !== refreshCoordinator) return;
  manualRefreshLoading = false;
  syncManualRefreshButton();

  if (result.status === 'refreshed') notify('Synced just now');
  else if (result.status === 'failed') notify('Refresh flopped. Keeping your last good data.', 3600);
  else if (result.reason === 'offline') notify('Still offline. Showing your last sync.', 3200);
  else if (result.reason === 'busy') notify('Finish that action first, then refresh.', 2800);
}
"""
if text.count(old) != 1:
    raise SystemExit(f'manual refresh block: expected 1 match, found {text.count(old)}')
path.write_text(text.replace(old, new, 1))
