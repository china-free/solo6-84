/* =========================================================
   nodes.js · 节点定义与渲染
   ========================================================= */

const NODE_WIDTH = 130;
const NODE_HEIGHT = 100;

const NODE_TYPES = {
  source: {
    label: '原料出口',
    icon: '⟶',
    color: {
      body:   '#1d3a26',
      border: '#4d7a3e',
      header: '#66d98b',
    },
    inputs:  0,
    outputs: 1,
    desc: '按节奏产出材料',
    draggable: false,
    defaultParams: () => ({ interval: 10, produce: null, remaining: 0 }),
  },

  cutter: {
    label: '切割机',
    icon: '✂',
    color: {
      body:   '#3a1d26',
      border: '#7a3e4d',
      header: '#ff5e7a',
    },
    inputs:  1,
    outputs: 2,
    desc: '圆→上半圆+下半圆',
    draggable: true,
    defaultParams: () => ({}),
  },

  painter: {
    label: '染色机',
    icon: '🎨',
    color: {
      body:   '#2d1f4a',
      border: '#6a4da0',
      header: '#b285ff',
    },
    inputs:  1,
    outputs: 1,
    desc: '改变材料颜色',
    draggable: true,
    defaultParams: () => ({ dye: 'blue' }),
  },

  joiner: {
    label: '拼接机',
    icon: '⊕',
    color: {
      body:   '#3a351d',
      border: '#8a7a3e',
      header: '#ffd760',
    },
    inputs:  2,
    outputs: 1,
    desc: '两个半圆拼成整体',
    draggable: true,
    defaultParams: () => ({}),
  },

  target: {
    label: '目标节点',
    icon: '◎',
    color: {
      body:   '#1d2d3a',
      border: '#3e6a8a',
      header: '#5aa8ff',
    },
    inputs:  1,
    outputs: 0,
    desc: '接收匹配的材料',
    draggable: false,
    defaultParams: () => ({ require: null, need: 0, got: 0 }),
  },
};

/* =========================================================
   Node 类
   ========================================================= */

class NodeGraph {
  constructor() {
    this.nodes = new Map();
    this.order = [];
  }

  add(node) {
    this.nodes.set(node.id, node);
    this.order.push(node.id);
  }

  remove(id) {
    this.nodes.delete(id);
    const i = this.order.indexOf(id);
    if (i >= 0) this.order.splice(i, 1);
  }

  get(id) { return this.nodes.get(id); }
  all() { return this.order.map(id => this.nodes.get(id)); }

  clear() {
    this.nodes.clear();
    this.order = [];
  }
}

class GameNode {
  constructor(type, x, y, id = null) {
    const def = NODE_TYPES[type];
    this.id = id || uid('n');
    this.type = type;
    this.def = def;
    this.x = x;
    this.y = y;
    this.w = NODE_WIDTH;
    this.h = NODE_HEIGHT;
    this.params = def.defaultParams();
    this.inputs  = Array.from({ length: def.inputs  }, (_, i) => this.makePort('in',  i));
    this.outputs = Array.from({ length: def.outputs }, (_, i) => this.makePort('out', i));
    this.inputBuffer  = Array.from({ length: def.inputs },  () => []);
    this.outputBuffer = [];
    this.processing = false;
    this.processTimer = 0;
    this.selected = false;
  }

  makePort(type, index) {
    const total = type === 'in' ? this.def.inputs : this.def.outputs;
    const sideX = type === 'in' ? 0 : this.w;
    const stepY = this.h / (total + 1);
    return {
      id: uid('p'),
      nodeId: this.id,
      type,
      index,
      localX: sideX,
      localY: stepY * (index + 1),
    };
  }

  getPortPos(port) {
    return { x: this.x + port.localX, y: this.y + port.localY };
  }

  hitTest(px, py) {
    return px >= this.x && px <= this.x + this.w
        && py >= this.y && py <= this.y + this.h;
  }

  hitPort(px, py, radius = 14) {
    for (const list of [this.inputs, this.outputs]) {
      for (const p of list) {
        const pos = this.getPortPos(p);
        const dx = px - pos.x, dy = py - pos.y;
        if (dx * dx + dy * dy <= radius * radius) return p;
      }
    }
    return null;
  }

  /* ---------- 节点处理逻辑 ---------- */

  canProcess() {
    switch (this.type) {
      case 'source':
        return this.params.remaining > 0 && this.outputBuffer.length < 2;
      case 'target':
        return false;
      case 'cutter':
      case 'painter':
        return this.inputBuffer[0].length > 0 && this.outputBuffer.length < 2;
      case 'joiner':
        return this.inputBuffer[0].length > 0
            && this.inputBuffer[1].length > 0
            && this.outputBuffer.length < 2;
    }
    return false;
  }

  process() {
    this.processing = true;
    this.processTimer = 3;

    switch (this.type) {
      case 'source': {
        const spec = this.params.produce;
        if (spec && this.params.remaining > 0) {
          const mat = {
            id: uid('m'),
            shape: spec.shape,
            color: spec.color,
            rotation: spec.rotation || 0,
            parts: spec.parts ? JSON.parse(JSON.stringify(spec.parts)) : undefined,
          };
          this.outputBuffer.push(mat);
          this.params.remaining--;
        }
        break;
      }
      case 'cutter': {
        const m = this.inputBuffer[0].shift();
        if (!m) break;
        if (m.shape !== 'circle') {
          this.outputBuffer.push(m);
          break;
        }
        this.outputBuffer.push({
          id: uid('m'), shape: 'semicircle', color: m.color, rotation: 0, parentId: m.id,
        });
        this.outputBuffer.push({
          id: uid('m'), shape: 'semicircle', color: m.color, rotation: 2, parentId: m.id,
        });
        break;
      }
      case 'painter': {
        const m = this.inputBuffer[0].shift();
        if (!m) break;
        const dye = this.params.dye || 'blue';
        if (m.shape === 'composite' && m.parts) {
          m.parts = m.parts.map(p => ({ ...p, color: dye }));
          m.color = dye;
        } else {
          m.color = dye;
        }
        this.outputBuffer.push(m);
        break;
      }
      case 'joiner': {
        const a = this.inputBuffer[0].shift();
        const b = this.inputBuffer[1].shift();
        if (!a || !b) break;
        const parts = [];
        const addPart = (x) => {
          if (x.shape === 'semicircle') parts.push(x);
          else if (x.shape === 'composite' && x.parts) parts.push(...x.parts);
          else parts.push({ shape: 'semicircle', color: x.color, rotation: 0 });
        };
        addPart(a); addPart(b);
        const composite = {
          id: uid('m'),
          shape: 'composite',
          color: parts[0]?.color || 'red',
          parts: parts.slice(0, 4),
        };
        this.outputBuffer.push(composite);
        break;
      }
      case 'target': {
        break;
      }
    }
  }

  acceptMaterial(portIndex, material) {
    if (this.type === 'target') {
      if (matchMaterial(this.params.require, material)) {
        this.params.got = (this.params.got || 0) + 1;
        return { ok: true, matched: true };
      }
      return { ok: false, matched: false };
    }
    if (this.inputBuffer[portIndex].length >= 3) return { ok: false, reason: 'buffer_full' };
    this.inputBuffer[portIndex].push(material);
    return { ok: true };
  }

  tickPostProcess() {
    if (this.processing) {
      this.processTimer--;
      if (this.processTimer <= 0) this.processing = false;
    }
  }
}

/* =========================================================
   节点渲染（SVG）
   ========================================================= */

function renderNodeSvg(node, svgNS) {
  const g = document.createElementNS(svgNS, 'g');
  g.setAttribute('class', `node-group ${node.selected ? 'selected ' : ''}${node.processing ? 'processing' : ''}`.trim());
  g.setAttribute('transform', `translate(${node.x}, ${node.y})`);
  g.setAttribute('data-node-id', node.id);

  const c = node.def.color;

  const body = document.createElementNS(svgNS, 'rect');
  body.setAttribute('class', 'node-body');
  body.setAttribute('x', 0); body.setAttribute('y', 0);
  body.setAttribute('width', node.w); body.setAttribute('height', node.h);
  body.setAttribute('fill', c.body);
  body.setAttribute('stroke', c.border);
  g.appendChild(body);

  const header = document.createElementNS(svgNS, 'rect');
  header.setAttribute('x', 0); header.setAttribute('y', 0);
  header.setAttribute('width', node.w); header.setAttribute('height', 24);
  header.setAttribute('rx', 10); header.setAttribute('ry', 10);
  header.setAttribute('fill', c.border);
  header.setAttribute('opacity', '0.35');
  g.appendChild(header);

  const clipPath = document.createElementNS(svgNS, 'clipPath');
  clipPath.setAttribute('id', `clip-${node.id}`);
  const clipRect = document.createElementNS(svgNS, 'rect');
  clipRect.setAttribute('x', 0); clipRect.setAttribute('y', 0);
  clipRect.setAttribute('width', node.w); clipRect.setAttribute('height', 24);
  clipRect.setAttribute('rx', 10); clipRect.setAttribute('ry', 10);
  clipPath.appendChild(clipRect);
  g.appendChild(clipPath);
  header.setAttribute('clip-path', `url(#clip-${node.id})`);

  const title = document.createElementNS(svgNS, 'text');
  title.setAttribute('class', 'node-header');
  title.setAttribute('x', node.w / 2);
  title.setAttribute('y', 16);
  title.setAttribute('fill', c.header);
  title.textContent = node.def.label;
  g.appendChild(title);

  const icon = document.createElementNS(svgNS, 'text');
  icon.setAttribute('class', 'node-icon');
  icon.setAttribute('x', node.w / 2);
  icon.setAttribute('y', node.h / 2 + 8);
  icon.setAttribute('fill', c.header);
  icon.textContent = node.def.icon;
  icon.setAttribute('filter', 'url(#glow)');
  g.appendChild(icon);

  if (node.type === 'painter') {
    const dye = node.params.dye || 'blue';
    const dotC = COLOR_MAP[dye];
    const dot = document.createElementNS(svgNS, 'circle');
    dot.setAttribute('cx', node.w / 2);
    dot.setAttribute('cy', node.h - 14);
    dot.setAttribute('r', 6);
    dot.setAttribute('fill', dotC.fill);
    dot.setAttribute('stroke', dotC.stroke);
    dot.setAttribute('stroke-width', '1.5');
    g.appendChild(dot);
  }

  if (node.type === 'target') {
    const got = node.params.got || 0;
    const need = node.params.need || 0;
    const txt = document.createElementNS(svgNS, 'text');
    txt.setAttribute('class', 'node-status');
    txt.setAttribute('x', node.w / 2);
    txt.setAttribute('y', node.h - 10);
    txt.setAttribute('fill', got >= need ? '#66d98b' : '#8890b8');
    txt.textContent = `${got} / ${need}`;
    g.appendChild(txt);

    if (node.params.require) {
      const miniSvg = materialToSvg(node.params.require, node.w / 2, node.h / 2 + 8, 12);
      const wrap = document.createElementNS(svgNS, 'g');
      wrap.setAttribute('opacity', '0.55');
      wrap.innerHTML = miniSvg;
      g.appendChild(wrap);
    }
  }

  if (node.type === 'source') {
    const remaining = node.params.remaining;
    const txt = document.createElementNS(svgNS, 'text');
    txt.setAttribute('class', 'node-status');
    txt.setAttribute('x', node.w / 2);
    txt.setAttribute('y', node.h - 10);
    txt.textContent = `剩余 ${remaining}`;
    g.appendChild(txt);
  }

  /* 端口 */
  const allPorts = [...node.inputs.map(p => ({ ...p, _list: 'inputs' })),
                    ...node.outputs.map(p => ({ ...p, _list: 'outputs' }))];
  for (const p of allPorts) {
    const pg = document.createElementNS(svgNS, 'g');
    pg.setAttribute('class', 'port');
    pg.setAttribute('data-node-id', node.id);
    pg.setAttribute('data-port-type', p.type);
    pg.setAttribute('data-port-index', p.index);
    pg.setAttribute('transform', `translate(${p.localX}, ${p.localY})`);

    const pc = document.createElementNS(svgNS, 'circle');
    pc.setAttribute('class', 'port-circle');
    pc.setAttribute('r', 7);
    pc.setAttribute('cx', 0); pc.setAttribute('cy', 0);
    pc.setAttribute('fill', p.type === 'in' ? '#2a3258' : '#3a4580');
    pg.appendChild(pc);

    const pl = document.createElementNS(svgNS, 'text');
    pl.setAttribute('class', 'port-label');
    pl.setAttribute('x', p.type === 'in' ? -12 : 12);
    pl.setAttribute('y', 3);
    pl.setAttribute('text-anchor', p.type === 'in' ? 'end' : 'start');
    pl.textContent = node.type === 'joiner' && p.type === 'in'
      ? (p.index === 0 ? 'A' : 'B')
      : String.fromCharCode(65 + p.index);
    pg.appendChild(pl);

    g.appendChild(pg);
  }

  return g;
}

/* =========================================================
   工具栏渲染
   ========================================================= */

function renderToolbox(containerEl, availableTypes) {
  containerEl.innerHTML = '';
  availableTypes.forEach(type => {
    const def = NODE_TYPES[type];
    if (!def.draggable) return;
    const item = document.createElement('div');
    item.className = 'tool-item';
    item.dataset.type = type;
    item.draggable = true;
    const c = def.color;
    item.innerHTML = `
      <div class="tool-icon" style="color:${c.header};background:${c.body};border:1px solid ${c.border}">${def.icon}</div>
      <div class="tool-meta">
        <div class="tool-name">${def.label}</div>
        <div class="tool-desc">${def.desc}</div>
      </div>`;
    containerEl.appendChild(item);
  });
}

if (typeof globalThis !== 'undefined') {
  Object.assign(globalThis, {
    NODE_WIDTH, NODE_HEIGHT, NODE_TYPES,
    NodeGraph, GameNode, renderNodeSvg, renderToolbox,
  });
}
