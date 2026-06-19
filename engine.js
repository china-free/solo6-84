/* =========================================================
   engine.js · DAG 执行引擎 & Tick 调度器
   ========================================================= */

class Engine {
  constructor(graph, wireMgr, callbacks = {}) {
    this.graph = graph;
    this.wireMgr = wireMgr;
    this.callbacks = callbacks;
    this.topos = [];
    this.running = false;
    this.paused = false;
    this.tickCount = 0;
    this.tickInterval = 80;
    this.sourceTimers = new Map();
    this._timer = null;
    this._ended = false;
    this.MOVE_PER_TICK = 45;   // 材料每 tick 沿导线前进的像素距离
  }

  /* -------------- 拓扑排序（Kahn 算法） -------------- */

  buildTopo() {
    const indeg = new Map();
    for (const n of this.graph.all()) indeg.set(n.id, 0);
    for (const w of this.wireMgr.all()) {
      indeg.set(w.to.nodeId, (indeg.get(w.to.nodeId) || 0) + 1);
    }
    const queue = [];
    indeg.forEach((d, id) => { if (d === 0) queue.push(id); });
    const order = [];
    while (queue.length) {
      const id = queue.shift();
      order.push(id);
      const out = this.wireMgr.outgoingFor(id);
      for (const w of out) {
        if (!w) continue;
        const nd = indeg.get(w.to.nodeId) - 1;
        indeg.set(w.to.nodeId, nd);
        if (nd === 0) queue.push(w.to.nodeId);
      }
    }
    this.topos = order.map(id => this.graph.get(id)).filter(Boolean);
    return order.length === this.graph.all().length;
  }

  /* -------------- 状态控制 -------------- */

  start() {
    this.resetFlowState();
    if (!this.buildTopo()) {
      this.callbacks.onError?.('图中存在循环，无法执行');
      return false;
    }
    this.running = true;
    this.paused = false;
    this._scheduleNext();
    this.callbacks.onStart?.();
    return true;
  }

  pause() {
    if (!this.running) return;
    this.paused = true;
    if (this._timer) { clearTimeout(this._timer); this._timer = null; }
    this.callbacks.onPause?.();
  }

  resume() {
    if (!this.running || !this.paused) return;
    this.paused = false;
    this._scheduleNext();
    this.callbacks.onResume?.();
  }

  stop() {
    this.running = false;
    this.paused = false;
    if (this._timer) { clearTimeout(this._timer); this._timer = null; }
    this.callbacks.onStop?.();
  }

  reset() {
    this.stop();
    this.resetFlowState();
    this.tickCount = 0;
    this.callbacks.onReset?.();
  }

  resetFlowState() {
    for (const n of this.graph.all()) {
      n.processing = false;
      n.processTimer = 0;
      n.inputBuffer  = Array.from({ length: n.def.inputs },  () => []);
      n.outputBuffer = [];
      if (n.type === 'source' && n._originalRemaining !== undefined) {
        n.params.remaining = n._originalRemaining;
      }
      if (n.type === 'target') {
        n.params.got = 0;
      }
    }
    for (const w of this.wireMgr.all()) w.flowing = [];
    this.sourceTimers.clear();
    this._ended = false;
  }

  _scheduleNext() {
    this._timer = setTimeout(() => {
      if (!this.running || this.paused) return;
      this._step();
      this._scheduleNext();
    }, this.tickInterval);
  }

  /* -------------- 核心 Tick 步骤 -------------- */

  _step() {
    this.tickCount++;

    /* Phase 1: 材料沿导线流动，到达终点的进入对应 target/inputBuffer */
    for (const w of this.wireMgr.all()) {
      for (let i = w.flowing.length - 1; i >= 0; i--) {
        const f = w.flowing[i];
        f.distance += this.MOVE_PER_TICK;

        const info = pointAtDistance(w.arcTable, f.distance);
        this.callbacks.onTrail?.(info.x, info.y, COLOR_MAP[f.material.color]?.glow || '#fff');

        if (info.done) {
          w.flowing.splice(i, 1);
          const targetNode = this.graph.get(w.to.nodeId);
          if (!targetNode) continue;
          const result = targetNode.acceptMaterial(w.to.portIndex, f.material);
          if (targetNode.type === 'target') {
            if (result.matched) {
              this.callbacks.onTargetHit?.(f.material, targetNode);
              this.callbacks.onBurst?.(info.x, info.y, COLOR_MAP[f.material.color]?.fill || '#fff');
            } else if (!result.ok) {
              this.callbacks.onTargetReject?.(f.material, targetNode);
              this.callbacks.onBurst?.(info.x, info.y, '#ff5e7a');
            }
          } else if (!result.ok) {
            this.callbacks.onError?.(`节点缓冲已满，材料溢出`);
          }
        }
      }
    }

    /* Phase 2: 节点处理（按拓扑序） */
    for (const node of this.topos) {
      node.tickPostProcess();

      if (node.type === 'source') {
        const timerKey = node.id;
        if (!this.sourceTimers.has(timerKey)) this.sourceTimers.set(timerKey, 0);
        let t = this.sourceTimers.get(timerKey);
        t++;
        if (t >= (node.params.interval || 10) && node.canProcess()) {
          node.process();
          t = 0;
        }
        this.sourceTimers.set(timerKey, t);
      } else if (node.type !== 'target' && node.canProcess()) {
        node.process();
        this.callbacks.onBurst?.(
          node.x + node.w / 2,
          node.y + node.h / 2,
          node.def.color.header,
          8
        );
      }
    }

    /* Phase 3: 节点输出派发 → 输出连线起点 */
    for (const node of this.topos) {
      if (node.outputBuffer.length === 0) continue;
      const outWires = this.wireMgr.outgoingFor(node.id);
      while (node.outputBuffer.length) {
        const mat = node.outputBuffer[0];
        const idx = (node.type === 'cutter') ? 0 : -1;
        if (node.type === 'cutter') {
          let dispatched = false;
          for (let i = 0; i < outWires.length; i++) {
            const w = outWires[i];
            if (w && w.flowing.length < 6) {
              const m = node.outputBuffer.shift();
              if (!m) break;
              w.flowing.push({ material: m, distance: 0 });
              dispatched = true;
              if (node.outputBuffer.length === 0) break;
            }
          }
          if (!dispatched) break;
        } else {
          let sent = false;
          for (let i = 0; i < outWires.length; i++) {
            const w = outWires[i];
            if (w && w.flowing.length < 6) {
              const m = node.outputBuffer.shift();
              w.flowing.push({ material: m, distance: 0 });
              sent = true;
              break;
            }
          }
          if (!sent) break;
        }
      }
    }

    /* Phase 4: 检查胜利条件 */
    this._checkWin();
    this.callbacks.onTickEnd?.();
  }

  _checkWin() {
    if (this._ended) return;
    const targets = this.graph.all().filter(n => n.type === 'target');
    if (targets.length === 0) return;
    const allDone = targets.every(t => (t.params.got || 0) >= (t.params.need || 0));
    if (allDone) {
      this._ended = true;
      this.stop();
      this.callbacks.onWin?.();
      return;
    }
    const sourcesDone = this.graph.all()
      .filter(n => n.type === 'source')
      .every(n => n.params.remaining <= 0);
    const noFlowing = this.wireMgr.all().every(w => w.flowing.length === 0);
    const noBuffer = this.graph.all()
      .filter(n => n.type !== 'source' && n.type !== 'target')
      .every(n =>
        n.outputBuffer.length === 0 &&
        n.inputBuffer.every(b => b.length === 0));
    if (sourcesDone && noFlowing && noBuffer) {
      this._ended = true;
      this.stop();
      if (allDone) this.callbacks.onWin?.();
      else this.callbacks.onLose?.();
    }
  }
}

if (typeof globalThis !== 'undefined') {
  Object.assign(globalThis, { Engine });
}
