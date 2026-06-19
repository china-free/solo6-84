/* =========================================================
   game.js · 游戏主入口
   ========================================================= */

(function () {
  'use strict';

  const SVG_NS = 'http://www.w3.org/2000/svg';

  /* --------------- DOM --------------- */
  const $ = id => document.getElementById(id);
  const svg         = $('svg-layer');
  const nodesLayer  = $('nodes-layer');
  const wiresLayer  = $('wires-layer');
  const tempWire    = $('temp-wire-layer');
  const materialsLayer = $('materials-layer');
  const canvasWrap  = $('canvas-wrap');
  const fxCanvas    = $('fx-canvas');
  const toolboxEl   = $('toolbox');
  const targetPanel = $('target-panel');
  const propsPanel  = $('props-panel');
  const ghost       = $('drag-ghost');
  const toastEl     = $('toast');
  const statusPanel = document.querySelector('.status-panel');
  const statusDot   = $('status-dot');
  const statusText  = $('status-text');
  const btnRun    = $('btn-run');
  const btnPause  = $('btn-pause');
  const btnReset  = $('btn-reset');
  const btnPrev   = $('btn-prev');
  const btnNext   = $('btn-next');
  const levelNumEl  = $('level-num');
  const levelTotalEl= $('level-total');
  const levelNameEl = $('level-name');

  /* --------------- 全局状态 --------------- */
  const state = {
    graph: new NodeGraph(),
    wires: null,
    engine: null,
    fx: null,
    levelIdx: 0,
    level: null,
    selectedNodeId: null,
    selectedWireId: null,
    dragging: null,          // { type: 'node'|'tool'|'wire', ... }
    connecting: null,        // { from: {port, nodeId}, mouse: {x,y} }
    renderLoop: null,
    justSelectedWire: false,
  };
  state.wires = new WireManager(state.graph);

  /* --------------- 初始化 --------------- */
  function init() {
    resizeCanvas();
    window.addEventListener('resize', () => {
      resizeCanvas();
      state.wires.rebuildAll();
      fullRender();
    });

    state.fx = new FxLayer(fxCanvas);

    state.engine = new Engine(state.graph, state.wires, {
      onStart:   () => setStatus('running', '运行中...'),
      onPause:   () => setStatus('paused',  '已暂停'),
      onResume:  () => setStatus('running', '运行中...'),
      onStop:    () => setStatus('', '就绪'),
      onReset:   () => setStatus('', '就绪'),
      onWin:     () => { showToast('🎉 关卡通过！', 'success'); setStatus('success', '通关成功!'); },
      onLose:    () => { showToast('⚠ 材料已耗尽但未达成目标，请调整流水线', 'error'); setStatus('error', '任务失败'); },
      onError:   (msg) => { showToast(msg, 'error'); },
      onTickEnd: () => { updateTargetProgress(); },
      onTrail:   (x, y, c) => state.fx.emitTrail(x, y, c),
      onBurst:   (x, y, c, n = 14) => state.fx.emitBurst(x, y, c, n),
    });

    loadLevel(0);
    bindEvents();
    startRenderLoop();
  }

  function resizeCanvas() {
    const rect = canvasWrap.getBoundingClientRect();
    svg.setAttribute('width', rect.width);
    svg.setAttribute('height', rect.height);
    if (state.fx) state.fx.resize();
  }

  /* --------------- 关卡加载 --------------- */
  function loadLevel(idx) {
    idx = Math.max(0, Math.min(LEVELS.length - 1, idx));
    state.levelIdx = idx;
    const lv = LEVELS[idx];
    state.level = lv;

    state.engine.stop();
    state.graph.clear();
    state.wires.clear();
    state.selectedNodeId = null;
    state.selectedWireId = null;
    state.engine.resetFlowState();
    state.engine.tickInterval = lv.tickInterval || 80;

    lv.sources.forEach(src => {
      const n = new GameNode('source', src.x, src.y, src.id);
      n.params.interval = src.interval || 10;
      n.params.produce = src.produce;
      n.params.remaining = src.count;
      n._originalRemaining = src.count;
      state.graph.add(n);
    });
    lv.targets.forEach(t => {
      const n = new GameNode('target', t.x, t.y, t.id);
      n.params.require = t.require;
      n.params.need = t.count;
      n.params.got = 0;
      state.graph.add(n);
    });

    levelNumEl.textContent  = String(idx + 1).padStart(2, '0');
    levelTotalEl.textContent= String(LEVELS.length).padStart(2, '0');
    levelNameEl.textContent = lv.name;

    renderToolbox(toolboxEl, lv.availableNodes || []);
    renderTargetPanel(lv);
    renderPropsPanel();
    updateTargetProgress();
    setStatus('', '就绪');
    showToast(`关卡 ${idx + 1}：${lv.name} —— ${lv.intro}`);
    fullRender();
  }

  function renderTargetPanel(lv) {
    targetPanel.innerHTML = '';
    if (!lv.targets || lv.targets.length === 0) return;
    lv.targets.forEach(t => {
      const block = document.createElement('div');
      block.style.cssText = 'width:100%;display:flex;flex-direction:column;gap:6px;align-items:center;padding:8px 0;border-bottom:1px dashed #3a3f66;';
      const shapeWrap = document.createElement('div');
      shapeWrap.className = 'target-shape';
      shapeWrap.innerHTML = `
        <svg width="80" height="60" viewBox="-40 -30 80 60">
          ${materialToSvg(t.require, 0, 0, 20)}
        </svg>`;
      const label = document.createElement('div');
      label.className = 'target-label';
      label.textContent = t.label || describeMaterial(t.require);
      const req = document.createElement('div');
      req.className = 'target-req';
      req.innerHTML = `需要 <span class="target-req-num" data-tgt="${t.id}">0</span> / ${t.count} 个`;
      const prog = document.createElement('div');
      prog.className = 'target-progress';
      prog.innerHTML = `<div class="target-progress-fill" data-tgt-fill="${t.id}"></div>`;
      block.appendChild(shapeWrap);
      block.appendChild(label);
      block.appendChild(req);
      block.appendChild(prog);
      targetPanel.appendChild(block);
    });
  }

  function updateTargetProgress() {
    const targets = state.graph.all().filter(n => n.type === 'target');
    targets.forEach(t => {
      const got = t.params.got || 0;
      const need = t.params.need || 0;
      const numEl = document.querySelector(`[data-tgt="${t.id}"]`);
      const fillEl = document.querySelector(`[data-tgt-fill="${t.id}"]`);
      if (numEl) numEl.textContent = got;
      if (fillEl) fillEl.style.width = Math.min(100, Math.round(got / need * 100)) + '%';
    });
  }

  /* --------------- 渲染 --------------- */
  function fullRender() {
    nodesLayer.innerHTML = '';
    for (const n of state.graph.all()) {
      n.selected = n.id === state.selectedNodeId;
      nodesLayer.appendChild(renderNodeSvg(n, SVG_NS));
    }
    renderWiresSvg(state.wires, wiresLayer, tempWire,
      state.connecting ? { from: getConnectStart(), mouse: state.connecting.mouse } : null,
      SVG_NS, state.selectedWireId);
    renderFlowingMaterialsSvg(state.wires, materialsLayer, SVG_NS);
  }

  function renderNodesOnly() {
    nodesLayer.innerHTML = '';
    for (const n of state.graph.all()) {
      n.selected = n.id === state.selectedNodeId;
      nodesLayer.appendChild(renderNodeSvg(n, SVG_NS));
    }
  }

  function renderWiresOnly() {
    renderWiresSvg(state.wires, wiresLayer, tempWire,
      state.connecting ? { from: getConnectStart(), mouse: state.connecting.mouse } : null,
      SVG_NS, state.selectedWireId);
  }

  function getConnectStart() {
    if (!state.connecting) return { x: 0, y: 0 };
    const node = state.graph.get(state.connecting.from.nodeId);
    if (!node) return { x: 0, y: 0 };
    const port = state.connecting.from.type === 'out'
      ? node.outputs[state.connecting.from.index]
      : node.inputs[state.connecting.from.index];
    return node.getPortPos(port);
  }

  /* --------------- 属性面板 --------------- */
  function renderPropsPanel() {
    if (state.selectedWireId) {
      const w = state.wires.wires.get(state.selectedWireId);
      if (!w) { propsPanel.innerHTML = '<div class="props-empty">选择一个节点查看属性</div>'; return; }
      const fromN = state.graph.get(w.from.nodeId);
      const toN   = state.graph.get(w.to.nodeId);
      propsPanel.innerHTML = `
        <div class="props-title">连线信息</div>
        <div style="font-size:11px;color:#8890b8;line-height:1.7">
          ${fromN?.def.label || '?'} → ${toN?.def.label || '?'}<br>
          长度：${w.arcTable?.total?.toFixed(0) || '?'} px<br>
          流动中：${w.flowing.length} 个材料
        </div>
        <button class="btn btn-small" id="btn-del-wire" style="margin-top:6px;background:#3a1d26;border-color:#7a3e4d;color:#ff8fa3">删除连线 (Del)</button>`;
      $('btn-del-wire').onclick = () => {
        if (state.engine.running) { showToast('运行中无法修改', 'error'); return; }
        state.wires.remove(state.selectedWireId);
        state.selectedWireId = null;
        renderPropsPanel();
        fullRender();
      };
      return;
    }

    const node = state.selectedNodeId ? state.graph.get(state.selectedNodeId) : null;
    if (!node) {
      propsPanel.innerHTML = '<div class="props-empty">选择一个节点查看属性</div>';
      return;
    }

    const def = node.def;
    let html = `<div class="props-title">${def.label}</div>`;

    if (node.type === 'source') {
      html += `
        <div class="prop-row">
          <div class="prop-label">产出材料</div>
          <div style="display:flex;align-items:center;gap:8px">
            <svg width="40" height="40" viewBox="-20 -20 40 40">${materialToSvg(node.params.produce, 0, 0, 14)}</svg>
            <span style="font-size:12px;color:#d6d9ee">${describeMaterial(node.params.produce)}</span>
          </div>
        </div>
        <div class="prop-row">
          <div class="prop-label">产出间隔</div>
          <div style="font-size:13px;color:#f5a623">${node.params.interval} 拍</div>
        </div>
        <div class="prop-row">
          <div class="prop-label">剩余数量</div>
          <div style="font-size:13px;color:#66d98b">${node.params.remaining} / ${node._originalRemaining}</div>
        </div>`;
    }

    if (node.type === 'painter') {
      html += `<div class="prop-row"><div class="prop-label">染料颜色</div><div class="color-picker">`;
      ['red','blue','yellow','green','purple'].forEach(c => {
        const active = node.params.dye === c ? 'active' : '';
        html += `<div class="color-swatch ${c} ${active}" data-dye="${c}" title="${c}"></div>`;
      });
      html += `</div></div>`;
    }

    if (node.type === 'target') {
      html += `
        <div class="prop-row">
          <div class="prop-label">目标要求</div>
          <div style="display:flex;align-items:center;gap:8px">
            <svg width="40" height="40" viewBox="-20 -20 40 40">${materialToSvg(node.params.require, 0, 0, 14)}</svg>
            <span style="font-size:12px;color:#d6d9ee">${describeMaterial(node.params.require)}</span>
          </div>
        </div>
        <div class="prop-row">
          <div class="prop-label">接收进度</div>
          <div style="font-size:13px;color:${node.params.got >= node.params.need ? '#66d98b' : '#f5a623'}">${node.params.got} / ${node.params.need}</div>
        </div>`;
    }

    if (node.type === 'cutter') {
      html += `
        <div class="prop-row">
          <div class="prop-label">功能说明</div>
          <div style="font-size:11px;color:#8890b8;line-height:1.7">
            把圆形切成两个半圆<br>
            上方输出 → 上半圆（rotation=0）<br>
            下方输出 → 下半圆（rotation=2）
          </div>
        </div>`;
    }

    if (node.type === 'joiner') {
      html += `
        <div class="prop-row">
          <div class="prop-label">功能说明</div>
          <div style="font-size:11px;color:#8890b8;line-height:1.7">
            把两个输入（A、B端口）拼接<br>
            需要两个端口同时有材料才工作
          </div>
        </div>`;
    }

    if (def.draggable) {
      html += `<button class="btn btn-small" id="btn-del-node" style="margin-top:10px;background:#3a1d26;border-color:#7a3e4d;color:#ff8fa3">删除节点 (Del)</button>`;
    }

    propsPanel.innerHTML = html;

    const dyeBtns = propsPanel.querySelectorAll('[data-dye]');
    dyeBtns.forEach(btn => {
      btn.onclick = () => {
        if (state.engine.running) { showToast('运行中无法修改', 'error'); return; }
        node.params.dye = btn.dataset.dye;
        renderPropsPanel();
        renderNodesOnly();
      };
    });
    const btnDel = $('btn-del-node');
    if (btnDel) btnDel.onclick = () => deleteNode(node.id);
  }

  /* --------------- 坐标转换 --------------- */
  function canvasPt(evt) {
    const rect = svg.getBoundingClientRect();
    return { x: evt.clientX - rect.left, y: evt.clientY - rect.top };
  }

  /* --------------- 事件绑定 --------------- */
  function bindEvents() {
    /* ---- 工具栏 HTML5 拖拽 ---- */
    toolboxEl.addEventListener('dragstart', e => {
      const item = e.target.closest('.tool-item');
      if (!item) return;
      if (state.engine.running) { e.preventDefault(); showToast('运行中无法放置节点', 'error'); return; }
      const type = item.dataset.type;
      state.dragging = { type: 'tool', nodeType: type };

      ghost.innerHTML = '';
      const tmpNode = new GameNode(type, 0, 0);
      const tmp = document.createElementNS(SVG_NS, 'svg');
      tmp.setAttribute('width', NODE_WIDTH);
      tmp.setAttribute('height', NODE_HEIGHT);
      tmp.setAttribute('viewBox', `0 0 ${NODE_WIDTH} ${NODE_HEIGHT}`);
      tmp.appendChild(renderNodeSvg(tmpNode, SVG_NS));
      ghost.appendChild(tmp);

      ghost.style.display = 'block';
      try {
        e.dataTransfer.setData('text/plain', type);
        e.dataTransfer.effectAllowed = 'copy';
        const img = new Image();
        img.src = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>';
        e.dataTransfer.setDragImage(img, 0, 0);
      } catch (_) {}
    });
    toolboxEl.addEventListener('dragend', () => {
      state.dragging = null;
      ghost.style.display = 'none';
    });
    document.addEventListener('dragover', e => { e.preventDefault(); });
    document.addEventListener('drag', e => {
      if (state.dragging?.type === 'tool') {
        ghost.style.left = e.clientX + 'px';
        ghost.style.top = e.clientY + 'px';
      }
    });
    canvasWrap.addEventListener('drop', e => {
      e.preventDefault();
      if (state.dragging?.type !== 'tool') return;
      if (state.engine.running) { showToast('运行中无法放置节点', 'error'); return; }
      const pt = canvasPt(e);
      const x = Math.max(10, Math.min(pt.x - NODE_WIDTH  / 2, svg.clientWidth  - NODE_WIDTH  - 10));
      const y = Math.max(10, Math.min(pt.y - NODE_HEIGHT / 2, svg.clientHeight - NODE_HEIGHT - 10));
      const node = new GameNode(state.dragging.nodeType, x, y);
      state.graph.add(node);
      state.selectedNodeId = node.id;
      state.selectedWireId = null;
      renderPropsPanel();
      fullRender();
      showToast(`已放置 ${node.def.label}`);
    });

    /* ---- SVG 全局鼠标 ---- */
    svg.addEventListener('mousedown', onSvgMouseDown);
    svg.addEventListener('mousemove', onSvgMouseMove);
    window.addEventListener('mouseup',  onSvgMouseUp);

    /* ---- 按钮 ---- */
    btnRun.onclick   = () => {
      if (state.engine.running && state.engine.paused) state.engine.resume();
      else {
        const ok = state.engine.start();
        if (ok) { btnRun.disabled = true; btnPause.disabled = false; }
      }
    };
    btnPause.onclick = () => {
      if (state.engine.paused) state.engine.resume();
      else state.engine.pause();
    };
    btnReset.onclick = () => {
      state.engine.reset();
      btnRun.disabled = false;
      btnPause.disabled = true;
      renderNodesOnly();
      renderWiresOnly();
      renderFlowingMaterialsSvg(state.wires, materialsLayer, SVG_NS);
      updateTargetProgress();
    };
    btnPrev.onclick = () => { if (!state.engine.running) loadLevel(state.levelIdx - 1); else showToast('运行中无法切换关卡', 'error'); };
    btnNext.onclick = () => { if (!state.engine.running) loadLevel(state.levelIdx + 1); else showToast('运行中无法切换关卡', 'error'); };

    /* ---- 键盘：Delete 删除 ---- */
    document.addEventListener('keydown', e => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (state.engine.running) return;
        if (state.selectedWireId) {
          state.wires.remove(state.selectedWireId);
          state.selectedWireId = null;
          renderPropsPanel();
          fullRender();
        } else if (state.selectedNodeId) {
          deleteNode(state.selectedNodeId);
        }
      }
      if (e.key === 'Escape') {
        state.connecting = null;
        state.selectedNodeId = null;
        state.selectedWireId = null;
        renderPropsPanel();
        fullRender();
      }
    });
  }

  function deleteNode(id) {
    if (state.engine.running) { showToast('运行中无法删除', 'error'); return; }
    const node = state.graph.get(id);
    if (!node || !node.def.draggable) return;
    for (const w of [...state.wires.all()]) {
      if (w.from.nodeId === id || w.to.nodeId === id) state.wires.remove(w.id);
    }
    state.graph.remove(id);
    state.selectedNodeId = null;
    renderPropsPanel();
    fullRender();
  }

  function onSvgMouseDown(e) {
    if (state.engine.running) return;
    const pt = canvasPt(e);
    const target = e.target;

    /* 点击端口 → 开始连线 */
    const portEl = target.closest('.port');
    if (portEl) {
      const nodeId = portEl.getAttribute('data-node-id');
      const portType = portEl.getAttribute('data-port-type');
      const portIndex = parseInt(portEl.getAttribute('data-port-index'), 10);
      state.connecting = {
        from: { nodeId, type: portType, index: portIndex },
        mouse: pt,
      };
      state.dragging = { type: 'wire' };
      e.stopPropagation();
      renderWiresOnly();
      return;
    }

    /* 点击导线 → 选中 */
    if (target.classList?.contains('wire')) {
      state.selectedWireId = target.getAttribute('data-wire-id');
      state.selectedNodeId = null;
      state.justSelectedWire = true;
      renderPropsPanel();
      renderWiresOnly();
      renderNodesOnly();
      e.stopPropagation();
      return;
    }

    /* 点击节点 → 选中/拖拽移动 */
    const nodeEl = target.closest('.node-group');
    if (nodeEl) {
      const nodeId = nodeEl.getAttribute('data-node-id');
      const node = state.graph.get(nodeId);
      state.selectedNodeId = nodeId;
      state.selectedWireId = null;
      renderPropsPanel();
      renderNodesOnly();
      if (node && node.def.draggable) {
        state.dragging = {
          type: 'node',
          nodeId,
          offsetX: pt.x - node.x,
          offsetY: pt.y - node.y,
        };
      }
      e.stopPropagation();
      return;
    }

    /* 点击空白 → 取消选择 */
    state.selectedNodeId = null;
    state.selectedWireId = null;
    renderPropsPanel();
    fullRender();
  }

  function onSvgMouseMove(e) {
    const pt = canvasPt(e);

    if (state.connecting) {
      state.connecting.mouse = pt;
      renderWiresOnly();
      return;
    }

    if (state.dragging?.type === 'node' && !state.engine.running) {
      const node = state.graph.get(state.dragging.nodeId);
      if (!node) return;
      let nx = pt.x - state.dragging.offsetX;
      let ny = pt.y - state.dragging.offsetY;
      nx = Math.max(0, Math.min(nx, svg.clientWidth  - NODE_WIDTH));
      ny = Math.max(0, Math.min(ny, svg.clientHeight - NODE_HEIGHT));
      node.x = nx; node.y = ny;
      state.wires.rebuildAll();
      fullRender();
      return;
    }

    /* 悬停高亮端口 */
    const target = e.target;
    const portEl = target.closest?.('.port');
    svg.style.cursor = portEl ? 'crosshair' : (state.dragging ? 'grabbing' : 'default');
  }

  function onSvgMouseUp(e) {
    if (state.justSelectedWire) { state.justSelectedWire = false; return; }

    if (state.connecting) {
      const pt = canvasPt(e);
      const target = e.target;
      const portEl = target.closest?.('.port');
      let success = false;
      if (portEl) {
        const nodeId = portEl.getAttribute('data-node-id');
        const portType = portEl.getAttribute('data-port-type');
        const portIndex = parseInt(portEl.getAttribute('data-port-index'), 10);
        let from = state.connecting.from;
        let to = { nodeId, type: portType, index: portIndex };
        if (from.type === 'in' && to.type === 'out') {
          [from, to] = [to, from];
        }
        const res = state.wires.add(from, to);
        if (!res.ok) {
          showToast(res.reason || '连线失败', 'error');
        } else {
          success = true;
          showToast('连线成功');
        }
      }
      state.connecting = null;
      state.dragging = null;
      fullRender();
      if (success) state.wires.rebuildAll();
      return;
    }

    state.dragging = null;
  }

  /* --------------- 状态 & Toast --------------- */
  function setStatus(cls, text) {
    statusPanel.className = 'status-panel' + (cls ? ' ' + cls : '');
    statusText.textContent = text;
    if (cls === 'running') {
      btnRun.disabled = true;
      btnPause.disabled = false;
      btnPause.innerHTML = '<span class="btn-icon">⏸</span>暂停';
    } else if (cls === 'paused') {
      btnPause.innerHTML = '<span class="btn-icon">▶</span>继续';
    } else {
      btnRun.disabled = false;
      btnPause.disabled = true;
      btnPause.innerHTML = '<span class="btn-icon">⏸</span>暂停';
    }
  }

  let toastTimer = null;
  function showToast(msg, kind = '') {
    toastEl.textContent = msg;
    toastEl.className = 'toast show ' + kind;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastEl.className = 'toast ' + kind; }, 2600);
  }

  /* --------------- 渲染循环（rAF） --------------- */
  function startRenderLoop() {
    let lastNodesRefresh = 0;
    function frame(ts) {
      state.fx.tick();
      renderFlowingMaterialsSvg(state.wires, materialsLayer, SVG_NS);
      if (ts - lastNodesRefresh > 100) {
        renderNodesOnly();
        lastNodesRefresh = ts;
      }
      state.renderLoop = requestAnimationFrame(frame);
    }
    state.renderLoop = requestAnimationFrame(frame);
  }

  window.__game = {
    get state() { return state; },
    loadLevel,
    addNode(type, x, y) {
      const n = new GameNode(type, x, y);
      state.graph.add(n);
      fullRender();
      return n.id;
    },
    addWire(fromNodeId, fromIdx, toNodeId, toIdx) {
      const from = { nodeId: fromNodeId, type: 'out', index: fromIdx };
      const to   = { nodeId: toNodeId,   type: 'in',  index: toIdx   };
      const r = state.wires.add(from, to);
      fullRender();
      return r;
    },
    run() { state.engine.start(); },
    stop() { state.engine.stop(); },
    reset() { state.engine.reset(); btnRun.disabled = false; btnPause.disabled = true; renderNodesOnly(); updateTargetProgress(); },
    setPainterDye(nodeId, color) {
      const n = state.graph.get(nodeId);
      if (n && n.type === 'painter') { n.params.dye = color; renderNodesOnly(); }
    },
  };

  document.addEventListener('DOMContentLoaded', init);
})();
