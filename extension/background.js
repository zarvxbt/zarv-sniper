// Clicking the toolbar icon opens the dashboard in a real tab rather than a
// popup: a popup closes the moment it loses focus, which would kill a run
// mid-flight or cancel a scheduled fire.
chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL('app.html') });
});

// A "SNIPE" link from the site hands over a contract address. Only the two
// fields the dashboard reads are forwarded, and only ever to our own page.
chrome.runtime.onMessageExternal.addListener((msg, sender, respond) => {
  if (msg && msg.type === 'ZARV_SNIPE' && /^0x[a-fA-F0-9]{40}$/.test(msg.contract || '')) {
    const qty = Number(msg.quantity) > 0 ? Math.floor(Number(msg.quantity)) : 1;
    chrome.tabs.create({
      url: chrome.runtime.getURL('app.html') + '?contract=' + msg.contract + '&qty=' + qty,
    });
    respond({ ok: true });
  } else {
    respond({ ok: false });
  }
  return true;
});
