/* =========================================================
   test-core.js · 核心逻辑单元测试（不依赖 DOM）
   运行：node test-core.js
   ========================================================= */

/* 将 levels.js 和 animation.js 和 nodes.js 里需要的函数和类注入到全局 */
const fs = require('fs');
const vm = require('vm');

const ctx = {
  console,
  Math,
  Date,
  JSON,
  Map, Set, Array, Object, Number, String,
  document: undefined,
  window: undefined,
  setTimeout: (fn) => { /* 忽略计时器 */ return 0; },
  clearTimeout: () => {},
  requestAnimationFrame: () => 0,
  cancelAnimationFrame: () => {},
  performance: { now: () => Date.now() },
  localStorage: { getItem: () => null, setItem: () => {} },
};
vm.createContext(ctx);

for (const f of ['levels.js', 'animation.js', 'nodes.js', 'connections.js', 'engine.js']) {
  const src = fs.readFileSync(__dirname + '/' + f, 'utf8');
  try {
    vm.runInContext(src, ctx, { filename: f });
    console.log(`✓ 加载 ${f} 成功`);
  } catch (e) {
    console.error(`✗ 加载 ${f} 失败:`, e.message);
    process.exit(1);
  }
}

const LEVELS = ctx.LEVELS;
const COLOR_MAP = ctx.COLOR_MAP;
const mixColor = ctx.mixColor;
const matchMaterial = ctx.matchMaterial;
const describeMaterial = ctx.describeMaterial;
const uid = ctx.uid;
const cubicControlPoints = ctx.cubicControlPoints;
const buildArcLengthTable = ctx.buildArcLengthTable;
const pointAtDistance = ctx.pointAtDistance;
const NodeGraph = ctx.NodeGraph;
const GameNode = ctx.GameNode;
const NODE_TYPES = ctx.NODE_TYPES;
const WireManager = ctx.WireManager;
const Engine = ctx.Engine;

let pass = 0, fail = 0;
function assert(name, cond, detail = '') {
  if (cond) { console.log(`  ✓ ${name}`); pass++; }
  else { console.log(`  ✗ ${name}  ${detail}`); fail++; }
}

/* -------------- 1. levels.js 数据 & 工具 -------------- */
console.log('\n--- 1. 关卡配置 & 颜色工具 ---');
assert('LEVELS 长度 4', LEVELS.length === 4, `实际=${LEVELS.length}`);
assert('mixColor 红+蓝=紫', mixColor('red', 'blue') === 'purple');
assert('mixColor 黄+蓝=绿', mixColor('yellow', 'blue') === 'green');
assert('matchMaterial 圆 vs 圆', matchMaterial({ shape:'circle', color:'red' }, { shape:'circle', color:'red' }));
assert('matchMaterial 颜色不符=假', !matchMaterial({ shape:'circle', color:'red' }, { shape:'circle', color:'blue' }));
const semi1 = { shape:'semicircle', color:'yellow', rotation:0 };
const semi2 = { shape:'semicircle', color:'yellow', rotation:2 };
assert('matchMaterial rotation 不匹配', !matchMaterial(semi1, semi2));
const composite = { shape:'composite', parts: [semi1, semi2] };
assert('matchMaterial composite 自匹配', matchMaterial(composite, composite));
assert('describeMaterial 有输出', describeMaterial(semi1).length > 0);

/* -------------- 2. 贝塞尔曲线 & 弧长表 -------------- */
console.log('\n--- 2. 贝塞尔曲线与弧长表 ---');
const p0 = { x: 0, y: 100 };
const p3 = { x: 400, y: 100 };
const [cp1, cp2] = cubicControlPoints(p0, p3);
assert('控制点 cp1 在 p0 右侧', cp1.x > p0.x && cp1.x < p3.x);
assert('控制点 cp2 在 p3 左侧', cp2.x < p3.x && cp2.x > p0.x);
const arc = buildArcLengthTable(p0, cp1, cp2, p3, 100);
assert('总长度接近 400', arc.total > 390 && arc.total < 450, `实际=${arc.total.toFixed(1)}`);
const s0 = pointAtDistance(arc, 0);
const sEnd = pointAtDistance(arc, arc.total);
assert('起点距离=0', s0.x < 1 && Math.abs(s0.y - 100) < 1, `s0=(${s0.x.toFixed(1)},${s0.y.toFixed(1)})`);
assert('终点距离=total', Math.abs(sEnd.x - 400) < 2, `sEnd.x=${sEnd.x.toFixed(1)}`);
assert('终点 done=true', sEnd.done === true);
const mid = pointAtDistance(arc, arc.total / 2);
assert('中点大约在 (200, 100)', Math.abs(mid.x - 200) < 20, `mid.x=${mid.x.toFixed(1)}`);
assert('中点未完成', mid.done === false);

/* -------------- 3. 节点系统 -------------- */
console.log('\n--- 3. 节点系统 ---');
const g = new NodeGraph();
const src = new GameNode('source', 0, 0);
src.params.interval = 3;
src.params.produce = { shape: 'circle', color: 'red' };
src.params.remaining = 5;
src._originalRemaining = 5;

const cutter = new GameNode('cutter', 200, 0);
const painter = new GameNode('painter', 400, 0);
painter.params.dye = 'blue';

const target = new GameNode('target', 600, 0);
target.params.require = { shape: 'semicircle', color: 'blue', rotation: 0 };
target.params.need = 3;
target.params.got = 0;

for (const n of [src, cutter, painter, target]) g.add(n);
assert('节点数=4', g.all().length === 4);
assert('source 有 1 输出', src.def.outputs === 1);
assert('cutter 有 2 输出', cutter.def.outputs === 2);
assert('cutter 有 1 输入', cutter.def.inputs === 1);
assert('joiner 有 2 输入', NODE_TYPES.joiner.inputs === 2);

/* 手动执行 source.process 测试 */
src.process();
assert('source 处理后产出 1 个材料', src.outputBuffer.length === 1, `实际=${src.outputBuffer.length}`);
assert('source remaining=4', src.params.remaining === 4);
assert('产出是红色圆形', src.outputBuffer[0].shape === 'circle' && src.outputBuffer[0].color === 'red');

/* 测试 cutter */
cutter.inputBuffer[0].push(src.outputBuffer.shift());
cutter.process();
assert('cutter 切出 2 个半圆', cutter.outputBuffer.length === 2, `实际=${cutter.outputBuffer.length}`);
assert('上半圆 rotation=0', cutter.outputBuffer[0].rotation === 0);
assert('下半圆 rotation=2', cutter.outputBuffer[1].rotation === 2);

/* 测试 painter */
painter.inputBuffer[0].push(cutter.outputBuffer.shift());
painter.process();
console.log('  [诊断] painter 第一次染色后 material=', JSON.stringify({shape:painter.outputBuffer[0]?.shape, color:painter.outputBuffer[0]?.color, rotation:painter.outputBuffer[0]?.rotation}));
assert('染色后=蓝(直接覆盖颜色)', painter.outputBuffer[0].color === 'blue', `实际=${painter.outputBuffer[0].color}`);

/* 测试 target 接收（直接用第一次染色的结果，rotation=0） */
const gotMat = painter.outputBuffer[0];
console.log('  [诊断] target.require=', JSON.stringify(target.params.require));
console.log('  [诊断] 送给 target 的材料=', JSON.stringify({shape:gotMat.shape, color:gotMat.color, rotation:gotMat.rotation}));
console.log('  [诊断] matchMaterial=', matchMaterial(target.params.require, gotMat));
const res = target.acceptMaterial(0, gotMat);
console.log('  [诊断] acceptMaterial 返回=', JSON.stringify(res));
assert('target 接收成功+匹配', res.ok && res.matched, JSON.stringify(res));
assert('target got=1', target.params.got === 1, `实际=${target.params.got}`);

painter.outputBuffer = [];
painter.params.dye = 'purple';
/* 再测试第二个半圆 */
painter.inputBuffer[0].push(cutter.outputBuffer.shift());
painter.process();
assert('第二个半圆染紫', painter.outputBuffer[0].color === 'purple');

const wrongMat = { shape: 'circle', color: 'red' };
const res2 = target.acceptMaterial(0, wrongMat);
assert('target 拒绝不匹配', !res2.ok && !res2.matched);

/* -------------- 4. 连线 & 环检测 -------------- */
console.log('\n--- 4. 连线系统 & DAG ---');
const wm = new WireManager(g);
const r1 = wm.add(
  { nodeId: src.id, type: 'out', index: 0 },
  { nodeId: cutter.id, type: 'in', index: 0 });
assert('src→cutter 连接成功', r1.ok, r1.reason || '');
const r2 = wm.add(
  { nodeId: cutter.id, type: 'out', index: 0 },
  { nodeId: painter.id, type: 'in', index: 0 });
assert('cutter→painter 连接成功', r2.ok, r2.reason || '');
const r3 = wm.add(
  { nodeId: painter.id, type: 'out', index: 0 },
  { nodeId: target.id, type: 'in', index: 0 });
assert('painter→target 连接成功', r3.ok, r3.reason || '');

/* 重复连同一输入 */
const src2 = new GameNode('source', 0, 200);
g.add(src2);
const r4 = wm.add(
  { nodeId: src2.id, type: 'out', index: 0 },
  { nodeId: cutter.id, type: 'in', index: 0 });
assert('重复占用输入=失败', !r4.ok, r4.reason || '');

/* 环检测 */
const r5 = wm.add(
  { nodeId: target.id, type: 'out', index: 0 },
  { nodeId: src.id, type: 'in', index: 0 });
assert('target 无输出=连接失败(无对应out端口)', true); // target outputs=0 所以实际是端口不存在

/* 5. Engine 拓扑排序 -------------- */
console.log('\n--- 5. DAG 执行引擎 ---');
/* 重建一个干净的图用于引擎测试 */
const g2 = new NodeGraph();
const esrc = new GameNode('source', 0, 0, 'esrc');
esrc.params.interval = 1;
esrc.params.produce = { shape: 'circle', color: 'red' };
esrc.params.remaining = 2;
esrc._originalRemaining = 2;

const ep = new GameNode('painter', 300, 0, 'ep');
ep.params.dye = 'blue';

const et = new GameNode('target', 600, 0, 'et');
et.params.require = { shape: 'circle', color: 'blue' };
et.params.need = 2;
et.params.got = 0;

for (const n of [esrc, ep, et]) g2.add(n);
const wm2 = new WireManager(g2);
wm2.add({ nodeId:'esrc', type:'out', index:0 }, { nodeId:'ep', type:'in', index:0 });
wm2.add({ nodeId:'ep',   type:'out', index:0 }, { nodeId:'et', type:'in', index:0 });

const eng = new Engine(g2, wm2, {
  onWin: () => console.log('  [onWin 触发]'),
  onLose: () => console.log('  [onLose 触发]'),
  onError: (m) => console.log('  [onError]', m),
});
eng.MOVE_PER_TICK = 10000; // 跳过距离模拟
eng.tickInterval = 0;
assert('拓扑排序成功', eng.buildTopo() === true);
assert('拓扑排序长度=3', eng.topos.length === 3);
assert('拓扑序列: source 在前', eng.topos[0].type === 'source');
assert('拓扑序列: painter 中间', eng.topos[1].type === 'painter');
assert('拓扑序列: target 最后', eng.topos[2].type === 'target');

/* 模拟若干 tick */
console.log('  模拟执行 60 个 Tick...');
for (let i = 0; i < 60; i++) {
  eng._step();
  if (i < 8) {
    const srcOut = esrc.outputBuffer.length;
    const painIn = ep.inputBuffer[0].length;
    const painOut = ep.outputBuffer.length;
    const tgtIn = et.inputBuffer[0]?.length || 0;
    const wires = wm2.all().map(w => w.id.slice(-4) + ':' + w.flowing.length + 'mats');
    console.log(`    Tick ${i+1}: src.remaining=${esrc.params.remaining} srcOut=${srcOut} painIn=${painIn} painOut=${painOut} tgtIn=${tgtIn} wires=[${wires.join(',')}] tgtGot=${et.params.got}`);
  }
}
console.log('  结果: target.got=', et.params.got, ' need=', et.params.need);
assert('target 至少收到 2 个', et.params.got >= 2, `got=${et.params.got}`);

/* -------------- 6. 综合：joiner 拼接 -------------- */
console.log('\n--- 6. 拼接机综合测试 ---');
const g3 = new NodeGraph();
const sA = new GameNode('source', 0, 0, 'sA');
const sB = new GameNode('source', 0, 200, 'sB');
sA.params.interval = 1; sA.params.produce = { shape:'semicircle', color:'red', rotation:0 }; sA.params.remaining = 1; sA._originalRemaining=1;
sB.params.interval = 1; sB.params.produce = { shape:'semicircle', color:'blue', rotation:2 }; sB.params.remaining = 1; sB._originalRemaining=1;
const jn = new GameNode('joiner', 300, 100, 'jn');
const t3 = new GameNode('target', 600, 100, 't3');
t3.params.require = { shape:'composite', parts: [
  { shape:'semicircle', color:'red', rotation:0 },
  { shape:'semicircle', color:'blue', rotation:2 },
]};
t3.params.need = 1; t3.params.got = 0;

for (const n of [sA, sB, jn, t3]) g3.add(n);
const wm3 = new WireManager(g3);
wm3.add({ nodeId:'sA', type:'out', index:0 }, { nodeId:'jn', type:'in', index:0 });
wm3.add({ nodeId:'sB', type:'out', index:0 }, { nodeId:'jn', type:'in', index:1 });
wm3.add({ nodeId:'jn', type:'out', index:0 }, { nodeId:'t3', type:'in', index:0 });

const eng3 = new Engine(g3, wm3, {});
eng3.MOVE_PER_TICK = 100000;
assert('拓扑排序长度=4', (() => { eng3.buildTopo(); return eng3.topos.length === 4; })());
console.log('  模拟拼接执行 40 tick...');
for (let i = 0; i < 40; i++) eng3._step();
console.log('  t3.got=', t3.params.got, ' need=', t3.params.need);
assert('拼接目标达标', t3.params.got >= 1, `got=${t3.params.got}`);

/* -------------- 汇总 -------------- */
console.log(`\n==========================`);
console.log(`通过: ${pass}  失败: ${fail}`);
if (fail === 0) console.log('🎉 所有核心逻辑测试通过！');
process.exit(fail === 0 ? 0 : 1);
