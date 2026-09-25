/* ============================================================
 * 调度模块：预约校验、时段冲突、每周时长配额、候补补位
 * 规则：同机同时段重叠即挡下；材质/厚度不匹配给出原因；
 *       成员本周时长用完后新预约进候补，取消或结束时依次补位。
 * ============================================================ */
const Scheduler = (() => {
  const OPEN_MIN = 9 * 60;    // 开放 09:00
  const CLOSE_MIN = 21 * 60;  // 关闭 21:00
  const MIN_DURATION = 15;    // 最短预约 15 分钟

  function toMinutes(hhmm) {
    const [h, m] = hhmm.split(':').map(Number);
    return h * 60 + m;
  }

  function fmtTime(min) {
    return String(Math.floor(min / 60)).padStart(2, '0') + ':' + String(min % 60).padStart(2, '0');
  }

  // ISO 周键，用于「每周时长」统计
  function weekKey(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const day = (date.getUTCDay() + 6) % 7;
    date.setUTCDate(date.getUTCDate() - day + 3);
    const firstThu = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
    const fDay = (firstThu.getUTCDay() + 6) % 7;
    firstThu.setUTCDate(firstThu.getUTCDate() - fDay + 3);
    const week = 1 + Math.round((date - firstThu) / (7 * 864e5));
    return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
  }

  const overlaps = (a, b) => a.date === b.date && a.start < b.end && b.start < a.end;

  // 同机同时段的在册冲突预约
  function findConflict(state, machineId, cand, ignoreId) {
    return state.bookings.find(b =>
      b.status === 'active' && b.id !== ignoreId &&
      b.machineId === machineId && overlaps(b, cand));
  }

  // 成员在指定周已用的分钟数（只算生效中的预约）
  function usedMinutes(state, memberId, wk) {
    return state.bookings
      .filter(b => b.status === 'active' && b.memberId === memberId && weekKey(b.date) === wk)
      .reduce((s, b) => s + (b.end - b.start), 0);
  }

  function waitlist(state) {
    return state.bookings
      .filter(b => b.status === 'waitlist')
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  // 基础校验：机器-材质-厚度匹配、台面尺寸、时段合法性。返回原因或 null
  function validateBasics(cfg, p) {
    const machine = cfg.machines.find(m => m.id === p.machineId);
    const material = cfg.materials.find(m => m.id === p.materialId);
    if (!machine || !material) return '请选择机器和材料';

    const supported = machine.supports[p.materialId];
    if (!supported) return `「${machine.name}」不支持切割「${material.name}」，请更换机器或材料`;
    if (!supported.includes(p.thickness)) {
      return `厚度不匹配：「${machine.name}」切割「${material.name}」仅支持 ${supported.join('、')}mm，所选 ${p.thickness}mm 无法加工`;
    }

    const [bw, bh] = machine.bed;
    if (!((p.w <= bw && p.h <= bh) || (p.w <= bh && p.h <= bw))) {
      return `工件 ${p.w}×${p.h}mm 超出「${machine.name}」台面 ${bw}×${bh}mm`;
    }

    if (!(p.end > p.start)) return '结束时间必须晚于开始时间';
    if (p.end - p.start < MIN_DURATION) return `预约时长至少 ${MIN_DURATION} 分钟`;
    if (p.start < OPEN_MIN || p.end > CLOSE_MIN) return `开放时段为 ${fmtTime(OPEN_MIN)}–${fmtTime(CLOSE_MIN)}`;
    return null;
  }

  // 尝试让一条预约生效：依次查冲突、配额、库存
  function tryActivate(state, cfg, booking) {
    const conflict = findConflict(state, booking.machineId, booking, booking.id);
    if (conflict) return { ok: false, why: 'conflict' };

    const member = cfg.members.find(m => m.id === booking.memberId);
    const used = usedMinutes(state, booking.memberId, weekKey(booking.date));
    if (used + (booking.end - booking.start) > member.quota) return { ok: false, why: 'quota' };

    if (!Inventory.canFulfill(state, booking.materialId, booking.thickness, booking.w, booking.h)) {
      return { ok: false, why: 'stock' };
    }
    booking.consumed = Inventory.consume(state, booking.materialId, booking.thickness, booking.w, booking.h);
    booking.status = 'active';
    return { ok: true };
  }

  // 新建预约。返回 { ok, waitlisted?, booking?, message? , reason? }
  function createBooking(state, cfg, p) {
    const err = validateBasics(cfg, p);
    if (err) return { ok: false, reason: err };

    const conflict = findConflict(state, p.machineId, p, null);
    if (conflict) {
      const who = cfg.members.find(m => m.id === conflict.memberId).name;
      return { ok: false, reason: `时段冲突：${conflict.date.slice(5)} ${fmtTime(conflict.start)}–${fmtTime(conflict.end)} 已被 ${who} 预约` };
    }

    const material = cfg.materials.find(m => m.id === p.materialId);
    if (!Inventory.canFulfill(state, p.materialId, p.thickness, p.w, p.h)) {
      return { ok: false, reason: `库存不足：「${material.name} ${p.thickness}mm」的余料和整板都放不下 ${p.w}×${p.h}mm 的工件` };
    }

    const booking = {
      id: 'b' + (state.seq++),
      ...p,
      purpose: p.purpose || '—',
      status: 'waitlist',
      consumed: null,
      createdAt: Date.now(),
    };
    state.bookings.push(booking);

    const member = cfg.members.find(m => m.id === p.memberId);
    const used = usedMinutes(state, p.memberId, weekKey(p.date));
    const dur = p.end - p.start;
    if (used + dur > member.quota) {
      const pos = waitlist(state).findIndex(b => b.id === booking.id) + 1;
      return { ok: true, waitlisted: true, booking,
        message: `${member.name} 本周时长仅剩 ${member.quota - used} 分钟，不足本次 ${dur} 分钟，已进入候补（第 ${pos} 位）` };
    }

    const res = tryActivate(state, cfg, booking);
    if (!res.ok) { // 预检都过了，理论上不会到这里；兜底进候补
      return { ok: true, waitlisted: true, booking, message: '已加入候补队列' };
    }
    return { ok: true, waitlisted: false, booking,
      message: `预约成功：${p.date.slice(5)} ${fmtTime(p.start)}–${fmtTime(p.end)}，${Inventory.describe(booking.consumed)}` };
  }

  // 取消：生效中的预约退回用料，然后依次补位
  function cancel(state, cfg, id) {
    const b = state.bookings.find(x => x.id === id);
    if (!b || b.status === 'cancelled' || b.status === 'done') return null;
    if (b.status === 'active' && b.consumed) Inventory.restore(state, b.consumed);
    b.status = 'cancelled';
    return { booking: b, promoted: promoteWaitlist(state, cfg) };
  }

  // 结束：用料不退（已切割），释放时段后依次补位
  function finish(state, cfg, id) {
    const b = state.bookings.find(x => x.id === id);
    if (!b || b.status !== 'active') return null;
    b.status = 'done';
    return { booking: b, promoted: promoteWaitlist(state, cfg) };
  }

  // 按入队顺序尝试转正候补（冲突、配额、库存任一不满足则继续等待）
  function promoteWaitlist(state, cfg) {
    const promoted = [];
    for (const b of waitlist(state)) {
      if (tryActivate(state, cfg, b).ok) promoted.push(b);
    }
    return promoted;
  }

  return { OPEN_MIN, CLOSE_MIN, toMinutes, fmtTime, weekKey, usedMinutes, waitlist, createBooking, cancel, finish };
})();
