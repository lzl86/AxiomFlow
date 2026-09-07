/**
 * AxiomFlow Zero-Build Explorable Tracer Runtime (微步进探索沙盒运行时底座)
 * 
 * 核心契约：
 * 对外暴露工厂函数 createSteppedTracer(config)，返回标准的 mountTracer(container, options) 挂载函数。
 * 纯原生 ES Module 规范，零构建、零第三方打包依赖。
 */

let runtimeStylesInjected = false;

function injectRuntimeStyles() {
  if (runtimeStylesInjected) return;
  runtimeStylesInjected = true;

  const style = document.createElement('style');
  style.id = 'tracer-runtime-styles';
  style.textContent = `
    .tr-root {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      color: var(--text-primary, #f1f5f9);
      background: transparent;
      line-height: 1.45;
      display: flex;
      flex-direction: column;
      gap: 12px;
      user-select: text;
      position: relative;
    }
    .tr-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 12px;
      flex-wrap: wrap;
      padding-bottom: 8px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    }
    .tr-title-group {
      flex: 1;
      min-width: 200px;
    }
    .tr-title {
      font-size: 15px;
      font-weight: 700;
      color: var(--accent-blue, #38bdf8);
      margin: 0;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .tr-subtitle {
      font-size: 11.5px;
      color: var(--text-secondary, #94a3b8);
      margin: 3px 0 0 0;
    }
    .tr-whatif-toggle {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 11.5px;
      color: #cbd5e1;
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.12);
      padding: 4px 10px;
      border-radius: 6px;
      cursor: pointer;
      transition: all 0.2s ease;
    }
    .tr-whatif-toggle.active {
      border-color: #ef4444;
      background: rgba(239, 68, 68, 0.18);
      color: #fca5a5;
      box-shadow: 0 0 10px rgba(239, 68, 68, 0.25);
    }
    .tr-timeline-bar {
      display: flex;
      align-items: center;
      gap: 8px;
      background: rgba(0, 0, 0, 0.35);
      padding: 6px 12px;
      border-radius: 6px;
      border: 1px solid rgba(255, 255, 255, 0.08);
    }
    .tr-btn {
      padding: 3px 10px;
      font-size: 11.5px;
      font-weight: 500;
      border-radius: 4px;
      border: 1px solid rgba(255, 255, 255, 0.16);
      background: rgba(255, 255, 255, 0.08);
      color: #f1f5f9;
      cursor: pointer;
      transition: background 0.15s, border-color 0.15s, color 0.15s;
    }
    .tr-btn:hover:not(:disabled) {
      background: rgba(255, 255, 255, 0.18);
      border-color: rgba(255, 255, 255, 0.35);
    }
    .tr-btn.primary {
      background: #0284c7;
      border-color: #38bdf8;
      color: #ffffff;
      font-weight: 600;
    }
    .tr-btn.primary:hover {
      background: #0369a1;
    }
    .tr-btn:disabled {
      opacity: 0.35;
      cursor: not-allowed;
    }
    .tr-slider {
      flex: 1;
      height: 4px;
      accent-color: #38bdf8;
      cursor: pointer;
    }
    .tr-step-indicator {
      font-size: 11.5px;
      font-weight: 700;
      font-family: monospace;
      color: #38bdf8;
      min-width: 36px;
      text-align: right;
    }
    .tr-body-container {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    /* Light Theme Adaptations */
    [data-theme="light"] .tr-root {
      color: #1e293b;
    }
    [data-theme="light"] .tr-header {
      border-bottom-color: rgba(0, 0, 0, 0.08);
    }
    [data-theme="light"] .tr-title {
      color: #0284c7;
    }
    [data-theme="light"] .tr-subtitle {
      color: #64748b;
    }
    [data-theme="light"] .tr-whatif-toggle {
      background: #f8fafc;
      border-color: #cbd5e1;
      color: #334155;
    }
    [data-theme="light"] .tr-whatif-toggle.active {
      background: #fef2f2;
      border-color: #ef4444;
      color: #b91c1c;
    }
    [data-theme="light"] .tr-timeline-bar {
      background: #f8fafc;
      border-color: #e2e8f0;
    }
    [data-theme="light"] .tr-btn {
      background: #ffffff;
      border-color: #cbd5e1;
      color: #1e293b;
    }
    [data-theme="light"] .tr-btn:hover:not(:disabled) {
      background: #f1f5f9;
      border-color: #94a3b8;
    }
    [data-theme="light"] .tr-btn.primary {
      background: #0284c7;
      border-color: #0284c7;
      color: #ffffff;
    }
    [data-theme="light"] .tr-step-indicator {
      color: #0284c7;
    }
  `;
  document.head.appendChild(style);
}

/**
 * 创建带步进时间轴、自动播放与反事实开关的标准微观沙盒
 * 
 * @param {Object} config
 * @param {string} config.id 沙盒唯一标识
 * @param {string} config.title 沙盒主标题
 * @param {string} [config.subtitle] 沙盒副标题/教学断言
 * @param {Array} config.steps 步骤状态列表
 * @param {Object} [config.whatIf] 反事实推演配置 { label: string, desc: string, default: boolean }
 * @param {Function} config.renderView 步骤内容渲染回调：(viewContainer, currentStep, state) => void
 * @param {Function} [config.onStepChange] 步骤变更监听回调：(stepIdx, state) => void
 * @returns {Function} mountTracer(container, options) -> unmountFunction
 */
export function createSteppedTracer(config) {
  const {
    id = 'tracer_' + Date.now(),
    title = '微观系统单步探索器',
    subtitle = '',
    steps = [],
    whatIf = null,
    renderView,
    onStepChange = null
  } = config;

  if (!steps || steps.length === 0) {
    throw new Error(`[createSteppedTracer] steps 数组不能为空 (${id})`);
  }

  if (typeof renderView !== 'function') {
    throw new Error(`[createSteppedTracer] 必须提供 renderView 回调函数 (${id})`);
  }

  return function mountTracer(container, options = {}) {
    injectRuntimeStyles();

    // 状态机内部状态
    const state = {
      currentStepIndex: Math.max(0, Math.min(options.initialStep || 0, steps.length - 1)),
      totalSteps: steps.length,
      isWhatIfActive: whatIf ? (options.whatIf ?? whatIf.default ?? false) : false,
      isPlaying: false,
      playTimer: null,
      autoPlayInterval: options.autoPlayInterval || 1800,
      tracerId: id
    };

    container.innerHTML = '';
    const root = document.createElement('div');
    root.className = 'tr-root';
    root.id = `tr-root-${id}`;

    // 1. 构建头部
    const header = document.createElement('div');
    header.className = 'tr-header';

    const titleGroup = document.createElement('div');
    titleGroup.className = 'tr-title-group';
    titleGroup.innerHTML = `
      <h3 class="tr-title">${title}</h3>
      ${subtitle ? `<p class="tr-subtitle">${subtitle}</p>` : ''}
    `;
    header.appendChild(titleGroup);

    let whatIfToggle = null;
    if (whatIf) {
      whatIfToggle = document.createElement('label');
      whatIfToggle.className = `tr-whatif-toggle ${state.isWhatIfActive ? 'active' : ''}`;
      whatIfToggle.title = whatIf.desc || '';
      whatIfToggle.innerHTML = `
        <input type="checkbox" ${state.isWhatIfActive ? 'checked' : ''} style="accent-color: #ef4444; cursor: pointer;">
        <span>${whatIf.label || '反事实推演'}</span>
      `;
      const chk = whatIfToggle.querySelector('input');
      chk.onchange = (e) => {
        state.isWhatIfActive = e.target.checked;
        whatIfToggle.classList.toggle('active', state.isWhatIfActive);
        updateView();
      };
      header.appendChild(whatIfToggle);
    }
    root.appendChild(header);

    // 2. 构建控制栏 (Prev, Next, Play, Slider, Indicator)
    const timelineBar = document.createElement('div');
    timelineBar.className = 'tr-timeline-bar';
    timelineBar.innerHTML = `
      <button class="tr-btn btn-prev" title="上一步 [快捷键: ←]">上一步</button>
      <button class="tr-btn primary btn-play" title="自动连续播放 [快捷键: 空格]">自动播放</button>
      <button class="tr-btn btn-next" title="下一步 [快捷键: →]">下一步</button>
      <input type="range" class="tr-slider" min="0" max="${steps.length - 1}" value="${state.currentStepIndex}" step="1">
      <span class="tr-step-indicator">${state.currentStepIndex + 1}/${steps.length}</span>
    `;
    root.appendChild(timelineBar);

    // 3. 构建视图展示容器
    const bodyContainer = document.createElement('div');
    bodyContainer.className = 'tr-body-container';
    root.appendChild(bodyContainer);

    container.appendChild(root);

    // 控制元素引用
    const btnPrev = timelineBar.querySelector('.btn-prev');
    const btnNext = timelineBar.querySelector('.btn-next');
    const btnPlay = timelineBar.querySelector('.btn-play');
    const slider = timelineBar.querySelector('.tr-slider');
    const indicator = timelineBar.querySelector('.tr-step-indicator');

    function stopAutoPlay() {
      if (state.isPlaying) {
        state.isPlaying = false;
        clearInterval(state.playTimer);
        state.playTimer = null;
        btnPlay.innerText = '自动播放';
        btnPlay.classList.remove('playing');
      }
    }

    function startAutoPlay() {
      if (!state.isPlaying) {
        state.isPlaying = true;
        btnPlay.innerText = '暂停播放';
        btnPlay.classList.add('playing');
        state.playTimer = setInterval(() => {
          if (state.currentStepIndex >= steps.length - 1) {
            goToStep(0);
          } else {
            goToStep(state.currentStepIndex + 1);
          }
        }, state.autoPlayInterval);
      }
    }

    function toggleAutoPlay() {
      if (state.isPlaying) {
        stopAutoPlay();
      } else {
        startAutoPlay();
      }
    }

    function goToStep(idx) {
      const clamped = Math.max(0, Math.min(idx, steps.length - 1));
      if (clamped !== state.currentStepIndex) {
        state.currentStepIndex = clamped;
        updateView();
      }
    }

    function updateView() {
      slider.value = state.currentStepIndex;
      indicator.innerText = `${state.currentStepIndex + 1}/${steps.length}`;
      btnPrev.disabled = state.currentStepIndex === 0;
      btnNext.disabled = state.currentStepIndex === steps.length - 1;

      const currentStep = steps[state.currentStepIndex];
      renderView(bodyContainer, currentStep, {
        stepIndex: state.currentStepIndex,
        totalSteps: steps.length,
        isWhatIf: state.isWhatIfActive,
        whatIfConfig: whatIf
      });

      if (typeof onStepChange === 'function') {
        onStepChange(state.currentStepIndex, state);
      }
    }

    // 事件绑定
    btnPrev.onclick = (e) => {
      e.stopPropagation();
      stopAutoPlay();
      goToStep(state.currentStepIndex - 1);
    };

    btnNext.onclick = (e) => {
      e.stopPropagation();
      stopAutoPlay();
      goToStep(state.currentStepIndex + 1);
    };

    btnPlay.onclick = (e) => {
      e.stopPropagation();
      toggleAutoPlay();
    };

    slider.oninput = (e) => {
      e.stopPropagation();
      stopAutoPlay();
      goToStep(parseInt(e.target.value, 10));
    };

    // 键盘监听（聚焦或鼠标悬浮在卡片内时响应）
    const keyHandler = (e) => {
      // 避免在文本输入框中按键时误触发
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
      if (!root.contains(document.activeElement) && !root.matches(':hover')) return;

      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        stopAutoPlay();
        goToStep(state.currentStepIndex - 1);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        stopAutoPlay();
        goToStep(state.currentStepIndex + 1);
      } else if (e.key === ' ') {
        e.preventDefault();
        toggleAutoPlay();
      }
    };
    window.addEventListener('keydown', keyHandler);

    // 初始首帧渲染
    updateView();

    // 销毁钩子
    return function unmount() {
      stopAutoPlay();
      window.removeEventListener('keydown', keyHandler);
      container.innerHTML = '';
    };
  };
}
