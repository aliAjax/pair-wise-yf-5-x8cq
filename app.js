/**
 * app.js —— 页面交互与持久化
 *
 * 全部状态存 localStorage（键 STORAGE_KEY），关掉浏览器再打开记录仍在。
 * 预置：3 台机器、5 种板材、4 名成员。
 */
const STORAGE_KEY = 'laser-makerspace-v1';

/* ---------- 预置数据 ---------- */

function seed() {
  const state = { seq: 1, machines: [], materials: [], members: [], bookings: [] };
  const remnant = (w, h) => ({ id: 'r' + (state.seq++), w, h });

  state.machines = [
    {
      id: 'm1', name: '极光 1390', bed: { w: 1300, h: 900 },
      supports: { acrylic: [2, 10], wood: [3, 12], mdf: [2, 9] },
    },
    {
      id: 'm2', name: '星火 6040', bed: { w: 600, h: 400 },
      supports: { acrylic: [1, 6], wood: [2, 6], paper: [1, 3] },
    },
    {
      id: 'm3', name: '微雕 4030', bed: { w: 400, h: 300 },
      supports: { paper: [1, 3], leather: [1, 4], acrylic: [1, 3] },
    },
  ];

  const mat = (id, name, thicknesses, sheet, stock) => ({ id, name, thicknesses, sheet, stock });
  state.materials = [
    mat('acrylic', '亚克力', [2, 3, 5, 8, 10], { w: 1220, h: 2440 }, {
      'acrylic@2': { sheets: 3, remnants: [] },
      'acrylic@3': { sheets: 4, remnants: [remnant(600, 400), remnant(350, 250)] },
      'acrylic@5': { sheets: 2, remnants: [] },
      'acrylic@8': { sheets: 1, remnants: [] },
      'acrylic@10': { sheets: 1, remnants: [] },
    }),
    mat('wood', '椴木板', [3, 5, 8, 12], { w: 1220, h: 1220 }, {
      'wood@3': { sheets: 5, remnants: [remnant(500, 400)] },
      'wood@5': { sheets: 3, remnants: [] },
      'wood@8': { sheets: 2, remnants: [] },
      'wood@12': { sheets: 1, remnants: [] },
    }),
    mat('mdf', '密度板', [2, 3, 5, 9], { w: 1220, h: 2440 }, {
      'mdf@2': { sheets: 2, remnants: [] },
      'mdf@3': { sheets: 3, remnants: [remnant(800, 300)] },
      'mdf@5': { sheets: 2, remnants: [] },
      'mdf@9': { sheets: 1, remnants: [] },
    }),
    mat('paper', '卡纸', [1, 2, 3], { w: 787, h: 1092 }, {
      'paper@1': { sheets: 10, remnants: [] },
      'paper@2': { sheets: 8, remnants: [remnant(400, 300)] },
      'paper@3': { sheets: 5, remnants: [] },
    }),
    mat('leather', '皮革', [1, 2, 4], { w: 900, h: 900 }, {
      'leather@1': { sheets: 3, remnants: [] },
      'leather@2': { sheets: 2, remnants: [] },
      'leather@4': { sheets: 1, remnants: [remnant(450, 300)] },
    }),
  ];

  state.members = [
    { id: 'u1', name: '林小满', weeklyQuota: 6 },
    { id: 'u2', name: '陈屿', weeklyQuota: 4 },
    { id: 'u3', name: '赵一鸣', weeklyQuota: 8 },
    { id: 'u4', name: '苏晚', weeklyQuota: 5 },
  ];

  return state;
}

/* ---------- 持久化 ---------- */

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

let state = load() || seed();
save();

/* ---------- 小工具 ---------- */

const $ = sel => document.querySelector(sel);

const fmtDT = s => {
  const d = new Date(s);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const fmtH = h => (Math.round(h * 10) / 10).toString();

const matName = id => (state.materials.find(m => m.id === id) || {}).name || id;
const machineName = id => (state.machines.find(m => m.id === id) || {}).name || id;
const memberName = id => (state.members.find(m => m.id === id) || {}).name || id;

const STATUS_TEXT = {
  confirmed: '已确认',
  waitlist: '候补中',
  completed: '已完成',
  cancelled: '已取消',
};

function showMsg(lines, kind) {
  const box = $('#msg');
  box.className = kind;
  box.innerHTML = lines.length === 1
    ? lines[0]
    : `<ul>${lines.map(l => `<li>${l}</li>`).join('')}</ul>`;
}

/* ---------- 渲染 ---------- */

function renderMachines() {
  $('#machines').innerHTML = state.machines.map(m => {
    const supports = Object.entries(m.supports)
      .map(([id, [lo, hi]]) => `<span class="tag">${matName(id)} ${lo}–${hi}mm</span>`)
      .join('');
    return `<div class="card">
      <div class="name">${m.name}</div>
      <div class="sub">台面 ${m.bed.w}×${m.bed.h}mm</div>
      <div class="sub">${supports}</div>
    </div>`;
  }).join('');
}

function renderMembers() {
  const refDate = $('#f-start').value || new Date().toISOString();
  $('#member-week').textContent = `（按预约起始日所在周统计）`;
  $('#members').innerHTML = state.members.map(u => {
    const used = Scheduler.usedHours(state, u.id, refDate);
    const pct = Math.min(100, Math.round(used / u.weeklyQuota * 100));
    const full = used >= u.weeklyQuota;
    return `<div class="card">
      <div class="name">${u.name} ${full ? '<span class="tag hot">本周已满</span>' : ''}</div>
      <div class="sub">已用 ${fmtH(used)} / ${u.weeklyQuota} 小时</div>
      <div class="quota-bar"><i class="${full ? 'full' : ''}" style="width:${pct}%"></i></div>
    </div>`;
  }).join('');
}

function renderInventory() {
  $('#inventory').innerHTML = state.materials.map(mat => {
    const rows = mat.thicknesses.map(th => {
      const stock = Inventory.getStock(state, mat.id, th);
      const remnants = stock.remnants.length
        ? stock.remnants.map(r => `<span class="tag">${r.w}×${r.h}</span>`).join('')
        : '<span class="remnants">无</span>';
      return `<tr>
        <td>${th}mm</td>
        <td>${stock.sheets} 张</td>
        <td>${remnants}</td>
      </tr>`;
    }).join('');
    return `<div class="card" style="margin-bottom:10px">
      <div class="name">${mat.name} <span class="remnants">整板 ${mat.sheet.w}×${mat.sheet.h}mm</span></div>
      <table>
        <thead><tr><th>厚度</th><th>整板</th><th>余料（宽×高 mm）</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
  }).join('');
}

function renderBookings() {
  const list = [...state.bookings].sort((a, b) => b.createdAt - a.createdAt);
  if (!list.length) {
    $('#bookings').innerHTML = '<div class="empty">还没有预约记录</div>';
    return;
  }
  const rows = list.map(b => {
    const src = b.allocation
      ? (b.allocation.kind === 'remnant' ? '余料' : '整板')
      : '—';
    const actions =
      b.status === 'confirmed'
        ? `<button class="small complete" data-id="${b.id}">结束</button>
           <button class="small cancel" data-id="${b.id}">取消</button>`
        : b.status === 'waitlist'
          ? `<button class="small cancel" data-id="${b.id}">取消</button>`
          : '';
    return `<tr>
      <td>${memberName(b.memberId)}</td>
      <td>${machineName(b.machineId)}</td>
      <td>${matName(b.materialId)} ${b.thickness}mm<br><span class="remnants">${b.width}×${b.height}mm · 用${src}</span></td>
      <td>${fmtDT(b.start)}<br>— ${fmtDT(b.end)}（${fmtH(b.hours)}h）</td>
      <td>${b.purpose}</td>
      <td><span class="badge b-${b.status}">${STATUS_TEXT[b.status]}</span></td>
      <td style="white-space:nowrap">${actions}</td>
    </tr>`;
  }).join('');
  $('#bookings').innerHTML = `<table>
    <thead><tr><th>成员</th><th>机器</th><th>材料 / 尺寸</th><th>时段</th><th>用途</th><th>状态</th><th>操作</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function renderAll() {
  renderMachines();
  renderMembers();
  renderInventory();
  renderBookings();
}

/* ---------- 表单 ---------- */

function fillSelect(sel, items, label) {
  $(sel).innerHTML = items.map(x => `<option value="${x.id}">${x[label]}</option>`).join('');
}

function refreshThicknesses() {
  const mat = state.materials.find(m => m.id === $('#f-material').value);
  $('#f-thickness').innerHTML = (mat ? mat.thicknesses : [])
    .map(t => `<option value="${t}">${t}</option>`).join('');
}

function defaultTimes() {
  const start = new Date();
  start.setMinutes(0, 0, 0);
  start.setHours(start.getHours() + 1);
  const end = new Date(start.getTime() + 3600000);
  const toLocal = d => {
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  $('#f-start').value = toLocal(start);
  $('#f-end').value = toLocal(end);
}

function notifyPromoted(promoted) {
  if (promoted && promoted.length) {
    showMsg(promoted.map(b => `候补补位成功：${memberName(b.memberId)} 的「${b.purpose}」（${fmtDT(b.start)}）已确认并扣料`), 'ok');
  }
}

/* ---------- 事件 ---------- */

$('#booking-form').addEventListener('submit', e => {
  e.preventDefault();
  const data = {
    memberId: $('#f-member').value,
    machineId: $('#f-machine').value,
    materialId: $('#f-material').value,
    thickness: $('#f-thickness').value,
    width: $('#f-width').value,
    height: $('#f-height').value,
    start: $('#f-start').value,
    end: $('#f-end').value,
    purpose: $('#f-purpose').value,
  };
  const res = Scheduler.create(state, data);
  if (!res.ok) {
    showMsg(res.errors, 'error');
    return;
  }
  save();
  if (res.waitlisted) {
    showMsg([`${memberName(data.memberId)}本周时长已用完（已用 ${fmtH(res.used)} / ${res.quota} 小时），预约已进入候补队列，有名额时按顺序自动补位`], 'warn');
  } else {
    const src = res.booking.allocation.kind === 'remnant' ? '余料' : '整板';
    showMsg([`预约成功，已消耗${src}（余料优先），可用边角已回记库存`], 'ok');
  }
  $('#f-purpose').value = '';
  renderAll();
});

$('#bookings').addEventListener('click', e => {
  const id = e.target.dataset.id;
  if (!id) return;
  let result = null;
  if (e.target.classList.contains('cancel')) result = Scheduler.cancel(state, id);
  if (e.target.classList.contains('complete')) result = Scheduler.complete(state, id);
  if (result) {
    save();
    renderAll();
    notifyPromoted(result.promoted);
  }
});

$('#f-material').addEventListener('change', refreshThicknesses);
$('#f-start').addEventListener('change', renderMembers);

$('#reset').addEventListener('click', () => {
  if (!confirm('清空全部预约与库存变动，恢复预置数据？')) return;
  localStorage.removeItem(STORAGE_KEY);
  state = seed();
  save();
  $('#msg').className = '';
  renderAll();
});

/* ---------- 启动 ---------- */

fillSelect('#f-member', state.members, 'name');
fillSelect('#f-machine', state.machines, 'name');
fillSelect('#f-material', state.materials, 'name');
refreshThicknesses();
defaultTimes();
renderAll();
