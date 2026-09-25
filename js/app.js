/* ============================================================
 * 页面交互：预置数据、localStorage 持久化、渲染与事件绑定
 * ============================================================ */

// ---- 预置：三台机器、五种板材、四名成员 ----
const CONFIG = {
  machines: [
    { id: 'm1', name: '极光一号', bed: [900, 600], supports: { acrylic: [3, 5], wood: [3, 5], mdf: [3, 6], cardboard: [2, 4] } },
    { id: 'm2', name: '极光二号', bed: [600, 400], supports: { acrylic: [3, 5], wood: [3, 5], leather: [1, 2] } },
    { id: 'm3', name: '极光三号', bed: [300, 200], supports: { cardboard: [2, 4], leather: [1, 2], acrylic: [3] } },
  ],
  materials: [
    { id: 'acrylic',   name: '亚克力',   thicknesses: [3, 5] },
    { id: 'wood',      name: '椴木板',   thicknesses: [3, 5] },
    { id: 'mdf',       name: '密度板',   thicknesses: [3, 6] },
    { id: 'cardboard', name: '瓦楞纸板', thicknesses: [2, 4] },
    { id: 'leather',   name: '皮革',     thicknesses: [1, 2] },
  ],
  members: [
    { id: 'u1', name: '林岚',   quota: 120 },
    { id: 'u2', name: '陈默',   quota: 90 },
    { id: 'u3', name: '苏晴',   quota: 150 },
    { id: 'u4', name: '赵一帆', quota: 60 },
  ],
};

const STORE_KEY = 'laser-makerspace-v1';

function fmtDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ---- 初始库存（整板 600×400mm）----
function seedState() {
  const remnant = (w, h) => ({ id: 'r' + seed.next++, w, h });
  const seed = { next: 1 };
  const s = {
    seq: 100,
    bookings: [],
    inventory: {
      'acrylic|3':   { boards: 4, remnants: [remnant(300, 200), remnant(150, 400)] },
      'acrylic|5':   { boards: 2, remnants: [] },
      'wood|3':      { boards: 3, remnants: [remnant(200, 200)] },
      'wood|5':      { boards: 2, remnants: [] },
      'mdf|3':       { boards: 2, remnants: [] },
      'mdf|6':       { boards: 1, remnants: [] },
      'cardboard|2': { boards: 5, remnants: [] },
      'cardboard|4': { boards: 3, remnants: [remnant(250, 150)] },
      'leather|1':   { boards: 2, remnants: [] },
      'leather|2':   { boards: 1, remnants: [] },
    },
  };
  // 一条示例预约，展示库存消耗与列表效果
  Scheduler.createBooking(s, CONFIG, {
    machineId: 'm1', memberId: 'u1', materialId: 'acrylic', thickness: 3,
    w: 200, h: 150, date: fmtDate(new Date()), start: 10 * 60, end: 11 * 60,
    purpose: '示例：亚克力铭牌',
  });
  return s;
}

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) { /* 损坏则重建 */ }
  return seedState();
}

let state = load();
const save = () => localStorage.setItem(STORE_KEY, JSON.stringify(state));

// ---- 小工具 ----
const $ = sel => document.querySelector(sel);
const machineOf = id => CONFIG.machines.find(m => m.id === id);
const materialOf = id => CONFIG.materials.find(m => m.id === id);
const memberOf = id => CONFIG.members.find(m => m.id === id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function showMsg(text, type) {
  const box = $('#msg');
  box.textContent = text;
  box.className = `msg ${type}`;
  box.hidden = false;
  clearTimeout(showMsg.timer);
  showMsg.timer = setTimeout(() => { box.hidden = true; }, 6000);
}

// ---- 表单：厚度选项随机器+材料联动 ----
function refreshThickness() {
  const m = machineOf($('#f-machine').value);
  const mat = materialOf($('#f-material').value);
  const sel = $('#f-thickness');
  const hint = $('#thickness-hint');
  sel.innerHTML = '';
  if (!m || !mat) { hint.textContent = ''; return; }

  const supported = m.supports[mat.id] || [];
  const usable = mat.thicknesses.filter(t => supported.includes(t));
  for (const t of usable) {
    const opt = document.createElement('option');
    opt.value = t;
    opt.textContent = `${t} mm`;
    sel.appendChild(opt);
  }
  hint.textContent = supported.length
    ? `${m.name} 切${mat.name}支持：${supported.join('、')}mm`
    : `⚠ ${m.name} 不支持切割${mat.name}`;
  hint.classList.toggle('warn', supported.length === 0);
}

// ---- 渲染 ----
function renderMachines() {
  const today = fmtDate(new Date());
  $('#machines').innerHTML = CONFIG.machines.map(m => {
    const todays = state.bookings.filter(b => b.status === 'active' && b.machineId === m.id && b.date === today)
      .sort((a, b) => a.start - b.start);
    const support = Object.entries(m.supports)
      .map(([mat, ts]) => `<span class="chip">${materialOf(mat).name} ${ts.join('/')}</span>`).join('');
    const slots = todays.length
      ? todays.map(b => `<li>${Scheduler.fmtTime(b.start)}–${Scheduler.fmtTime(b.end)} ${memberOf(b.memberId).name}</li>`).join('')
      : '<li class="dim">今日空闲</li>';
    return `<div class="card machine">
      <h3>${m.name}</h3>
      <div class="dim">台面 ${m.bed[0]}×${m.bed[1]}mm</div>
      <div class="chips">${support}</div>
      <ul class="slots">${slots}</ul>
    </div>`;
  }).join('');
}

function renderMembers() {
  const wk = Scheduler.weekKey(fmtDate(new Date()));
  $('#members').innerHTML = CONFIG.members.map(u => {
    const used = Scheduler.usedMinutes(state, u.id, wk);
    const pct = Math.min(100, Math.round(used / u.quota * 100));
    const full = used >= u.quota;
    return `<div class="member">
      <div class="member-row"><strong>${u.name}</strong>
        <span class="${full ? 'bad' : 'dim'}">${used}/${u.quota} 分钟${full ? ' · 已满，新约进候补' : ''}</span></div>
      <div class="bar"><div class="bar-fill ${full ? 'full' : ''}" style="width:${pct}%"></div></div>
    </div>`;
  }).join('');
}

function renderInventory() {
  const rows = [];
  for (const mat of CONFIG.materials) {
    for (const t of mat.thicknesses) {
      const c = state.inventory[Inventory.key(mat.id, t)];
      if (!c) continue;
      const rem = c.remnants.length
        ? c.remnants.map(r => `<span class="chip remnant">${r.w}×${r.h}</span>`).join('')
        : '<span class="dim">无余料</span>';
      rows.push(`<tr>
        <td>${mat.name} ${t}mm</td>
        <td><span class="chip board">整板 × ${c.boards}</span></td>
        <td>${rem}</td>
      </tr>`);
    }
  }
  $('#inventory tbody').innerHTML = rows.join('');
}

function bookingRow(b, pos) {
  const m = machineOf(b.machineId), mat = materialOf(b.materialId), u = memberOf(b.memberId);
  const actions = b.status === 'active'
    ? `<button data-act="finish" data-id="${b.id}">结束</button>
       <button data-act="cancel" data-id="${b.id}" class="ghost">取消</button>`
    : `<button data-act="cancel" data-id="${b.id}" class="ghost">取消候补</button>`;
  const tag = b.status === 'active' ? '<span class="tag ok">生效中</span>' : `<span class="tag wait">候补第 ${pos} 位</span>`;
  return `<tr>
    <td>${tag}</td>
    <td>${m.name}</td>
    <td>${u.name}</td>
    <td>${mat.name} ${b.thickness}mm · ${b.w}×${b.h}</td>
    <td>${b.date.slice(5)} ${Scheduler.fmtTime(b.start)}–${Scheduler.fmtTime(b.end)}</td>
    <td>${esc(b.purpose)}</td>
    <td class="actions">${actions}</td>
  </tr>`;
}

function renderBookings() {
  const active = state.bookings.filter(b => b.status === 'active')
    .sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start);
  const waiting = Scheduler.waitlist(state);
  const rows = [...active.map(b => bookingRow(b)), ...waiting.map((b, i) => bookingRow(b, i + 1))];
  $('#bookings tbody').innerHTML = rows.length
    ? rows.join('')
    : '<tr><td colspan="7" class="dim">暂无预约</td></tr>';
}

function renderAll() {
  renderMachines();
  renderMembers();
  renderInventory();
  renderBookings();
}

// ---- 事件 ----
function onSubmit(e) {
  e.preventDefault();
  const p = {
    memberId: $('#f-member').value,
    machineId: $('#f-machine').value,
    materialId: $('#f-material').value,
    thickness: Number($('#f-thickness').value),
    w: Number($('#f-w').value),
    h: Number($('#f-h').value),
    date: $('#f-date').value,
    start: Scheduler.toMinutes($('#f-start').value),
    end: Scheduler.toMinutes($('#f-end').value),
    purpose: $('#f-purpose').value.trim(),
  };
  if (!p.date || !p.w || !p.h || p.w <= 0 || p.h <= 0) {
    showMsg('请填写完整的日期和尺寸', 'error');
    return;
  }
  const res = Scheduler.createBooking(state, CONFIG, p);
  if (!res.ok) {
    showMsg(res.reason, 'error');
  } else {
    showMsg(res.message, res.waitlisted ? 'warn' : 'success');
    save();
    renderAll();
  }
}

function onTableClick(e) {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const { act, id } = btn.dataset;
  const res = act === 'finish' ? Scheduler.finish(state, CONFIG, id) : Scheduler.cancel(state, CONFIG, id);
  if (!res) return;
  const verb = act === 'finish' ? '已结束' : '已取消';
  const extra = res.promoted.length
    ? `；补位成功：${res.promoted.map(b => `${memberOf(b.memberId).name}（${b.date.slice(5)} ${Scheduler.fmtTime(b.start)}）`).join('、')}`
    : '';
  showMsg(`${verb}${extra}`, 'success');
  save();
  renderAll();
}

function init() {
  // 下拉选项
  $('#f-member').innerHTML = CONFIG.members.map(u => `<option value="${u.id}">${u.name}（每周 ${u.quota} 分钟）</option>`).join('');
  $('#f-machine').innerHTML = CONFIG.machines.map(m => `<option value="${m.id}">${m.name}</option>`).join('');
  $('#f-material').innerHTML = CONFIG.materials.map(m => `<option value="${m.id}">${m.name}</option>`).join('');
  $('#f-date').value = fmtDate(new Date());
  $('#f-start').value = '13:00';
  $('#f-end').value = '14:00';
  refreshThickness();

  $('#f-machine').addEventListener('change', refreshThickness);
  $('#f-material').addEventListener('change', refreshThickness);
  $('#booking-form').addEventListener('submit', onSubmit);
  $('#bookings').addEventListener('click', onTableClick);
  $('#reset').addEventListener('click', () => {
    if (!confirm('清空全部预约与库存变动，恢复初始数据？')) return;
    localStorage.removeItem(STORE_KEY);
    state = seedState();
    save();
    renderAll();
    showMsg('已恢复初始数据', 'success');
  });

  renderAll();
}

document.addEventListener('DOMContentLoaded', init);
