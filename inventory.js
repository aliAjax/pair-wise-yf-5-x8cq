/**
 * inventory.js —— 板材库存
 *
 * 库存按「材料@厚度」分桶，每桶有：
 *   sheets   整板数量
 *   remnants 余料列表 [{id, w, h}]
 *
 * 扣料规则：先找够大的余料（允许旋转 90°），没有才动整板；
 * 无论切余料还是整板，剩下的可用边角（两条边都 >= MIN_REMNANT）都会回记库存。
 * 取消预约时按分配记录原样退回。
 */
const Inventory = (() => {
  const MIN_REMNANT = 100; // mm，小于此尺寸的边角不回收

  const key = (materialId, thickness) => `${materialId}@${thickness}`;

  function getStock(state, materialId, thickness) {
    const mat = state.materials.find(m => m.id === materialId);
    if (!mat) return null;
    const k = key(materialId, thickness);
    if (!mat.stock[k]) mat.stock[k] = { sheets: 0, remnants: [] };
    return mat.stock[k];
  }

  /** 板料 board 上能否放下 w×h 的工件（允许旋转），返回实际摆放的 [宽, 高] 或 null */
  function fitDims(board, w, h) {
    if (board.w >= w && board.h >= h) return [w, h];
    if (board.w >= h && board.h >= w) return [h, w];
    return null;
  }

  /** 从 W×H 板料的角落切下 pw×ph，返回可回收的边角（右侧长条 + 底部余料） */
  function offcuts(state, W, H, pw, ph) {
    const strips = [
      { w: W - pw, h: H },   // 右侧长条
      { w: pw, h: H - ph },  // 底部余料
    ];
    return strips
      .filter(s => s.w >= MIN_REMNANT && s.h >= MIN_REMNANT)
      .map(s => ({ id: 'r' + (state.seq++), w: s.w, h: s.h }));
  }

  /**
   * 扣料。成功返回 { ok:true, allocation }，失败返回 { ok:false, reason }。
   * allocation 记录本次动作，供取消时 release 原样回滚。
   */
  function allocate(state, materialId, thickness, w, h) {
    const mat = state.materials.find(m => m.id === materialId);
    const stock = getStock(state, materialId, thickness);

    // 1. 余料优先
    const idx = stock.remnants.findIndex(r => fitDims(r, w, h));
    if (idx >= 0) {
      const rem = stock.remnants.splice(idx, 1)[0];
      const [pw, ph] = fitDims(rem, w, h);
      const added = offcuts(state, rem.w, rem.h, pw, ph);
      stock.remnants.push(...added);
      return { ok: true, allocation: { kind: 'remnant', materialId, thickness, removed: rem, added } };
    }

    // 2. 整板
    if (stock.sheets > 0) {
      const dims = fitDims(mat.sheet, w, h);
      if (!dims) {
        return { ok: false, reason: `${mat.name}整板 ${mat.sheet.w}×${mat.sheet.h}mm 放不下 ${w}×${h}mm 的用料` };
      }
      stock.sheets -= 1;
      const added = offcuts(state, mat.sheet.w, mat.sheet.h, dims[0], dims[1]);
      stock.remnants.push(...added);
      return { ok: true, allocation: { kind: 'sheet', materialId, thickness, added } };
    }

    return { ok: false, reason: `${mat.name} ${thickness}mm 库存不足：没有够大的余料，整板也已用完` };
  }

  /** 取消预约时退回材料：撤掉本次产生的边角，恢复被消耗的余料或整板 */
  function release(state, allocation) {
    const stock = getStock(state, allocation.materialId, allocation.thickness);
    for (const r of allocation.added) {
      const i = stock.remnants.findIndex(x => x.id === r.id);
      if (i >= 0) stock.remnants.splice(i, 1); // 边角可能已被后续预约用掉，找不到就跳过
    }
    if (allocation.kind === 'remnant') {
      stock.remnants.push(allocation.removed);
    } else {
      stock.sheets += 1;
    }
  }

  return { key, getStock, allocate, release, MIN_REMNANT };
})();
