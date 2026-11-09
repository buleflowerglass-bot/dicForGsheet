// =============== 核心隔离逻辑：获取当前表格的唯一 ID ===============
function getDocId() {
  const match = window.location.pathname.match(/\/d\/([a-zA-Z0-9-_]+)/);
  return match ? match[1] : 'default_doc';
}

function getDefaultState() {
  return {
    globalDict: {}, rowDicts: {}, rawInput: '',
    isRowMode: false, isPluginEnabled: false, // 所有新开文档默认全部关闭，绝不打扰
    targetSheetsText: '', targetColumnsText: '',
    targetSheets: [], targetColumns: []
  };
}

function sanitizeDictionary(value) {
  const safeDictionary = Object.create(null);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return safeDictionary;
  for (const [key, translation] of Object.entries(value)) {
    if (typeof translation === 'string') safeDictionary[key] = translation;
  }
  return safeDictionary;
}

function sanitizeState(value) {
  const defaults = getDefaultState();
  if (!value || typeof value !== 'object' || Array.isArray(value)) return defaults;

  const rowDicts = Object.create(null);
  if (value.rowDicts && typeof value.rowDicts === 'object' && !Array.isArray(value.rowDicts)) {
    for (const [row, dictionary] of Object.entries(value.rowDicts)) {
      rowDicts[row] = sanitizeDictionary(dictionary);
    }
  }

  return {
    globalDict: sanitizeDictionary(value.globalDict),
    rowDicts,
    rawInput: typeof value.rawInput === 'string' ? value.rawInput : '',
    isRowMode: value.isRowMode === true,
    isPluginEnabled: value.isPluginEnabled === true,
    targetSheetsText: typeof value.targetSheetsText === 'string' ? value.targetSheetsText : '',
    targetColumnsText: typeof value.targetColumnsText === 'string' ? value.targetColumnsText : '',
    targetSheets: Array.isArray(value.targetSheets) ? value.targetSheets.filter(item => typeof item === 'string') : [],
    targetColumns: Array.isArray(value.targetColumns) ? value.targetColumns.filter(item => typeof item === 'string') : []
  };
}

let currentDocId = getDocId();
let fullState = getDefaultState();
let lastText = null;
let lastRow = null;

// ================== 1. 修复：先创建面板元素 ==================
const panel = document.createElement('div');
panel.id = 'serbian-ruby-panel';
const header = document.createElement('div');
header.id = 'serbian-panel-header';
const panelTitle = document.createElement('span');
panelTitle.id = 'serbian-panel-title';
panelTitle.style.pointerEvents = 'none';
panelTitle.textContent = '🇷🇸 塞尔维亚语翻译层';
const headerButtons = document.createElement('span');
headerButtons.id = 'serbian-header-btns';
[
  ['serbian-font-minus', '缩小字号', 'A−'],
  ['serbian-font-plus', '放大字号', 'A+'],
  ['serbian-close-btn', '暂时隐藏', '✖']
].forEach(([id, title, label]) => {
  const button = document.createElement('span');
  button.id = id;
  button.className = 'serbian-hdr-btn';
  button.title = title;
  button.textContent = label;
  headerButtons.appendChild(button);
});
header.append(panelTitle, headerButtons);
const content = document.createElement('div');
content.id = 'serbian-panel-content';
panel.appendChild(header);
panel.appendChild(content);
document.body.appendChild(panel);

// ================== 2. 读取和保存状态逻辑 ==================
function loadState() {
  currentDocId = getDocId();
  const docId = currentDocId;
  stateLoadPromise = new Promise((resolve) => {
    chrome.runtime.sendMessage({ action: 'getDocState' }, (response) => {
      if (currentDocId === docId) {
        if (response?.state && typeof response.state === 'object') {
          fullState = sanitizeState(response.state);
        } else {
          const legacyKey = `serbian_ext_${docId}`;
          let legacyState = null;
          try {
            const legacyData = sessionStorage.getItem(legacyKey);
            if (legacyData) legacyState = sanitizeState(JSON.parse(legacyData));
          } catch {
            legacyState = null;
          }

          if (legacyState) {
            fullState = legacyState;
            chrome.runtime.sendMessage({ action: 'setDocState', state: legacyState }, (saveResponse) => {
              if (currentDocId === docId && saveResponse?.success === true) {
                fullState = legacyState;
                sessionStorage.removeItem(legacyKey);
                if (!fullState.isPluginEnabled) panel.style.display = 'none';
                lastText = null;
              }
            });
          } else {
            fullState = getDefaultState();
          }
        }
        if (!fullState.isPluginEnabled) panel.style.display = 'none';
        lastText = null;
      }
      resolve();
    });
  });
}

let stateLoadPromise = Promise.resolve();

function saveState(callback) {
  chrome.runtime.sendMessage({ action: 'setDocState', state: fullState }, (response) => {
    if (callback) callback(response);
  });
}

loadState(); // 初始化加载当前状态

// ================== 字号调整 ==================
const FONT_MIN = 12, FONT_MAX = 48, FONT_DEFAULT = 20;
let currentFontSize = FONT_DEFAULT;

function applyFontSize(size) {
  size = Math.max(FONT_MIN, Math.min(FONT_MAX, Number(size) || FONT_DEFAULT));
  currentFontSize = size;
  panel.style.setProperty('--serbian-font-size', size + 'px');
}

// 读取已保存的字号
chrome.storage.local.get(['fontSize'], (res) => {
  applyFontSize(res.fontSize || FONT_DEFAULT);
});

// 弹窗滑块或其他页面修改后，实时同步
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.fontSize) applyFontSize(changes.fontSize.newValue);
});

function changeFont(delta) {
  const newSize = Math.max(FONT_MIN, Math.min(FONT_MAX, currentFontSize + delta));
  applyFontSize(newSize);
  chrome.storage.local.set({ fontSize: newSize });
}
document.getElementById('serbian-font-minus').addEventListener('click', () => changeFont(-2));
document.getElementById('serbian-font-plus').addEventListener('click', () => changeFont(2));

// ================== 3. 监听来自弹出窗口的指令 ==================
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getState') {
    stateLoadPromise.then(() => sendResponse(fullState));
    return true;
  } else if (request.action === 'setState') {
    fullState = { ...fullState, ...request.payload };
    if (!fullState.isPluginEnabled) panel.style.display = 'none';
    lastText = null; 
    saveState((response) => sendResponse({ success: response?.success === true }));
    return true;
  } else if (request.action === 'resetPosition') {
    chrome.storage.local.remove('panelState', () => {
      panel.style.left = '50px'; panel.style.top = '50px';
      panel.style.width = '350px'; panel.style.height = '200px';
      savePanelState();
      sendResponse({ success: true });
    });
    return true; 
  }
});

// ================== 4. 记忆位置与防走失 ==================
chrome.storage.local.get(['panelState'], (result) => {
  if (result.panelState) {
    const s = result.panelState;
    const maxLeft = window.innerWidth - 150;
    const maxTop = window.innerHeight - 80;
    let safeLeft = Math.max(0, Math.min(s.left, maxLeft));
    let safeTop = Math.max(0, Math.min(s.top, maxTop));
    panel.style.left = safeLeft + 'px'; panel.style.top = safeTop + 'px';
    panel.style.width = s.width + 'px'; panel.style.height = s.height + 'px';
    panel.style.right = 'auto'; 
  }
});

let saveTimeout;
function savePanelState() {
  if (panel.style.display === 'none') return;
  clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    const rect = panel.getBoundingClientRect();
    chrome.storage.local.set({ panelState: { left: rect.left, top: rect.top, width: rect.width, height: rect.height } });
  }, 500);
}
const resizeObserver = new ResizeObserver(() => savePanelState());
resizeObserver.observe(panel);

// ================== 5. 拖拽与关闭 ==================
let isDragging = false, startX, startY, initialLeft, initialTop;
header.addEventListener('mousedown', (e) => {
  if (e.target.closest('.serbian-hdr-btn')) return; // 点击标题栏按钮时不触发拖动
  isDragging = true; startX = e.clientX; startY = e.clientY;
  const rect = panel.getBoundingClientRect();
  initialLeft = rect.left; initialTop = rect.top;
  panel.style.right = 'auto'; document.body.style.userSelect = 'none'; 
});
document.addEventListener('mousemove', (e) => {
  if (!isDragging) return;
  panel.style.left = `${initialLeft + (e.clientX - startX)}px`;
  panel.style.top = `${initialTop + (e.clientY - startY)}px`;
});
document.addEventListener('mouseup', () => {
  if (isDragging) { isDragging = false; document.body.style.userSelect = ''; savePanelState(); }
});
let isTemporarilyClosed = false;
document.getElementById('serbian-close-btn').addEventListener('click', () => {
  panel.style.display = 'none';
  isTemporarilyClosed = true;
});

// ================== 6. 表格识别与渲染逻辑 ==================
function getActiveCellInfo() {
  const info = { sheetName: '', column: '', row: null };
  const activeSheetEl = document.querySelector('.docs-sheet-active-tab .docs-sheet-tab-name');
  if (activeSheetEl) info.sheetName = activeSheetEl.textContent.trim().toLowerCase();
  const nameBox = document.getElementById('t-name-box');
  if (nameBox && nameBox.value) {
    const match = nameBox.value.match(/([A-Za-z]+)(\d+)/);
    if (match) { info.column = match[1].toLowerCase(); info.row = parseInt(match[2], 10); }
  }
  return info;
}

setInterval(() => {
  // 如果你在同一个网页里点击链接跳转到了另一个表格文档，自动识别并切换独立记忆
  if (getDocId() !== currentDocId) {
    loadState();
  }

  // 如果当前表格配置为关闭，立刻停止工作，绝对不打扰
  if (!fullState.isPluginEnabled) {
    panel.style.display = 'none';
    return;
  }

  const formulaBar = document.getElementById('t-formula-bar-input');
  if (!formulaBar) return;

  const cellInfo = getActiveCellInfo();
  
  const isSheetAllowed = fullState.targetSheets.length === 0 || fullState.targetSheets.includes(cellInfo.sheetName);
  const isColumnAllowed = fullState.targetColumns.length === 0 || fullState.targetColumns.includes(cellInfo.column);

  if (!isSheetAllowed || !isColumnAllowed) {
    panel.style.display = 'none';
    lastText = null; lastRow = null;
    return;
  }

  let currentText = formulaBar.innerText.trim().replace(/[\u200B-\u200D\uFEFF]/g, '');

  if (currentText !== lastText || (fullState.isRowMode && cellInfo.row !== lastRow)) {
    lastText = currentText;
    lastRow = cellInfo.row;
    isTemporarilyClosed = false;
    updatePanel(currentText, cellInfo.row);
  }
}, 200);

function escapeRegExp(string) { return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function updatePanel(text, rowNum) {
  if (!text || isTemporarilyClosed) { panel.style.display = 'none'; return; }

  let activeDict = fullState.globalDict;
  const titleSpan = document.getElementById('serbian-panel-title');

  if (fullState.isRowMode) {
    titleSpan.textContent = rowNum ? `🇷🇸 翻译层 (第 ${rowNum} 行)` : `🇷🇸 翻译层 (行号未知)`;
    activeDict = (rowNum && fullState.rowDicts[rowNum]) ? fullState.rowDicts[rowNum] : {};
  } else {
    titleSpan.textContent = '🇷🇸 塞尔维亚语翻译层';
  }

  const keys = Object.keys(activeDict).filter(k => k.trim().length > 0);
  if (keys.length === 0) {
    content.textContent = text;
    panel.style.display = 'flex'; return;
  }

  keys.sort((a, b) => b.length - a.length);

  const patternParts = keys.map(k => {
    const escaped = escapeRegExp(k.trim()).replace(/\s+/g, '\\s+');
    return `(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`;
  });
  const combinedRegex = new RegExp(`(${patternParts.join('|')})`, 'giu');

  const rendered = document.createDocumentFragment();
  let lastIndex = 0;
  let match;

  while ((match = combinedRegex.exec(text)) !== null) {
    if (match.index > lastIndex) rendered.appendChild(document.createTextNode(text.substring(lastIndex, match.index)));
    const matchedText = match[0];
    const translation = activeDict[matchedText.toLowerCase().replace(/\s+/g, ' ')];

    if (translation) {
      const ruby = document.createElement('ruby');
      const annotation = document.createElement('rt');
      ruby.appendChild(document.createTextNode(matchedText));
      annotation.textContent = translation;
      ruby.appendChild(annotation);
      rendered.appendChild(ruby);
    } else {
      rendered.appendChild(document.createTextNode(matchedText));
    }
    lastIndex = combinedRegex.lastIndex;
  }
  if (lastIndex < text.length) rendered.appendChild(document.createTextNode(text.substring(lastIndex)));

  content.replaceChildren(rendered);
  panel.style.display = 'flex'; 
}
