/* ============================================================
 * 库存模块：整板与余料
 * 规则：优先消耗余料（最佳面积匹配），不够才开整板；
 *       切割剩下的可用边角（任一边 >= MIN_USABLE）自动回记库存。
 * ============================================================ */
const Inventory = (() => {
  const BOARD_W = 600;   // 整板宽 mm
  const BOARD_H = 400;   // 整板高 mm
  const MIN_USABLE = 100; // 可回记边角的最小边长 mm

  const key = (materialId, thickness) => `${materialId}|${thickness}`;

  function combo(state, materialId, thickness) {
    return state.inventory[key(materialId, thickness)] || null;
  }

  // 工件允许旋转，两种摆放方向
  function orientations(w, h) {
    return w === h ? [[w, h]] : [[w, h], [h, w]];
  }

  function fitsIn(srcW, srcH, w, h) {
    return orientations(w, h).some(([pw, ph]) => pw <= srcW && ph <= srcH);
  }

  // 是否有料可用：有匹配余料，或还有整板
  function canFulfill(state, materialId, thickness, w, h) {
    const c = combo(state, materialId, thickness);
    if (!c) return false;
    if (!fitsIn(BOARD_W, BOARD_H, w, h)) return false; // 比整板还大，永远不够
    return c.boards > 0 || c.remnants.some(r => fitsIn(r.w, r.h, w, h));
  }

  // 直切式下料：工件贴角放，剩下右边一条 + 下边一条
  function offcuts(srcW, srcH, pw, ph) {
    const strips = [
      { w: srcW - pw, h: ph },
      { w: srcW, h: srcH - ph },
    ];
    return strips.filter(o => o.w >= MIN_USABLE && o.h >= MIN_USABLE);
  }

  // 消耗一块料，返回消耗记录（取消预约时据此回滚）；无料返回 null
  function consume(state, materialId, thickness, w, h) {
    const c = combo(state, materialId, thickness);
    if (!c) return null;

    // 1) 先找余料：能放下的里面积最小的一块
    let idx = -1, bestArea = Infinity, placed = null;
    c.remnants.forEach((r, i) => {
      for (const [pw, ph] of orientations(w, h)) {
        if (pw <= r.w && ph <= r.h && r.w * r.h < bestArea) {
          idx = i; bestArea = r.w * r.h; placed = [pw, ph];
        }
      }
    });

    if (idx >= 0) {
      const r = c.remnants.splice(idx, 1)[0];
      const added = offcuts(r.w, r.h, placed[0], placed[1])
        .map(o => ({ id: 'r' + (state.seq++), ...o }));
      c.remnants.push(...added);
      return { kind: 'remnant', materialId, thickness, source: { id: r.id, w: r.w, h: r.h }, piece: { w: placed[0], h: placed[1] }, offcuts: added };
    }

    // 2) 余料不够，开一张整板
    if (c.boards > 0) {
      const [pw, ph] = orientations(w, h).find(([a, b]) => a <= BOARD_W && b <= BOARD_H);
      c.boards--;
      const added = offcuts(BOARD_W, BOARD_H, pw, ph)
        .map(o => ({ id: 'r' + (state.seq++), ...o }));
      c.remnants.push(...added);
      return { kind: 'board', materialId, thickness, source: { w: BOARD_W, h: BOARD_H }, piece: { w: pw, h: ph }, offcuts: added };
    }

    return null;
  }

  // 取消预约：退回用料。由它产生的边角若还在库则一并撤掉
  function restore(state, consumed) {
    const c = combo(state, consumed.materialId, consumed.thickness);
    if (!c) return;
    for (const o of consumed.offcuts) {
      const i = c.remnants.findIndex(r => r.id === o.id);
      if (i >= 0) c.remnants.splice(i, 1);
    }
    if (consumed.kind === 'board') {
      c.boards++;
    } else {
      c.remnants.push({ ...consumed.source }); // 原 id 退回，便于上级整板取消时撤掉
    }
  }

  // 消耗记录的人类可读描述
  function describe(consumed) {
    const src = consumed.kind === 'board'
      ? `整板 ${consumed.source.w}×${consumed.source.h}`
      : `余料 ${consumed.source.w}×${consumed.source.h}`;
    const back = consumed.offcuts.length
      ? `，回记边角 ${consumed.offcuts.map(o => `${o.w}×${o.h}`).join('、')}`
      : '';
    return `消耗${src}${back}`;
  }

  return { BOARD_W, BOARD_H, MIN_USABLE, key, canFulfill, consume, restore, describe };
})();
