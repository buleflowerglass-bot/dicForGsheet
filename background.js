const DOC_ID_PATTERN = /\/d\/([a-zA-Z0-9_-]+)/;
const MAX_STATE_BYTES = 9 * 1024 * 1024;

function getAuthorizedDocumentId(sender) {
  if (!sender.tab || !sender.url) return null;

  try {
    const url = new URL(sender.url);
    if (url.protocol !== 'https:' || url.hostname !== 'docs.google.com' || !url.pathname.startsWith('/spreadsheets/')) {
      return null;
    }
    return url.pathname.match(DOC_ID_PATTERN)?.[1] || 'default_doc';
  } catch {
    return null;
  }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (!request || typeof request !== 'object') return;
  if (request.action !== 'getDocState' && request.action !== 'setDocState') return;

  const docId = getAuthorizedDocumentId(sender);
  if (!docId) {
    sendResponse({ success: false });
    return;
  }

  const key = `serbian_ext_${docId}`;
  if (request.action === 'getDocState') {
    chrome.storage.session.get(key, (result) => {
      sendResponse({ success: true, state: result[key] || null });
    });
    return true;
  }

  let stateSize;
  try {
    stateSize = new TextEncoder().encode(JSON.stringify(request.state)).length;
  } catch {
    sendResponse({ success: false });
    return;
  }

  if (!request.state || typeof request.state !== 'object' || stateSize > MAX_STATE_BYTES) {
    sendResponse({ success: false });
    return;
  }

  chrome.storage.session.set({ [key]: request.state }, () => {
    sendResponse({ success: !chrome.runtime.lastError });
  });
  return true;
});
