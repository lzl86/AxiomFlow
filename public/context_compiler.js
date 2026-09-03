/**
 * ThoughtDAG Context Compiler
 * 移植自 ThoughtDAG 核心算法：Wires are the context.
 * 逆向后序遍历 (Post-order DFS) 入边，将图结构编译为确定性上下文数据包。
 */

/**
 * 拓扑后序 DFS 遍历所有连入节点的上游祖先
 */
export function walkUpAncestors(startId, nodes, edges) {
  const ordered = [];
  const visited = new Set();
  const visitedEdgeIds = new Set();

  function dfs(currentId) {
    if (visited.has(currentId)) return;
    visited.add(currentId);

    // 获取连向当前节点的所有入边 (Incoming Edges)
    const incomingEdges = edges.filter(e => e.target === currentId);
    
    // 递归遍历上游
    for (const edge of incomingEdges) {
      visitedEdgeIds.add(edge.id);
      dfs(edge.source);
    }

    const node = nodes.find(n => n.id === currentId);
    if (node) {
      ordered.push(node);
    }
  }

  dfs(startId);
  return { ordered, visitedEdgeIds };
}

/**
 * 将祖先节点集合按语义类型进行分区分流 (Partitioning)
 */
export function partitionContext(targetNodeId, nodes, edges) {
  const { ordered } = walkUpAncestors(targetNodeId, nodes, edges);
  
  // 排除目标节点自身，只保留祖先
  const ancestors = ordered.filter(n => n.id !== targetNodeId);
  const targetNode = nodes.find(n => n.id === targetNodeId);

  const materials = [];
  const references = [];
  const chainTurns = [];

  // 获取直接连入目标节点的入边
  const directInEdges = edges.filter(e => e.target === targetNodeId);

  for (const node of ancestors) {
    if (node.kind === 'material') {
      materials.push(node);
    } else {
      // 检查该节点是通过实线还是虚线连入的
      const directEdge = directInEdges.find(e => e.source === node.id);
      if (directEdge && directEdge.kind === 'dashed') {
        references.push(node);
      } else {
        chainTurns.push(node);
      }
    }
  }

  return {
    materials,
    references,
    chainTurns,
    targetNode
  };
}

/**
 * 编译成最终输入模型的纯净 Context Prompt
 */
export function compilePrompt(partition) {
  const { materials, references, chainTurns, targetNode } = partition;
  const sections = [];

  // 1. 文献与实证素材块 (Materials)
  if (materials.length > 0) {
    sections.push("### 【客观文献与证据素材 (Grounding Materials)】");
    materials.forEach((m, idx) => {
      const cite = m.citation ? ` (${m.citation})` : '';
      sections.push(`[Evidence #${idx + 1}: ${m.title}${cite}]\n${m.excerpt || m.content || ''}`);
    });
    sections.push("---");
  }

  // 2. 外部隔离引用块 (Dashed Edge References)
  if (references.length > 0) {
    sections.push("### 【参考论断 (Reference Blocks)】");
    references.forEach((r, idx) => {
      sections.push(`[Reference #${idx + 1}: ${r.title || r.question}]\nQ: ${r.question}\nA: ${r.response || '(暂无结论)'}`);
    });
    sections.push("---");
  }

  // 3. 主干逻辑链条 (Solid Edge Dialogue Chain)
  if (chainTurns.length > 0) {
    sections.push("### 【主干推演历史 (Conversation Chain)】");
    chainTurns.forEach((t, idx) => {
      sections.push(`[Turn #${idx + 1}]\n提问: ${t.question}\n结论: ${t.response || '(正在推导)'}`);
    });
    sections.push("---");
  }

  // 4. 当前目标问题
  sections.push("### 【当前待解答课题】");
  sections.push(`问题: ${targetNode ? targetNode.question : ''}`);
  if (materials.length > 0 || chainTurns.length > 0 || references.length > 0) {
    sections.push("【解答要求】：请结合上述上下文，通俗直观、深入浅出地解释该概念的核心定义、主要内涵与实际应用。请用通顺生动的语言帮助读者快速建立直观认知，无需堆砌复杂的底层数学公式与繁复的微观机理推导。");
  } else {
    sections.push("【解答要求】：请用清晰通俗、直观易懂的语言系统解释该课题的核心概念、基本原理与典型应用场景，重点在于帮助读者建立透彻直观的理解，无需展开复杂的底层物理机理与长篇数学公式推导。");
  }

  const fullText = sections.join("\n\n");
  // 简易 Token 预估（汉字约 1.5 token，英文约 0.75 token）
  const estimatedTokens = Math.round(fullText.length * 1.1);

  return {
    fullText,
    estimatedTokens,
    fingerprint: hashString(fullText)
  };
}

/**
 * 简易字符串指纹计算 (DJB2 变体)
 */
export function hashString(str) {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return (hash >>> 0).toString(36);
}
