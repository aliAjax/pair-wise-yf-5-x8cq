/**
 * scheduler.js —— 预约调度
 *
 * 规则：
 *  - 同机时段重叠 → 直接挡下（报错，不进候补）；
 *  - 机器不支持该材质 / 厚度超出机器范围 / 工件超出台面 → 说明原因；
 *  - 成员当周已用时长 + 本次时长 > 每周额度 → 进入候补队列；
 *  - 有预约取消或结束时，按提交顺序扫描候补队列，满足条件者依次补位。
 * 库存扣减只在预约「确认」时发生（候补转正时才扣料）。
 */
const Scheduler = (() => {

  const hours = (start, end) => (new Date(end) - new Date(start)) / 3600000;

  /** 所在周的周一，作为「周」的键 */
  function weekKey(dateStr) {
    const d = new Date(dateStr);
    const day = (d.getDay() + 6) % 7; // 周一 = 0
    d.setDate(d.getDate() - day);
    return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  }

  const overlaps = (aS, aE, bS, bE) =>
    new Date(aS) < new Date(bE) && new Date(bS) < new Date(aE);

  /** 同机已确认预约中是否存在时段重叠 */
  function conflicts(state, machineId, start, end, excludeId) {
    return state.bookings.some(b =>
      b.machineId === machineId &&
      b.status === 'confirmed' &&
      b.id !== excludeId &&
      overlaps(start, end, b.start, b.end)
    );
  }

  /** 成员在 dateStr 所在周已确认的时长 */
  function usedHours(state, memberId, dateStr) {
    const wk = weekKey(dateStr);
    return state.bookings
      .filter(b => b.memberId === memberId && b.status === 'confirmed' && weekKey(b.start) === wk)
      .reduce((sum, b) => sum + hours(b.start, b.end), 0);
  }

  function supportList(machine, state) {
    return Object.keys(machine.supports)
      .map(id => (state.materials.find(m => m.id === id) || {}).name)
      .filter(Boolean)
      .join('、');
  }

  /** 校验预约数据，返回错误说明数组（空数组 = 通过） */
  function validate(state, data) {
    const errors = [];
    const machine = state.machines.find(m => m.id === data.machineId);
    const material = state.materials.find(m => m.id === data.materialId);
    const member = state.members.find(m => m.id === data.memberId);
    if (!machine) errors.push('请选择机器');
    if (!material) errors.push('请选择材料');
    if (!member) errors.push('请选择成员');
    if (errors.length) return errors;

    const th = Number(data.thickness);
    const w = Number(data.width);
    const h = Number(data.height);

    if (!material.thicknesses.includes(th)) {
      errors.push(`${material.name}没有 ${th}mm 这个厚度，可选：${material.thicknesses.join(' / ')}mm`);
    } else if (!machine.supports[material.id]) {
      errors.push(`${machine.name}不支持切割${material.name}，它支持：${supportList(machine, state)}`);
    } else {
      const [lo, hi] = machine.supports[material.id];
      if (th < lo || th > hi) {
        errors.push(`${machine.name}切${material.name}的厚度范围是 ${lo}–${hi}mm，${th}mm 超出范围`);
      }
    }

    if (!(w > 0) || !(h > 0)) {
      errors.push('尺寸必须为正数');
    } else if (w > machine.bed.w || h > machine.bed.h) {
      errors.push(`工件 ${w}×${h}mm 超出 ${machine.name} 的加工台面 ${machine.bed.w}×${machine.bed.h}mm`);
    }

    const start = new Date(data.start);
    const end = new Date(data.end);
    if (isNaN(start) || isNaN(end)) errors.push('请选择时段');
    else if (end <= start) errors.push('结束时间必须晚于开始时间');

    if (!String(data.purpose).trim()) errors.push('请填写用途');
    return errors;
  }

  /**
   * 创建预约。返回 { ok, errors? , booking?, waitlisted? }。
   * 时段重叠 / 校验失败 → ok:false；额度不够 → ok:true 且 waitlisted:true。
   */
  function create(state, data) {
    const errors = validate(state, data);
    if (errors.length) return { ok: false, errors };

    const machine = state.machines.find(m => m.id === data.machineId);
    if (conflicts(state, data.machineId, data.start, data.end)) {
      return { ok: false, errors: [`${machine.name}在该时段已有预约，同机时段重叠，本次预约被挡下`] };
    }

    const member = state.members.find(m => m.id === data.memberId);
    const duration = hours(data.start, data.end);
    const used = usedHours(state, member.id, data.start);
    const waitlisted = used + duration > member.weeklyQuota;

    const booking = {
      id: 'b' + (state.seq++),
      memberId: data.memberId,
      machineId: data.machineId,
      materialId: data.materialId,
      thickness: Number(data.thickness),
      width: Number(data.width),
      height: Number(data.height),
      start: data.start,
      end: data.end,
      purpose: String(data.purpose).trim(),
      hours: duration,
      status: waitlisted ? 'waitlist' : 'confirmed',
      allocation: null,
      createdAt: state.seq++,
    };

    if (!waitlisted) {
      const alloc = Inventory.allocate(state, booking.materialId, booking.thickness, booking.width, booking.height);
      if (!alloc.ok) return { ok: false, errors: [alloc.reason] };
      booking.allocation = alloc.allocation;
    }

    state.bookings.push(booking);
    return { ok: true, booking, waitlisted, used, quota: member.weeklyQuota };
  }

  /** 取消：确认中的退料，然后触发补位 */
  function cancel(state, id) {
    const b = state.bookings.find(x => x.id === id);
    if (!b || b.status === 'cancelled' || b.status === 'completed') return null;
    if (b.allocation) Inventory.release(state, b.allocation);
    b.status = 'cancelled';
    return { booking: b, promoted: promote(state) };
  }

  /** 结束（加工完成）：材料已消耗不退库，然后触发补位 */
  function complete(state, id) {
    const b = state.bookings.find(x => x.id === id);
    if (!b || b.status !== 'confirmed') return null;
    b.status = 'completed';
    return { booking: b, promoted: promote(state) };
  }

  /** 按提交顺序扫描候补队列，满足 额度够 + 时段不冲突 + 有料 的依次转正 */
  function promote(state) {
    const promoted = [];
    const queue = state.bookings
      .filter(b => b.status === 'waitlist')
      .sort((a, b) => a.createdAt - b.createdAt);

    for (const b of queue) {
      const member = state.members.find(m => m.id === b.memberId);
      if (usedHours(state, b.memberId, b.start) + b.hours > member.weeklyQuota) continue;
      if (conflicts(state, b.machineId, b.start, b.end, b.id)) continue;
      const alloc = Inventory.allocate(state, b.materialId, b.thickness, b.width, b.height);
      if (!alloc.ok) continue;
      b.allocation = alloc.allocation;
      b.status = 'confirmed';
      promoted.push(b);
    }
    return promoted;
  }

  return { create, cancel, complete, promote, usedHours, weekKey, conflicts };
})();
