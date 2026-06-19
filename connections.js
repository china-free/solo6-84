/* =========================================================
   connections.js · 连线系统
   ========================================================= */

class WireManager {
  constructor(graph) {
    this.graph = graph;
    this.wires = new Map();
    this.order = [];
  }

  clear() {
    this.wires.clear();
    this.order = [];
  }

  /* 校验连接是否合法（类型方向、重复、目标是否已占用、环检测） */
  validate(from, to) {
    if (!from || !to) return { ok: false, reason: '无效端口' };
    if (from.type !== 'out' || to.type !== 'in')
      return { ok: false, reason: '必须从输出端口连到输入端口' };
    if (from.nodeId === to.nodeId)
      return { ok: false, reason: '不能连接同一节点' };
    const fIdx = from.index !== undefined ? from.index : from.portIndex;
    const tIdx = to.index   !== undefined ? to.index   : to.portIndex;
    for (const w of this.wires.values()) {
      if (w.to.nodeId === to.nodeId && w.to.portIndex === tIdx)
        return { ok: false, reason: '目标输入端口已被占用' };
      if (w.from.nodeId === from.nodeId && w.from.portIndex === fIdx
          && w.to.nodeId === to.nodeId && w.to.portIndex === tIdx)
        return { ok: false, reason: '连线已存在' };
    }
    if (this.wouldCreateCycle(from.nodeId, to.nodeId))
      return { ok: false, reason: '禁止形成循环回路' };
    return { ok: true };
  }

  /* 检测添加 from→to 边后是否产生环（三色标记法）
   * 原理：若添加 from→to 后存在环，则环必含此新边，即 to 能到达 from
   * 颜色状态：0 = 未访问 (WHITE), 1 = 访问中 (GRAY), 2 = 已访问 (BLACK) */
  wouldCreateCycle(fromId, toId) {
    /* 构建临时邻接表（包含待添加的 from→to 边） */
    const adj = new Map();
    const nodes = new Set();
    for (const w of this.wires.values()) {
      if (!adj.has(w.from.nodeId)) adj.set(w.from.nodeId, []);
      adj.get(w.from.nodeId).push(w.to.nodeId);
      nodes.add(w.from.nodeId); nodes.add(w.to.nodeId);
    }
    if (!adj.has(fromId)) adj.set(fromId, []);
    adj.get(fromId).push(toId);
    nodes.add(fromId); nodes.add(toId);

    /* 从 to 出发，看能不能到达 from —— 若能，则添加 from→to 后形成环 */
    const color = new Map();
    for (const n of nodes) color.set(n, 0);

    const hasCycleFrom = (start) => {
      const stack = [{ node: start, iter: 0 }];
      const pathSet = new Set();
      pathSet.add(start);
      color.set(start, 1);

      while (stack.length > 0) {
        const top = stack[stack.length - 1];
        const neighbors = adj.get(top.node) || [];

        if (top.iter < neighbors.length) {
          const v = neighbors[top.iter];
          top.iter++;

          const c = color.get(v) ?? 0;
          if (c === 1) {
            return true;
          }
          if (c === 0) {
            color.set(v, 1);
            pathSet.add(v);
            stack.push({ node: v, iter: 0 });
          }
        } else {
          color.set(top.node, 2);
          pathSet.delete(top.node);
          stack.pop();
        }
      }
      return false;
    };

    /* 因为只关心 "to 能否到达 from"，所以只需要从 to 开始 DFS 即可 */
    if (color.get(toId) === 0) {
      if (hasCycleFrom(toId)) return true;
    }

    /* 保险起见：再扫一遍所有未访问节点，防止图中已存在环（虽然理论上不应该） */
    for (const n of nodes) {
      if (color.get(n) === 0) {
        if (hasCycleFrom(n)) return true;
      }
    }

    return false;
  }

  add(from, to) {
    const check = this.validate(from, to);
    if (!check.ok) return check;
    const id = uid('w');
    const wire = {
      id,
      from: { nodeId: from.nodeId, portIndex: from.index },
      to:   { nodeId: to.nodeId,   portIndex: to.index   },
      flowing: [],
    };
    this.rebuildWireGeometry(wire);
    this.wires.set(id, wire);
    this.order.push(id);
    return { ok: true, wire };
  }

  remove(id) {
    this.wires.delete(id);
    const i = this.order.indexOf(id);
    if (i >= 0) this.order.splice(i, 1);
  }

  /* 根据端口位置重建贝塞尔曲线与弧长表 */
  rebuildWireGeometry(wire) {
    const fromNode = this.graph.get(wire.from.nodeId);
    const toNode   = this.graph.get(wire.to.nodeId);
    if (!fromNode || !toNode) return;
    const fromPort = fromNode.outputs[wire.from.portIndex];
    const toPort   = toNode.inputs[wire.to.portIndex];
    const p0 = fromNode.getPortPos(fromPort);
    const p3 = toNode.getPortPos(toPort);

    /* 重建前：记下每个流动材料的当前物理坐标 (x, y) */
    const flowingPositions = [];
    if (wire.arcTable && wire.flowing.length > 0) {
      for (const f of wire.flowing) {
        const info = pointAtDistance(wire.arcTable, f.distance);
        flowingPositions.push({ f, x: info.x, y: info.y });
      }
    }

    const [cp1, cp2] = cubicControlPoints(p0, p3);
    wire.p0 = p0; wire.p1 = cp1; wire.p2 = cp2; wire.p3 = p3;
    wire.svgPath = bezierToSvgPath(p0, cp1, cp2, p3);
    wire.arcTable = buildArcLengthTable(p0, cp1, cp2, p3, 80);

    /* 重建后：根据旧坐标反向查找新曲线上的最近点，重新计算 distance */
    if (flowingPositions.length > 0) {
      for (const { f, x, y } of flowingPositions) {
        const newDist = this._findClosestDistance(wire.arcTable, x, y);
        f.distance = Math.max(0, Math.min(newDist, wire.arcTable.total - 0.01));
      }
    }
  }

  /* 在新弧长表上二分查找离 (x,y) 最近的点，返回对应的 distance */
  _findClosestDistance(arcTable, x, y) {
    const samples = arcTable.samples;
    let bestIdx = 0;
    let bestDistSq = Infinity;
    for (let i = 0; i < samples.length; i++) {
      const s = samples[i];
      const dx = s.x - x, dy = s.y - y;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestDistSq) { bestDistSq = d2; bestIdx = i; }
    }
    return samples[bestIdx].len;
  }

  rebuildAll() {
    for (const w of this.wires.values()) this.rebuildWireGeometry(w);
  }

  all() { return this.order.map(id => this.wires.get(id)); }

  /* 获取进入某节点的所有连线（按输入端口顺序排，缺失则 null） */
  incomingFor(nodeId) {
    const node = this.graph.get(nodeId);
    if (!node) return [];
    const res = new Array(node.def.inputs).fill(null);
    for (const w of this.wires.values()) {
      if (w.to.nodeId === nodeId) res[w.to.portIndex] = w;
    }
    return res;
  }

  /* 获取从某节点出去的所有连线（按输出端口顺序） */
  outgoingFor(nodeId) {
    const node = this.graph.get(nodeId);
    if (!node) return [];
    const res = new Array(node.def.outputs).fill(null);
    for (const w of this.wires.values()) {
      if (w.from.nodeId === nodeId) res[w.from.portIndex] = w;
    }
    return res;
  }
}

/* =========================================================
   渲染连线到 SVG
   ========================================================= */

function renderWiresSvg(wireMgr, layerEl, tempLayerEl, tempWireData, svgNS, selectedWireId) {
  layerEl.innerHTML = '';
  tempLayerEl.innerHTML = '';

  for (const w of wireMgr.all()) {
    const g = document.createElementNS(svgNS, 'g');
    g.setAttribute('data-wire-id', w.id);

    const bg = document.createElementNS(svgNS, 'path');
    bg.setAttribute('class', 'wire-bg');
    bg.setAttribute('d', w.svgPath);
    g.appendChild(bg);

    const path = document.createElementNS(svgNS, 'path');
    path.setAttribute('class', `wire ${selectedWireId === w.id ? 'wire-selected' : ''}`);
    path.setAttribute('d', w.svgPath);
    path.setAttribute('stroke', selectedWireId === w.id
      ? '#f5a623' : 'url(#wire-gradient)');
    path.setAttribute('data-wire-id', w.id);
    g.appendChild(path);

    layerEl.appendChild(g);
  }

  if (tempWireData) {
    const { from, mouse } = tempWireData;
    const [cp1, cp2] = cubicControlPoints(from, mouse);
    const d = bezierToSvgPath(from, cp1, cp2, mouse);
    const path = document.createElementNS(svgNS, 'path');
    path.setAttribute('class', 'temp-wire');
    path.setAttribute('d', d);
    tempLayerEl.appendChild(path);
  }
}

/* =========================================================
   渲染流动中的材料（SVG group）
   ========================================================= */

function renderFlowingMaterialsSvg(wireMgr, layerEl, svgNS) {
  layerEl.innerHTML = '';
  for (const w of wireMgr.all()) {
    for (const f of w.flowing) {
      const info = pointAtDistance(w.arcTable, f.distance);
      const g = document.createElementNS(svgNS, 'g');
      g.setAttribute('class', 'material-group');
      g.setAttribute('transform', `translate(${info.x}, ${info.y})`);
      const inner = materialToSvg(f.material, 0, 0, 14);
      g.innerHTML = inner;
      layerEl.appendChild(g);
    }
  }
}

if (typeof globalThis !== 'undefined') {
  Object.assign(globalThis, {
    WireManager, renderWiresSvg, renderFlowingMaterialsSvg,
  });
}
