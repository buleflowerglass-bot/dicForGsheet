document.addEventListener('DOMContentLoaded', () => {
  const errorScreen = document.getElementById('errorScreen');
  const mainContent = document.getElementById('mainContent');
  
  const dictInput = document.getElementById('dictInput');
  const saveBtn = document.getElementById('saveBtn');
  const resetPosBtn = document.getElementById('resetPosBtn');
  const status = document.getElementById('status');
  const pluginEnabled = document.getElementById('pluginEnabled');
  const rowModeEnabled = document.getElementById('rowModeEnabled');
  const targetSheetsInput = document.getElementById('targetSheets');
  const targetColumnsInput = document.getElementById('targetColumns');
  const fontSizeSlider = document.getElementById('fontSizeSlider');
  const fontSizeValue = document.getElementById('fontSizeValue');

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const activeTab = tabs[0];
    
    let activeUrl;
    try {
      activeUrl = new URL(activeTab?.url);
    } catch {
      activeUrl = null;
    }

    if (!activeTab || activeUrl?.protocol !== 'https:' || activeUrl.hostname !== 'docs.google.com' || !activeUrl.pathname.startsWith('/spreadsheets/')) {
      errorScreen.style.display = 'block';
      return;
    }

    chrome.tabs.sendMessage(activeTab.id, { action: 'getState' }, (res) => {
      if (chrome.runtime.lastError || !res) {
        errorScreen.style.display = 'block';
        return;
      }

      mainContent.style.display = 'block';
      dictInput.value = res.rawInput || '';
      
      // 【核心改进】：严格读取本表格的开关状态。如果是新表格，强制设为 false（关闭）
      pluginEnabled.checked = res.isPluginEnabled === true; 
      rowModeEnabled.checked = !!res.isRowMode;
      targetSheetsInput.value = res.targetSheetsText || '';
      targetColumnsInput.value = res.targetColumnsText || '';

      // 读取已保存的字号并同步到滑块
      chrome.storage.local.get(['fontSize'], (r) => {
        const size = r.fontSize || 20;
        fontSizeSlider.value = size;
        fontSizeValue.textContent = size + 'px';
      });
      
      setupEventListeners(activeTab.id);
    });
  });

  function parseInputArray(str) {
    if (!str) return [];
    return str.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  }

  function setupEventListeners(tabId) {
    // 字号滑块：拖动时即时保存，悬浮窗通过 storage.onChanged 实时更新
    fontSizeSlider.addEventListener('input', () => {
      const size = parseInt(fontSizeSlider.value, 10);
      fontSizeValue.textContent = size + 'px';
      chrome.storage.local.set({ fontSize: size });
    });

    pluginEnabled.addEventListener('change', () => {
      chrome.tabs.sendMessage(tabId, { action: 'setState', payload: { isPluginEnabled: pluginEnabled.checked } });
    });
    rowModeEnabled.addEventListener('change', () => {
      chrome.tabs.sendMessage(tabId, { action: 'setState', payload: { isRowMode: rowModeEnabled.checked } });
    });

    resetPosBtn.addEventListener('click', () => {
      chrome.tabs.sendMessage(tabId, { action: 'resetPosition' }, () => {
        showStatus('🔄 窗口位置已重置！', '#ea4335');
      });
    });

    saveBtn.addEventListener('click', () => {
      const rawText = dictInput.value.trim();
      if (!rawText) { showStatus('❌ 词典内容不能为空！', 'red'); return; }

      let items = [];
      try {
        let cleaned = rawText.replace(/,\s*([\}\]])/g, '$1'); 
        try {
          let parsed = JSON.parse(cleaned);
          items = Array.isArray(parsed) ? parsed : [parsed];
        } catch {
          let fixed = cleaned.replace(/\}\s*\{/g, '},{');
          if (!fixed.trim().startsWith('[')) fixed = '[' + fixed + ']';
          let parsed = JSON.parse(fixed);
          items = Array.isArray(parsed) ? parsed : [parsed];
        }
      } catch (e) {
        showStatus('❌ JSON 格式错误，请检查！', 'red');
        return;
      }

      const ROW_FIELD_NAMES = ['行号', '行', 'row', 'line', 'rownumber'];
      const rowDicts = {};
      const globalDict = {};
      let autoRow = 1;
      let wordCount = 0;

      const reservedRows = new Set();
      items.forEach(obj => {
        if (typeof obj === 'object' && obj !== null) {
          for (let k in obj) {
            if (ROW_FIELD_NAMES.includes(k.toLowerCase().trim())) {
              const r = parseInt(obj[k], 10);
              if (!isNaN(r)) reservedRows.add(r);
            }
          }
        }
      });

      items.forEach(obj => {
        if (typeof obj !== 'object' || obj === null) return;
        let explicitRow = null;
        let rowKey = null;

        for (let k in obj) {
          if (ROW_FIELD_NAMES.includes(k.toLowerCase().trim())) {
            const r = parseInt(obj[k], 10);
            if (!isNaN(r)) { explicitRow = r; rowKey = k; break; }
          }
        }

        let targetRow = explicitRow !== null ? explicitRow : (() => {
          while (reservedRows.has(autoRow) || rowDicts[autoRow]) autoRow++;
          return autoRow++;
        })();

        if (!rowDicts[targetRow]) rowDicts[targetRow] = {};

        for (let k in obj) {
          if (k === rowKey) continue;
          if (typeof obj[k] === 'string') {
            const cleanKey = k.toLowerCase().trim().replace(/\s+/g, ' ');
            if (cleanKey && isNaN(cleanKey)) {
              rowDicts[targetRow][cleanKey] = obj[k];
              globalDict[cleanKey] = obj[k];
              wordCount++;
            }
          }
        }
      });

      if (wordCount === 0) { showStatus('⚠️ 未提取到词汇对！', 'orange'); return; }

      // 【核心改进】：保存词库时，自动帮用户开启“启用插件”开关
      pluginEnabled.checked = true;

      const payload = {
        globalDict,
        rowDicts,
        rawInput: rawText,
        isRowMode: rowModeEnabled.checked,
        isPluginEnabled: true, // 强制更新状态为已启用
        targetSheetsText: targetSheetsInput.value,
        targetColumnsText: targetColumnsInput.value,
        targetSheets: parseInputArray(targetSheetsInput.value),
        targetColumns: parseInputArray(targetColumnsInput.value)
      };

      chrome.tabs.sendMessage(tabId, { action: 'setState', payload: payload }, (response) => {
        if (chrome.runtime.lastError || response?.success !== true) {
          showStatus('❌ 保存失败，请刷新表格页面后重试。', 'red');
          return;
        }
        showStatus(`✅ 保存成功！当前表格已生效 (${wordCount}条)`, 'green');
      });
    });
  }

  function showStatus(text, color) {
    status.textContent = text;
    status.style.color = color;
    setTimeout(() => { if (status.textContent === text) status.textContent = ''; }, 3000);
  }
});
