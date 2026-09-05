/**
 * AxiomFlow Sugiyama / Topological Rank Auto-Layout Algorithm
 * 依据科研因果逻辑实现有向无环图分层、重心启发式连线交叉最小化与包围盒防重叠排布
 */

export function calculateSugiyamaLayout(nodes, edges, options = {}) {
  if (!nodes || nodes.length === 0) return { positions: {}, bounds: { width: 0, height: 0 } };

  const {
    nodeWidth = 360,
    hGap = 130,
    vGap = 36,
    startX = 60,
    startY = 60,
    domHeightsMap = {}
  } = options;

  const nodeMap = new Map();
  nodes.forEach(n => nodeMap.set(n.id, { ...n }));

  // 1. 构建邻接图与入度/出度统计
  const adj = new Map();
  const revAdj = new Map();
  const inDegree = new Map();

  nodes.forEach(n => {
    adj.set(n.id, []);
    revAdj.set(n.id, []);
    inDegree.set(n.id, 0);
  });

  edges.forEach(e => {
    if (nodeMap.has(e.source) && nodeMap.has(e.target)) {
      adj.get(e.source).push(e.target);
      revAdj.get(e.target).push(e.source);
      inDegree.set(e.target, (inDegree.get(e.target) || 0) + 1);
    }
  });

  // 2. 层级分配 (Layer Assignment / Rank Calculation)
  const ranks = new Map();
  const hasMaterial = nodes.some(n => n.kind === 'material' || n.id.startsWith('n_mat') || n.id.startsWith('n_snip'));

  // 初始基准层判定
  nodes.forEach(n => {
    const isMat = n.kind === 'material' || n.id.startsWith('n_mat') || n.id.startsWith('n_snip');
    if (isMat) {
      ranks.set(n.id, 0);
    } else if (n.kind === 'question') {
      // 若包含实证素材，则核心课题从 Layer 1 开始；否则从 Layer 0 开始
      ranks.set(n.id, hasMaterial ? 1 : 0);
    } else {
      ranks.set(n.id, hasMaterial ? 2 : 1);
    }
  });

  // 拓扑最长路径松弛 (迭代传递约束: rank(target) >= rank(source) + 1)
  let changed = true;
  let iterations = 0;
  const maxIterations = nodes.length + 5;

  while (changed && iterations < maxIterations) {
    changed = false;
    iterations++;

    edges.forEach(e => {
      const u = e.source;
      const v = e.target;
      if (nodeMap.has(u) && nodeMap.has(v)) {
        const uRank = ranks.get(u) || 0;
        const vRank = ranks.get(v) || 0;
        if (vRank <= uRank) {
          ranks.set(v, uRank + 1);
          changed = true;
        }
      }
    });
  }

  // 3. 将节点归类到对应层级桶
  const layerBuckets = new Map();
  nodes.forEach(n => {
    const r = ranks.get(n.id) || 0;
    if (!layerBuckets.has(r)) layerBuckets.set(r, []);
    layerBuckets.get(r).push(n);
  });

  const sortedLayerKeys = Array.from(layerBuckets.keys()).sort((a, b) => a - b);

  // 4. 重心启发式排序 (Barycenter Ordering) 减少连线交叉
  // 先排 Layer 0
  if (sortedLayerKeys.length > 0) {
    const layer0 = layerBuckets.get(sortedLayerKeys[0]);
    layer0.sort((a, b) => {
      // 提取引用页码或原 Y 坐标排序
      const aPage = extractPageNum(a);
      const bPage = extractPageNum(b);
      if (aPage !== bPage) return aPage - bPage;
      return (a.y || 0) - (b.y || 0);
    });
  }

  // 从前向后逐层基于前驱节点重心排布
  const tempYMap = new Map();
  sortedLayerKeys.forEach(layerIdx => {
    const layerNodes = layerBuckets.get(layerIdx);
    if (layerIdx > 0) {
      layerNodes.sort((a, b) => {
        const aParents = revAdj.get(a.id) || [];
        const bParents = revAdj.get(b.id) || [];

        const aCenter = aParents.length > 0
          ? aParents.reduce((sum, pid) => sum + (tempYMap.get(pid) || 0), 0) / aParents.length
          : (a.y || 0);

        const bCenter = bParents.length > 0
          ? bParents.reduce((sum, pid) => sum + (tempYMap.get(pid) || 0), 0) / bParents.length
          : (b.y || 0);

        return aCenter - bCenter;
      });
    }

    // 记录本层基准 Y 供下一层计算重心
    let currY = startY;
    layerNodes.forEach(n => {
      const h = Math.max(160, domHeightsMap[n.id] || (n.kind === 'material' ? 200 : 260));
      tempYMap.set(n.id, currY + h / 2);
      currY += h + vGap;
    });
  });

  // 5. 坐标精准赋值与包围盒计算
  const positions = {};
  let maxColumnHeight = 0;
  const columnHeights = new Map();

  sortedLayerKeys.forEach((layerIdx, colIndex) => {
    const layerNodes = layerBuckets.get(layerIdx);
    let totalHeight = 0;
    layerNodes.forEach(n => {
      const h = Math.max(160, domHeightsMap[n.id] || (n.kind === 'material' ? 200 : 260));
      totalHeight += h + vGap;
    });
    totalHeight = Math.max(0, totalHeight - vGap);
    columnHeights.set(colIndex, totalHeight);
    if (totalHeight > maxColumnHeight) maxColumnHeight = totalHeight;
  });

  let maxX = startX;
  let maxY = startY;

  sortedLayerKeys.forEach((layerIdx, colIndex) => {
    const layerNodes = layerBuckets.get(layerIdx);
    const colX = startX + colIndex * (nodeWidth + hGap);
    const colHeight = columnHeights.get(colIndex) || 0;
    
    // 微调纵向对齐（居中或自顶向下平滑分布）
    let currY = startY;
    // 若本列节点极少且邻列极长，进行适度垂直居中微调
    if (colHeight < maxColumnHeight * 0.5 && layerNodes.length <= 2) {
      currY = startY + (maxColumnHeight - colHeight) * 0.15;
    }

    layerNodes.forEach(n => {
      const h = Math.max(160, domHeightsMap[n.id] || (n.kind === 'material' ? 200 : 260));
      positions[n.id] = {
        x: Math.round(colX),
        y: Math.round(currY),
        width: nodeWidth,
        height: h
      };
      if (colX + nodeWidth > maxX) maxX = colX + nodeWidth;
      if (currY + h > maxY) maxY = currY + h;
      currY += h + vGap;
    });
  });

  return {
    positions,
    bounds: {
      minX: startX,
      minY: startY,
      maxX: maxX + startX,
      maxY: maxY + startY,
      width: maxX - startX + nodeWidth,
      height: maxY - startY
    }
  };
}

function extractPageNum(node) {
  const text = (node.title || '') + ' ' + (node.citation || '') + ' ' + (node.question || '') + ' ' + (node.content || '');
  const match = text.match(/P\.(\d+)/i) || text.match(/第\s*(\d+)\s*页/i);
  return match ? parseInt(match[1], 10) : 9999;
}
