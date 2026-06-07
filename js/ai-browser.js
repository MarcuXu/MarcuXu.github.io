(function () {
  'use strict';

  var config = window.AI_BROWSER_CONFIG || {};
  var endpoint = config.endpoint || '';
  var configEndpoint = config.configEndpoint || '';
  var runtimeConfig = {
    publicAccess: false,
    requireAccessToken: true,
    turnstileEnabled: false,
    requireTurnstile: false,
    turnstileSiteKey: '',
    maxQueryChars: 2000,
    maxHistoryTurns: 8,
    historyMessageChars: 2200,
    requestTimeoutMs: 180000
  };

  var tokenStorageKey = 'marcuxu.iias.accessToken';
  var sessionStorageKey = 'marcuxu.iias.session';
  var messages = [];
  var latestAnswer = '';
  var latestCitations = [];
  var turnstileWidgetId = null;
  var turnstileToken = '';

  var statusBox = document.querySelector('.ai-browser-status');
  var statusText = document.getElementById('aiBrowserStatusText');
  var tokenField = document.getElementById('aiBrowserTokenField');
  var tokenInput = document.getElementById('aiBrowserToken');
  var saveTokenButton = document.getElementById('aiBrowserSaveToken');
  var clearButton = document.getElementById('aiBrowserClear');
  var newSessionButton = document.getElementById('aiBrowserNewSession');
  var form = document.getElementById('aiBrowserForm');
  var queryInput = document.getElementById('aiBrowserQuery');
  var modeInput = document.getElementById('aiBrowserMode');
  var depthInput = document.getElementById('aiBrowserDepth');
  var citationsInput = document.getElementById('aiBrowserCitations');
  var submitButton = document.getElementById('aiBrowserSubmit');
  var messagesBox = document.getElementById('aiBrowserMessages');
  var citationsBox = document.getElementById('aiBrowserCitationsList');
  var copyButton = document.getElementById('aiBrowserCopy');
  var turnstileBox = document.getElementById('aiBrowserTurnstile');
  var turnCount = document.getElementById('aiBrowserTurnCount');
  var sourceCount = document.getElementById('aiBrowserSourceCount');

  function fetchWithTimeout(url, options, timeoutMs) {
    var controller = window.AbortController ? new AbortController() : null;
    var timer = null;
    var requestOptions = Object.assign({}, options || {});

    if (controller) {
      requestOptions.signal = controller.signal;
      timer = window.setTimeout(function () {
        controller.abort();
      }, timeoutMs || runtimeConfig.requestTimeoutMs || 180000);
    }

    return fetch(url, requestOptions).finally(function () {
      if (timer) {
        window.clearTimeout(timer);
      }
    });
  }

  function getNetworkErrorMessage(error) {
    if (error && error.name === 'AbortError') {
      return '请求超时。请稍后重试；如问题较复杂，请在 Worker 中让 AI_BROWSER_CLIENT_TIMEOUT_MS 明显大于 OPENAI_TIMEOUT_MS。';
    }
    if (error && /failed to fetch|networkerror/i.test(error.message || '')) {
      return '网络请求未能完成。当前部署的 CORS 配置通常可用；若长时间等待后出现此提示，多数情况是浏览器或上游代理中断了请求。请刷新页面、确认 Worker 已部署最新脚本，并检查 AI_BROWSER_CLIENT_TIMEOUT_MS 是否大于 OPENAI_TIMEOUT_MS。';
    }
    return (error && error.message) || '请求失败。';
  }

  function setStatus(text, status) {
    if (statusText) {
      statusText.textContent = text;
    }
    if (statusBox) {
      statusBox.setAttribute('data-status', status || 'idle');
    }
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function getSafeHttpUrl(value) {
    if (!value) {
      return '';
    }
    try {
      var parsed = new URL(value);
      if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
        return parsed.href;
      }
    } catch (error) {
      return '';
    }
    return '';
  }

  function getDisplayDomain(url) {
    try {
      var parsed = new URL(url);
      return parsed.hostname.replace(/^www\./i, '') || url;
    } catch (error) {
      return url;
    }
  }

  function renderBasicInline(value) {
    return escapeHtml(value || '').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  }

  function buildAnswerLink(url, label) {
    var safeUrl = getSafeHttpUrl(url);
    if (!safeUrl) {
      return renderBasicInline(label || url);
    }
    var display = (label || getDisplayDomain(safeUrl)).trim() || getDisplayDomain(safeUrl);
    return '<a class="ai-browser-answer-link" href="' + escapeHtml(safeUrl) +
      '" target="_blank" rel="noopener noreferrer">' + renderBasicInline(display) + '</a>';
  }

  function addCitationCandidate(result, seen, title, url) {
    var safeUrl = getSafeHttpUrl(url);
    if (!safeUrl || seen[safeUrl]) {
      return;
    }
    seen[safeUrl] = true;
    result.push({
      title: (title || getDisplayDomain(safeUrl)).trim() || getDisplayDomain(safeUrl),
      url: safeUrl
    });
  }

  function extractCitationsFromText(text) {
    var source = String(text || '');
    var result = [];
    var seen = {};
    var markdownLinkPattern = /\[([^\]\n]{1,160})\]\((https?:\/\/[^\s)]+)\)/gi;
    var bareUrlPattern = /https?:\/\/[^\s<>()]+/gi;
    var withoutMarkdown = source;
    var match;

    while ((match = markdownLinkPattern.exec(source)) !== null) {
      addCitationCandidate(result, seen, match[1], match[2]);
    }

    withoutMarkdown = withoutMarkdown.replace(markdownLinkPattern, ' ');
    while ((match = bareUrlPattern.exec(withoutMarkdown)) !== null) {
      var rawUrl = match[0];
      while (/[.,;:!?，。；：！？）\]]$/.test(rawUrl)) {
        rawUrl = rawUrl.slice(0, -1);
      }
      addCitationCandidate(result, seen, getDisplayDomain(rawUrl), rawUrl);
    }

    return result;
  }

  function normalizeCitations(citations, answerText) {
    var result = [];
    var seen = {};
    (citations || []).forEach(function (citation) {
      if (citation) {
        addCitationCandidate(result, seen, citation.title || citation.url, citation.url);
      }
    });
    extractCitationsFromText(answerText).forEach(function (citation) {
      addCitationCandidate(result, seen, citation.title, citation.url);
    });
    return result;
  }

  function renderBareLinks(value) {
    var source = String(value || '');
    var urlPattern = /https?:\/\/[^\s<>()]+/gi;
    var result = '';
    var lastIndex = 0;
    var match;

    while ((match = urlPattern.exec(source)) !== null) {
      var rawUrl = match[0];
      var trailing = '';
      while (/[.,;:!?，。；：！？）\]]$/.test(rawUrl)) {
        trailing = rawUrl.slice(-1) + trailing;
        rawUrl = rawUrl.slice(0, -1);
      }

      result += renderBasicInline(source.slice(lastIndex, match.index));
      result += buildAnswerLink(rawUrl, getDisplayDomain(rawUrl));
      result += renderBasicInline(trailing);
      lastIndex = match.index + match[0].length;
    }

    result += renderBasicInline(source.slice(lastIndex));
    return result;
  }

  function textToHtml(text) {
    var source = String(text || '');
    var markdownLinkPattern = /\[([^\]\n]{1,160})\]\((https?:\/\/[^\s)]+)\)/gi;
    var result = '';
    var lastIndex = 0;
    var match;

    while ((match = markdownLinkPattern.exec(source)) !== null) {
      result += renderBareLinks(source.slice(lastIndex, match.index));
      result += buildAnswerLink(match[2], match[1]);
      lastIndex = match.index + match[0].length;
    }

    result += renderBareLinks(source.slice(lastIndex));
    return result.replace(/\n/g, '<br>');
  }

  function renderMessages() {
    if (!messagesBox) {
      return;
    }

    if (!messages.length) {
      messagesBox.innerHTML = [
        '<article class="ai-browser-message ai-browser-message-system">',
        '<div class="ai-browser-message-icon"><i class="fas fa-compass"></i></div>',
        '<div><h2>开始分析</h2>',
        '<p>输入需要研判的问题。后续追问将自动结合最近的会话上下文。</p></div>',
        '</article>'
      ].join('');
      updateMetrics();
      return;
    }

    messagesBox.innerHTML = messages.map(function (message) {
      var icon = message.role === 'user' ? 'fas fa-user' : 'fas fa-brain';
      var roleClass = message.role === 'user' ? 'ai-browser-message-user' : 'ai-browser-message-assistant';
      if (message.isError) {
        roleClass += ' ai-browser-message-error';
      }
      if (message.pending) {
        roleClass += ' ai-browser-message-pending';
      }
      var title = message.role === 'user' ? '问题' : '分析结果';
      return [
        '<article class="ai-browser-message ' + roleClass + '">',
        '<div class="ai-browser-message-icon"><i class="' + icon + '"></i></div>',
        '<div class="ai-browser-message-content">',
        '<h2>' + title + '</h2>',
        '<p>' + textToHtml(message.content) + '</p>',
        '</div>',
        '</article>'
      ].join('');
    }).join('');
    messagesBox.scrollTop = messagesBox.scrollHeight;
    updateMetrics();
  }

  function renderCitations(citations, answerText) {
    if (!citationsBox) {
      return;
    }
    latestCitations = normalizeCitations(citations, answerText || '');
    if (citationsInput && !citationsInput.checked) {
      citationsBox.innerHTML = '<p class="ai-browser-muted">来源显示已关闭。</p>';
      updateMetrics();
      return;
    }
    if (!latestCitations.length) {
      citationsBox.innerHTML = '<p class="ai-browser-muted">最新回答未返回可展示的来源链接。</p>';
      updateMetrics();
      return;
    }

    citationsBox.innerHTML = latestCitations.map(function (citation, index) {
      var title = citation.title || citation.url || ('来源 ' + (index + 1));
      var url = getSafeHttpUrl(citation.url);
      var label = escapeHtml(index + 1 + '. ' + title);
      if (!url) {
        return '<span class="ai-browser-citation">' + label + '</span>';
      }
      return '<a class="ai-browser-citation" href="' + escapeHtml(url) + '" target="_blank" rel="noopener noreferrer">' +
        '<i class="fas fa-external-link-alt"></i><span>' + label + '</span></a>';
    }).join('');
    updateMetrics();
  }

  function updateMetrics() {
    if (turnCount) {
      turnCount.textContent = String(messages.filter(function (message) {
        return message.role === 'user';
      }).length);
    }
    if (sourceCount) {
      sourceCount.textContent = String(latestCitations.length);
    }
  }

  function saveSession() {
    var historyLimit = Math.max(2, Number(runtimeConfig.maxHistoryTurns || 8) * 2);
    window.sessionStorage.setItem(sessionStorageKey, JSON.stringify(messages.slice(-historyLimit)));
  }

  function getHistoryLimit() {
    return Math.max(2, Number(runtimeConfig.maxHistoryTurns || 8) * 2);
  }

  function getHistoryMessageChars() {
    return Math.max(500, Number(runtimeConfig.historyMessageChars || 2200));
  }

  function getOutgoingMessages() {
    var maxChars = getHistoryMessageChars();
    return messages.slice(-getHistoryLimit()).map(function (message) {
      return {
        role: message.role,
        content: String(message.content || '').slice(0, maxChars)
      };
    }).filter(function (message) {
      return message.content && (message.role === 'user' || message.role === 'assistant');
    });
  }

  function loadSession() {
    try {
      var saved = JSON.parse(window.sessionStorage.getItem(sessionStorageKey) || '[]');
      if (Array.isArray(saved)) {
        messages = saved.filter(function (message) {
          return message && (message.role === 'user' || message.role === 'assistant') && typeof message.content === 'string';
        }).slice(-16);
      }
    } catch (error) {
      messages = [];
    }
    latestAnswer = messages.length ? messages[messages.length - 1].content : '';
    renderMessages();
  }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var existing = document.querySelector('script[src="' + src + '"]');
      if (existing) {
        if (window.turnstile) {
          resolve();
          return;
        }
        existing.addEventListener('load', resolve, { once: true });
        existing.addEventListener('error', reject, { once: true });
        return;
      }
      var script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.defer = true;
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  function waitForTurnstile() {
    return new Promise(function (resolve, reject) {
      var attempts = 0;
      var interval = window.setInterval(function () {
        attempts += 1;
        if (window.turnstile) {
          window.clearInterval(interval);
          resolve(window.turnstile);
        } else if (attempts > 50) {
          window.clearInterval(interval);
          reject(new Error('人机验证组件未能加载。'));
        }
      }, 100);
    });
  }

  async function setupTurnstile() {
    if (!runtimeConfig.requireTurnstile || !runtimeConfig.turnstileEnabled || !runtimeConfig.turnstileSiteKey || !turnstileBox) {
      return;
    }

    try {
      await loadScript('https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit');
      var turnstile = await waitForTurnstile();
      turnstileWidgetId = turnstile.render(turnstileBox, {
        sitekey: runtimeConfig.turnstileSiteKey,
        theme: 'light',
        callback: function (token) {
          turnstileToken = token;
          setStatus('已验证', 'idle');
        },
        'expired-callback': function () {
          turnstileToken = '';
          setStatus('验证已过期', 'error');
        },
        'error-callback': function () {
          turnstileToken = '';
          setStatus('已跳过验证', 'idle');
        }
      });
    } catch (error) {
      setStatus('已跳过验证', 'idle');
    }
  }

  function resetTurnstile() {
    if (window.turnstile && turnstileWidgetId !== null) {
      window.turnstile.reset(turnstileWidgetId);
      turnstileToken = '';
    }
  }

  function applyRuntimeConfig(data) {
    runtimeConfig.publicAccess = Boolean(data.publicAccess);
    runtimeConfig.requireAccessToken = data.hasOwnProperty('requireAccessToken') ? Boolean(data.requireAccessToken) : true;
    runtimeConfig.turnstileEnabled = Boolean(data.turnstileEnabled);
    runtimeConfig.requireTurnstile = data.hasOwnProperty('requireTurnstile') ? Boolean(data.requireTurnstile) : false;
    runtimeConfig.turnstileSiteKey = data.turnstileSiteKey || '';
    runtimeConfig.maxQueryChars = Number(data.maxQueryChars || runtimeConfig.maxQueryChars);
    runtimeConfig.maxHistoryTurns = Number(data.maxHistoryTurns || runtimeConfig.maxHistoryTurns);
    runtimeConfig.historyMessageChars = Number(data.historyMessageChars || runtimeConfig.historyMessageChars);
    runtimeConfig.requestTimeoutMs = Number(data.requestTimeoutMs || runtimeConfig.requestTimeoutMs);

    if (tokenField) {
      tokenField.classList.toggle('ai-browser-is-hidden', !runtimeConfig.requireAccessToken);
    }
    if (turnstileBox) {
      turnstileBox.classList.toggle('ai-browser-is-hidden', !runtimeConfig.requireTurnstile);
    }
  }

  async function loadRuntimeConfig() {
    if (!configEndpoint) {
      return;
    }

    try {
      var response = await fetchWithTimeout(configEndpoint, {
        method: 'GET',
        cache: 'no-store',
        mode: 'cors'
      }, 12000);
      if (!response.ok) {
        throw new Error('配置请求失败。');
      }
      var data = await response.json();
      applyRuntimeConfig(data);
      await setupTurnstile();
    } catch (error) {
      setStatus('使用默认配置', 'idle');
    }
  }

  function getToken() {
    return (tokenInput && tokenInput.value.trim()) || window.sessionStorage.getItem(tokenStorageKey) || '';
  }

  function saveToken() {
    var token = tokenInput ? tokenInput.value.trim() : '';
    if (token) {
      window.sessionStorage.setItem(tokenStorageKey, token);
      setStatus('口令已保存', 'idle');
    } else {
      window.sessionStorage.removeItem(tokenStorageKey);
      setStatus('口令已清除', 'idle');
    }
  }

  function buildPayload() {
    return {
      query: queryInput.value.trim(),
      messages: getOutgoingMessages(),
      mode: modeInput.value,
      depth: Number(depthInput.value || 2),
      citations: Boolean(citationsInput.checked),
      turnstileToken: turnstileToken
    };
  }

  async function submitQuery(event) {
    event.preventDefault();

    var token = getToken();
    var payload = buildPayload();

    if (!endpoint) {
      addAssistantMessage('分析接口尚未配置。', true);
      setStatus('配置错误', 'error');
      return;
    }

    if (runtimeConfig.requireAccessToken && !token) {
      addAssistantMessage('提交问题前，请先输入访问口令。', true);
      setStatus('需要访问口令', 'error');
      return;
    }

    if (runtimeConfig.requireTurnstile && !turnstileToken) {
      addAssistantMessage('提交问题前，请先完成人机验证。', true);
      setStatus('需要人机验证', 'error');
      return;
    }

    if (!payload.query) {
      addAssistantMessage('请先输入问题，再开始分析。', true);
      setStatus('需要输入问题', 'error');
      return;
    }

    if (payload.query.length > runtimeConfig.maxQueryChars) {
      addAssistantMessage('问题内容过长，已超出当前接口限制。', true);
      setStatus('问题过长', 'error');
      return;
    }

    messages.push({ role: 'user', content: payload.query });
    renderMessages();
    saveSession();
    queryInput.value = '';

    setStatus('分析中', 'loading');
    submitButton.disabled = true;
    addAssistantMessage('正在结合联网证据与最近会话上下文进行分析...', false, true);
    renderCitations([], '');

    try {
      var requestHeaders = {
        'Content-Type': 'application/json'
      };
      if (token) {
        requestHeaders.Authorization = 'Bearer ' + token;
      }

      var response = await fetchWithTimeout(endpoint, {
        method: 'POST',
        headers: requestHeaders,
        body: JSON.stringify(payload),
        cache: 'no-store',
        mode: 'cors'
      }, runtimeConfig.requestTimeoutMs);

      var data = await response.json().catch(function () {
        return {};
      });

      if (!response.ok) {
        throw new Error(data.error || ('请求失败，状态码：' + response.status));
      }

      replacePendingAssistant(data.answer || '接口未返回可展示的回答。');
      latestAnswer = data.answer || '';
      renderCitations(data.citations || [], latestAnswer);
      saveSession();
      setStatus('已完成', 'idle');
      resetTurnstile();
    } catch (error) {
      replacePendingAssistant(getNetworkErrorMessage(error), true);
      renderCitations([], '');
      saveSession();
      setStatus('出错', 'error');
      resetTurnstile();
    } finally {
      submitButton.disabled = false;
    }
  }

  function addAssistantMessage(text, isError, pending) {
    messages.push({
      role: 'assistant',
      content: text,
      isError: Boolean(isError),
      pending: Boolean(pending)
    });
    renderMessages();
  }

  function replacePendingAssistant(text, isError) {
    for (var i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i].role === 'assistant' && messages[i].pending) {
        messages[i] = {
          role: 'assistant',
          content: text,
          isError: Boolean(isError)
        };
        latestAnswer = text;
        renderMessages();
        return;
      }
    }
    addAssistantMessage(text, isError);
  }

  function clearSession() {
    messages = [];
    latestAnswer = '';
    latestCitations = [];
    window.sessionStorage.removeItem(sessionStorageKey);
    if (queryInput) {
      queryInput.value = '';
    }
    renderMessages();
    renderCitations([], '');
    setStatus('就绪', 'idle');
  }

  function clearAll() {
    clearSession();
    window.sessionStorage.removeItem(tokenStorageKey);
    if (tokenInput) {
      tokenInput.value = '';
    }
  }

  function copyAnswer() {
    var text = latestAnswer || '';
    if (!text || !window.navigator.clipboard) {
      return;
    }
    window.navigator.clipboard.writeText(text).then(function () {
      setStatus('已复制', 'idle');
    });
  }

  if (tokenInput) {
    tokenInput.value = window.sessionStorage.getItem(tokenStorageKey) || '';
  }
  if (saveTokenButton) {
    saveTokenButton.addEventListener('click', saveToken);
  }
  if (clearButton) {
    clearButton.addEventListener('click', clearAll);
  }
  if (newSessionButton) {
    newSessionButton.addEventListener('click', clearSession);
  }
  if (form) {
    form.addEventListener('submit', submitQuery);
  }
  if (copyButton) {
    copyButton.addEventListener('click', copyAnswer);
  }
  if (citationsInput) {
    citationsInput.addEventListener('change', function () {
      renderCitations(latestCitations, latestAnswer);
    });
  }

  loadSession();
  loadRuntimeConfig();
}());
