/* =========================================================
   animation.js · 贝塞尔曲线与动画工具
   ========================================================= */

/* -------------------- 三次贝塞尔曲线 -------------------- */

function bezierPoint(p0, p1, p2, p3, t) {
  const u = 1 - t;
  const tt = t * t;
  const uu = u * u;
  const uuu = uu * u;
  const ttt = tt * t;
  return {
    x: uuu * p0.x + 3 * uu * t * p1.x + 3 * u * tt * p2.x + ttt * p3.x,
    y: uuu * p0.y + 3 * uu * t * p1.y + 3 * u * tt * p2.y + ttt * p3.y,
  };
}

function bezierDerivative(p0, p1, p2, p3, t) {
  const u = 1 - t;
  return {
    x: 3 * u * u * (p1.x - p0.x) + 6 * u * t * (p2.x - p1.x) + 3 * t * t * (p3.x - p2.x),
    y: 3 * u * u * (p1.y - p0.y) + 6 * u * t * (p2.y - p1.y) + 3 * t * t * (p3.y - p2.y),
  };
}

/* -------------------- 计算贝塞尔曲线控制点 -------------------- */

/**
 * 根据两端点生成贝塞尔曲线的两个控制点
 * 保持曲线左右舒展，避免交叉
 */
function cubicControlPoints(from, to) {
  const dx = Math.abs(to.x - from.x);
  const offset = Math.max(60, dx * 0.45);

  const cp1 = { x: from.x + offset, y: from.y };
  const cp2 = { x: to.x - offset, y: to.y };
  return [cp1, cp2];
}

/* -------------------- 弧长表（匀速运动关键） -------------------- */

/**
 * 根据 p0-p3 生成弧长采样表
 * 返回 { samples: [{t, len, x, y}], total }
 * samples 中 len 为从起点到该点的累计弧长
 */
function buildArcLengthTable(p0, p1, p2, p3, steps = 120) {
  const samples = [];
  let total = 0;
  let prev = bezierPoint(p0, p1, p2, p3, 0);
  samples.push({ t: 0, len: 0, x: prev.x, y: prev.y });

  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const pt = bezierPoint(p0, p1, p2, p3, t);
    const dx = pt.x - prev.x;
    const dy = pt.y - prev.y;
    const seg = Math.sqrt(dx * dx + dy * dy);
    total += seg;
    samples.push({ t, len: total, x: pt.x, y: pt.y });
    prev = pt;
  }
  return { samples, total };
}

/**
 * 给定从起点行进的距离 d，返回对应曲线上的点
 * 使用二分查找在弧长表中定位
 */
function pointAtDistance(arcTable, d) {
  const { samples, total } = arcTable;
  if (d <= 0) return { x: samples[0].x, y: samples[0].y, t: 0, done: d >= total };
  if (d >= total) {
    const last = samples[samples.length - 1];
    return { x: last.x, y: last.y, t: last.t, done: true };
  }

  let lo = 0, hi = samples.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (samples[mid].len <= d) lo = mid; else hi = mid;
  }

  const s0 = samples[lo], s1 = samples[hi];
  const segLen = s1.len - s0.len;
  const local = segLen === 0 ? 0 : (d - s0.len) / segLen;
  const t = s0.t + (s1.t - s0.t) * local;
  return {
    x: s0.x + (s1.x - s0.x) * local,
    y: s0.y + (s1.y - s0.y) * local,
    t,
    done: false,
  };
}

/**
 * 生成 SVG path 的 d 属性
 */
function bezierToSvgPath(p0, p1, p2, p3) {
  return `M ${p0.x} ${p0.y} C ${p1.x} ${p1.y}, ${p2.x} ${p2.y}, ${p3.x} ${p3.y}`;
}

/* -------------------- 形状渲染（SVG） -------------------- */

/**
 * 根据材料对象生成 SVG 内部元素字符串
 * size 控制整体尺寸
 */
function materialToSvg(m, cx = 0, cy = 0, size = 18) {
  const r = size * 0.8;
  const c = COLOR_MAP[m.color] || COLOR_MAP.red;

  if (m.shape === 'circle') {
    return `<circle class="material-shape" cx="${cx}" cy="${cy}" r="${r}"
      fill="${c.fill}" stroke="${c.stroke}" stroke-width="2"/>`;
  }

  if (m.shape === 'semicircle') {
    const angle = (m.rotation || 0) * 90;
    const rad = angle * Math.PI / 180;
    const rr = r;
    const x0 = cx + Math.cos(rad) * rr;
    const y0 = cy + Math.sin(rad) * rr;
    const rad2 = rad + Math.PI;
    const x1 = cx + Math.cos(rad2) * rr;
    const y1 = cy + Math.sin(rad2) * rr;
    const mx = cx + Math.cos(rad + Math.PI / 2) * rr;
    const my = cy + Math.sin(rad + Math.PI / 2) * rr;
    return `<path class="material-shape" d="M ${x0} ${y0} A ${rr} ${rr} 0 0 1 ${x1} ${y1} L ${mx} ${my} Z"
      fill="${c.fill}" stroke="${c.stroke}" stroke-width="2" stroke-linejoin="round"/>`;
  }

  if (m.shape === 'composite' && m.parts) {
    let svg = '';
    m.parts.forEach((p, i) => {
      const pc = COLOR_MAP[p.color] || COLOR_MAP.red;
      if (p.shape === 'semicircle') {
        const angle = (p.rotation || 0) * 90;
        const rad = angle * Math.PI / 180;
        const rr = r;
        const x0 = cx + Math.cos(rad) * rr;
        const y0 = cy + Math.sin(rad) * rr;
        const rad2 = rad + Math.PI;
        const x1 = cx + Math.cos(rad2) * rr;
        const y1 = cy + Math.sin(rad2) * rr;
        const mx = cx + Math.cos(rad + Math.PI / 2) * rr;
        const my = cy + Math.sin(rad + Math.PI / 2) * rr;
        svg += `<path class="material-shape" d="M ${x0} ${y0} A ${rr} ${rr} 0 0 1 ${x1} ${y1} L ${mx} ${my} Z"
          fill="${pc.fill}" stroke="${pc.stroke}" stroke-width="2" stroke-linejoin="round"/>`;
      }
    });
    return svg;
  }
  return `<circle class="material-shape" cx="${cx}" cy="${cy}" r="${r}" fill="#888"/>`;
}

/* 把材料对象转成文字描述 */
function describeMaterial(m) {
  if (!m) return '空';
  const colorName = { red: '红', blue: '蓝', yellow: '黄', green: '绿', purple: '紫' }[m.color] || m.color;
  if (m.shape === 'circle') return `${colorName}色圆形`;
  if (m.shape === 'semicircle') {
    const dirName = ['上', '右', '下', '左'][m.rotation || 0] || '';
    return `${colorName}色${dirName}半圆`;
  }
  if (m.shape === 'composite') {
    return '拼接(' + m.parts.map(describeMaterial).join('+') + ')';
  }
  return '未知形状';
}

/* -------------------- Canvas 粒子特效 -------------------- */

class FxLayer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.particles = [];
    this.resize();
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.w = rect.width;
    this.h = rect.height;
  }

  emitTrail(x, y, color) {
    for (let i = 0; i < 2; i++) {
      this.particles.push({
        x, y,
        vx: (Math.random() - 0.5) * 1.2,
        vy: (Math.random() - 0.5) * 1.2,
        life: 1,
        decay: 0.04 + Math.random() * 0.03,
        size: 2 + Math.random() * 2,
        color,
      });
    }
  }

  emitBurst(x, y, color, count = 16) {
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + Math.random() * 0.3;
      const sp = 1.5 + Math.random() * 2.5;
      this.particles.push({
        x, y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: 1,
        decay: 0.025,
        size: 2 + Math.random() * 3,
        color,
      });
    }
  }

  tick() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.w, this.h);

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.vx *= 0.94;
      p.vy *= 0.94;
      p.life -= p.decay;
      if (p.life <= 0) { this.particles.splice(i, 1); continue; }

      ctx.globalAlpha = p.life;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
}

if (typeof globalThis !== 'undefined') {
  Object.assign(globalThis, {
    bezierPoint, bezierDerivative, cubicControlPoints,
    buildArcLengthTable, pointAtDistance, bezierToSvgPath,
    materialToSvg, describeMaterial, FxLayer,
  });
}
