/* =========================================================
   levels.js · 关卡配置
   ========================================================= */

const COLOR_MAP = {
  red:    { fill: '#ff5e7a', stroke: '#d63e5a', glow: 'rgba(255,94,122,0.5)' },
  blue:   { fill: '#5aa8ff', stroke: '#3883dc', glow: 'rgba(90,168,255,0.5)' },
  yellow: { fill: '#ffd760', stroke: '#e5b730', glow: 'rgba(255,215,96,0.5)' },
  green:  { fill: '#66d98b', stroke: '#3fb566', glow: 'rgba(102,217,139,0.5)' },
  purple: { fill: '#b285ff', stroke: '#8a5ce6', glow: 'rgba(178,133,255,0.5)' },
};

const LEVELS = [
  /* -------------------------------------------------------
     关卡 1：初识节点 —— 最简单的直线染色流水线
     ------------------------------------------------------- */
  {
    id: 1,
    name: '初识节点',
    intro: '拖入"染色机"，把红圆染成蓝圆，送入右侧目标。',
    tickInterval: 80,
    sources: [
      {
        id: 'src1',
        x: 80, y: 220,
        interval: 10,
        produce: { shape: 'circle', color: 'red' },
        count: 6,
      },
    ],
    targets: [
      {
        id: 'tgt1',
        x: 980, y: 220,
        require: { shape: 'circle', color: 'blue' },
        count: 5,
      },
    ],
    availableNodes: ['painter'],
    hint: '提示：从左侧节点的小圆点（输出端口）拖出导线，连到右侧节点的输入端口。',
  },

  /* -------------------------------------------------------
     关卡 2：一分为二 —— 切割机把圆切成上下两个半圆
     ------------------------------------------------------- */
  {
    id: 2,
    name: '一分为二',
    intro: '切割机把圆切成两个半圆，分别送到两个目标。',
    tickInterval: 80,
    sources: [
      {
        id: 'src1',
        x: 80, y: 260,
        interval: 12,
        produce: { shape: 'circle', color: 'yellow' },
        count: 6,
      },
    ],
    targets: [
      {
        id: 'tgt1',
        x: 980, y: 150,
        require: { shape: 'semicircle', color: 'yellow', rotation: 0 },
        count: 5,
        label: '上半圆',
      },
      {
        id: 'tgt2',
        x: 980, y: 370,
        require: { shape: 'semicircle', color: 'yellow', rotation: 2 },
        count: 5,
        label: '下半圆',
      },
    ],
    availableNodes: ['cutter'],
    hint: '切割机有两个输出：上端口=上半圆（rotation=0），下端口=下半圆（rotation=2）。',
  },

  /* -------------------------------------------------------
     关卡 3：双色工艺 —— 两路流水线 + 染色 + 拼接
     ------------------------------------------------------- */
  {
    id: 3,
    name: '双色工艺',
    intro: '把两个独立的原色圆分别染色，再用拼接机合二为一。',
    tickInterval: 80,
    sources: [
      {
        id: 'src1',
        x: 80, y: 180,
        interval: 14,
        produce: { shape: 'circle', color: 'red' },
        count: 6,
      },
      {
        id: 'src2',
        x: 80, y: 380,
        interval: 14,
        produce: { shape: 'circle', color: 'red' },
        count: 6,
      },
    ],
    targets: [
      {
        id: 'tgt1',
        x: 980, y: 280,
        require: { shape: 'composite', parts: [
          { shape: 'semicircle', color: 'blue',   rotation: 0 },
          { shape: 'semicircle', color: 'yellow', rotation: 2 },
        ]},
        count: 4,
        label: '上蓝下黄',
      },
    ],
    availableNodes: ['painter', 'cutter', 'joiner'],
    hint: '拼接机需要两路输入同时到达才会工作。先把两圆各切一半，染好颜色，再送入拼接机。',
  },

  /* -------------------------------------------------------
     关卡 4：四色拼盘 —— 综合运用所有节点
     ------------------------------------------------------- */
  {
    id: 4,
    name: '四色拼盘',
    intro: '终极挑战：用四个半圆拼出"青红黄紫"扇形。',
    tickInterval: 80,
    sources: [
      {
        id: 'src1',
        x: 80, y: 140,
        interval: 16,
        produce: { shape: 'circle', color: 'red' },
        count: 6,
      },
      {
        id: 'src2',
        x: 80, y: 300,
        interval: 16,
        produce: { shape: 'circle', color: 'blue' },
        count: 6,
      },
    ],
    targets: [
      {
        id: 'tgt1',
        x: 980, y: 220,
        require: { shape: 'composite', parts: [
          { shape: 'semicircle', color: 'green',  rotation: 0 },
          { shape: 'semicircle', color: 'purple', rotation: 2 },
        ]},
        count: 4,
        label: '上绿下紫',
      },
    ],
    availableNodes: ['painter', 'cutter', 'joiner'],
    hint: '提示：染色机可把材料直接染成任意颜色。两个 source 分别染色后切割，选出需要的半圆送入拼接机。颜色可在左侧属性面板点击选择。',
  },
];

/* 混色表（染色机输入颜色 + 染料色 -> 输出颜色） */
const COLOR_MIX = {
  'red+red':       'red',
  'red+blue':      'purple',
  'red+yellow':    'yellow',
  'red+green':     'green',
  'red+purple':    'purple',
  'blue+red':      'purple',
  'blue+blue':     'blue',
  'blue+yellow':   'green',
  'blue+green':    'green',
  'blue+purple':   'purple',
  'yellow+red':    'yellow',
  'yellow+blue':   'green',
  'yellow+yellow': 'yellow',
  'yellow+green':  'green',
  'yellow+purple': 'purple',
  'green+red':     'green',
  'green+blue':    'green',
  'green+yellow':  'green',
  'green+green':   'green',
  'green+purple':  'purple',
  'purple+red':    'purple',
  'purple+blue':   'purple',
  'purple+yellow': 'purple',
  'purple+green':  'purple',
  'purple+purple': 'purple',
};

function mixColor(base, dye) {
  const key = `${base}+${dye}`;
  return COLOR_MIX[key] || dye;
}

/* 比较两个材料是否匹配目标（用于 target 判定） */
function matchMaterial(requirement, actual) {
  if (!actual) return false;
  if (requirement.shape !== actual.shape) return false;

  if (requirement.shape === 'composite') {
    if (!actual.parts || actual.parts.length !== requirement.parts.length) return false;
    for (let i = 0; i < requirement.parts.length; i++) {
      const rp = requirement.parts[i];
      const ap = actual.parts[i];
      if (rp.shape !== ap.shape) return false;
      if (rp.color !== ap.color) return false;
      if (rp.rotation !== undefined && rp.rotation !== ap.rotation) return false;
    }
    return true;
  } else {
    if (requirement.color && requirement.color !== actual.color) return false;
    if (requirement.rotation !== undefined && requirement.rotation !== actual.rotation) return false;
    return true;
  }
}

/* 工具：生成唯一 ID */
function uid(prefix = 'id') {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}

if (typeof globalThis !== 'undefined') {
  Object.assign(globalThis, { LEVELS, COLOR_MAP, COLOR_MIX, mixColor, matchMaterial, uid });
}
