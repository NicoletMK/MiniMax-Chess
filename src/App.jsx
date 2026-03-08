import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { createSession, saveGame, logDepthChange, logDepthUnlocked, logNextDepthAccepted, logTreeExpand, logTreeHover, logReflection, saveSessionEnd, saveKnowsChess } from './firebase';

// ═══════════════════════════════════════════════════════════════
// CHESS ENGINE
// ═══════════════════════════════════════════════════════════════
const PIECE_VALUES = { P:1,N:3,B:3,R:5,Q:9,K:1000,p:-1,n:-3,b:-3,r:-5,q:-9,k:-1000 };
const STARTING_BOARD = [
  'r','n','b','q','k','b','n','r','p','p','p','p','p','p','p','p',
  null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,
  null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,
  'P','P','P','P','P','P','P','P','R','N','B','Q','K','B','N','R',
];
// White pieces = hollow outlines (♙♘♗♖♕♔), Black pieces = filled (♟♞♝♜♛♚)
const SYM = { r:'♜',n:'♞',b:'♝',q:'♛',k:'♚',p:'♟', R:'♜',N:'♞',B:'♝',Q:'♛',K:'♚',P:'♟' };
const fileRank = i => `${String.fromCharCode(97+i%8)}${8-Math.floor(i/8)}`;
const getNotation = (fi,ti,piece,cap,promo) => {
  const ts=fileRank(ti), pt=piece.toUpperCase();
  if(promo) return (cap?`${fileRank(fi)[0]}x`:'')+ts+'='+promo.toUpperCase();
  if(pt==='P') return cap?`${fileRank(fi)[0]}x${ts}`:ts;
  return pt+(cap?'x':'')+ts;
};
const evalBoard = b => b.reduce((s,p)=>p?s+PIECE_VALUES[p]:s,0)*-1;
const genMoves = (board, player) => {
  const isW=player==='w', moves=[];
  const addM=(fi,ti,piece,cap)=>{
    const nb=[...board]; let pm=piece;
    const tr=Math.floor(ti/8);
    if(piece.toUpperCase()==='P'&&(tr===0||tr===7)) pm=isW?'Q':'q';
    nb[ti]=pm; nb[fi]=null;
    moves.push({fromIndex:fi,toIndex:ti,newBoard:nb,piece,notation:getNotation(fi,ti,piece,cap,pm!==piece?pm:null),capturedPiece:cap});
  };
  for(let fi=0;fi<64;fi++){
    const piece=board[fi]; if(!piece) continue;
    const pw=piece===piece.toUpperCase(); if(isW!==pw) continue;
    const pt=piece.toUpperCase(), row=Math.floor(fi/8), col=fi%8;
    const enemy=t=>t&&isW!==(t===t.toUpperCase());
    if(pt==='P'){
      const d=isW?-1:1,r1=row+d;
      if(r1>=0&&r1<8){
        const t1=r1*8+col;
        if(!board[t1]){addM(fi,t1,piece,null);if((isW&&row===6)||(!isW&&row===1)){const t2=(row+d*2)*8+col;if(!board[t2])addM(fi,t2,piece,null);}}
        for(const dc of[-1,1]){const cc=col+dc;if(cc>=0&&cc<8){const ct=r1*8+cc;if(enemy(board[ct]))addM(fi,ct,piece,board[ct]);}}
      }
      continue;
    }
    let dirs=[],mx=1;
    if(pt==='R'){dirs=[[-1,0],[1,0],[0,-1],[0,1]];mx=8;}
    else if(pt==='B'){dirs=[[-1,-1],[-1,1],[1,-1],[1,1]];mx=8;}
    else if(pt==='Q'){dirs=[[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[-1,1],[1,-1],[1,1]];mx=8;}
    else if(pt==='N')dirs=[[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]];
    else if(pt==='K')dirs=[[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[-1,1],[1,-1],[1,1]];
    for(const[dr,dc]of dirs)for(let s=1;s<=mx;s++){
      const nr=row+dr*s,nc=col+dc*s;
      if(nr<0||nr>=8||nc<0||nc>=8)break;
      const ti=nr*8+nc,tp=board[ti];
      if(tp){if(enemy(tp))addM(fi,ti,piece,tp);break;}else addM(fi,ti,piece,null);
    }
  }
  return moves;
};

// ═══════════════════════════════════════════════════════════════
// MINIMAX TREE BUILDER
// ═══════════════════════════════════════════════════════════════
const DISPLAY_BRANCHES = 3; // branches shown in the visual tree

// Order moves: captures by value first, then quiet moves
const orderMoves = (moves) => {
  return [...moves].sort((a, b) => {
    const aVal = a.capturedPiece ? Math.abs(PIECE_VALUES[a.capturedPiece]) : 0;
    const bVal = b.capturedPiece ? Math.abs(PIECE_VALUES[b.capturedPiece]) : 0;
    return bVal - aVal;
  });
};

// Full minimax — searches ALL legal moves, returns only the score
// This is what the bot actually uses to decide its move
const minimax = (board, depth, isMax, alpha=-Infinity, beta=Infinity) => {
  if(depth===0) return evalBoard(board);
  const moves = genMoves(board, isMax?'b':'w');
  if(!moves.length) return evalBoard(board);
  if(isMax){
    let best=-Infinity;
    for(const m of moves){
      best=Math.max(best, minimax(m.newBoard, depth-1, false, alpha, beta));
      alpha=Math.max(alpha,best);
      if(beta<=alpha) break;
    }
    return best;
  } else {
    let best=Infinity;
    for(const m of moves){
      best=Math.min(best, minimax(m.newBoard, depth-1, true, alpha, beta));
      beta=Math.min(beta,best);
      if(beta<=alpha) break;
    }
    return best;
  }
};

// Display tree — only top DISPLAY_BRANCHES moves per node, for the visual
// Scores come from the full minimax search above so values are accurate
let nodeId = 0;
const buildDisplayTree = (board, depth, isMax, label='Root', fromIdx=null, toIdx=null) => {
  const node = { id:nodeId++, label, depth, isMax, children:[], score:null, isLeaf:false, isChosen:false, fromIndex:fromIdx, toIndex:toIdx };
  if(depth===0){node.score=evalBoard(board);node.isLeaf=true;return node;}
  const allMoves = orderMoves(genMoves(board,isMax?'b':'w'));
  if(!allMoves.length){node.score=evalBoard(board);node.isLeaf=true;return node;}
  // Score all moves with full minimax, then show only top DISPLAY_BRANCHES
  const scored = allMoves.map(m=>({m, score: minimax(m.newBoard, depth-1, !isMax)}));
  scored.sort((a,b)=> isMax ? b.score-a.score : a.score-b.score);
  const top = scored.slice(0, DISPLAY_BRANCHES);
  let best = isMax?-Infinity:Infinity, bi=0;
  for(let i=0;i<top.length;i++){
    const child = buildDisplayTree(top[i].m.newBoard, depth-1, !isMax, top[i].m.notation, top[i].m.fromIndex, top[i].m.toIndex);
    // Override score with the accurate full-search score
    child.score = top[i].score;
    node.children.push(child);
    if(isMax?top[i].score>best:top[i].score<best){best=top[i].score;bi=i;}
  }
  node.score=best;
  if(node.children[bi]) node.children[bi].isChosen=true;
  return node;
};

const findBestMove = (board, depth) => {
  const botMoves = genMoves(board,'b');
  if(!botMoves.length) return {move:null,score:null,tree:null};
  // Full search across ALL bot moves to find the genuinely best move
  let best=-Infinity, bestMove=null;
  for(const m of botMoves){
    const score = minimax(m.newBoard, depth-1, false);
    if(score>best){best=score;bestMove=m;}
  }
  // Build display tree: top DISPLAY_BRANCHES candidates, scored accurately
  nodeId=0;
  const root={id:nodeId++,label:'Position now',depth,isMax:true,isRoot:true,children:[],score:best,fromIndex:null,toIndex:null};
  const scored = orderMoves(botMoves).map(m=>({m, score: minimax(m.newBoard, depth-1, false)}));
  scored.sort((a,b)=>b.score-a.score);
  const topMoves = scored.slice(0, DISPLAY_BRANCHES);
  let bi=0;
  for(let i=0;i<topMoves.length;i++){
    const child = buildDisplayTree(topMoves[i].m.newBoard, depth-1, false, topMoves[i].m.notation, topMoves[i].m.fromIndex, topMoves[i].m.toIndex);
    child.score = topMoves[i].score;
    root.children.push(child);
    if(topMoves[i].m.notation===bestMove.notation) bi=i;
  }
  if(root.children[bi]) root.children[bi].isChosen=true;
  return {move:bestMove, score:best, tree:root};
};

// Generate plain-English explanation of why bot played its move
const explainBotMove = (tree, move) => {
  if(!tree||!move) return null;
  const chosen = tree.children.find(c=>c.isChosen);
  const others = tree.children.filter(c=>!c.isChosen);
  if(!chosen) return null;
  const chosenScore = chosen.score;
  const bestOther = others.reduce((b,c)=>c.score>b?c.score:b, -Infinity);
  const diff = Math.abs(chosenScore - bestOther).toFixed(1);
  // chosenScore > 0 means bot is ahead after this line; < 0 means player ahead
  const chosenLabel = chosenScore < -0.05 ? `White +${Math.abs(chosenScore).toFixed(1)}` : chosenScore > 0.05 ? `Black +${chosenScore.toFixed(1)}` : 'even material';
  let reason = '';
  if(chosenScore > bestOther+2) reason = `This was clearly the best line — ${diff} pts better for the bot than any alternative considered.`;
  else if(chosenScore > bestOther) reason = `Slightly better than alternatives by ${diff} pts (${chosenLabel} after this line).`;
  else reason = `All options scored about the same. The bot picked this one (${chosenLabel}).`;
  const worstOther = others.reduce((b,c)=>c.score<b?c.score:b, Infinity);
  let trap = '';
  if(others.some(c=>c.score<chosenScore-3)) {
    const worstLabel = worstOther < 0 ? `White +${Math.abs(worstOther).toFixed(1)}` : `Black +${worstOther.toFixed(1)}`;
    trap = ` One rejected line leads to ${worstLabel} — the bot avoided that.`;
  }
  return {
    move: move.notation,
    score: chosenScore,
    reason: reason + trap,
    rejected: others.map(c=>c.label).join(', '),
  };
};

// ═══════════════════════════════════════════════════════════════
// TREE UI
// ═══════════════════════════════════════════════════════════════
// Internal score: positive = bot (Black) ahead, negative = player (White) ahead.
// Display as chess-standard White/Black so it's unambiguous in any context.
//   score < 0  → "White +X"  (green — White/human is winning)
//   score > 0  → "Black +X"  (red   — Black/bot is winning)
//   score = 0  → "0.0"       (grey)
const fmtScore = (score) => {
  if(score===null||score===undefined) return null;
  const abs = Math.abs(score);
  if(abs < 0.05) return {label:'0.0', col:'#a78bfa', bg:'rgba(167,139,250,0.1)'};
  if(score < 0)  return {label:`White +${abs.toFixed(1)}`, col:'#4ade80', bg:'rgba(34,197,94,0.12)'};
  return          {label:`Black +${abs.toFixed(1)}`,  col:'#f87171', bg:'rgba(239,68,68,0.12)'};
};

const ScorePill = ({score, size='sm'}) => {
  const f = fmtScore(score);
  if(!f) return null;
  const fs = size==='lg'?15:10;
  return <span style={{background:f.bg,color:f.col,fontWeight:700,fontSize:fs,padding:'2px 7px',borderRadius:99,border:`1px solid ${f.col}33`,fontFamily:"'DM Mono',monospace",whiteSpace:'nowrap'}}>{f.label}</span>;
};

const NodeCard = ({node, isRoot, onSelect, isSelected, onHover, visible, actualHumanMove, isBotTree, pulseRoot}) => {
  const hasKids = node.children?.length>0;
  // isMax = true means: the MAXIMISER (bot/Black) is choosing from this node's children
  // isMax = false means: the MINIMISER (human/White) is choosing from this node's children
  let borderCol, bgCol, labelCol, typeLabel, typeEmoji;
  if(isRoot)          {borderCol='#8b5cf6';bgCol='rgba(124,58,237,0.08)';labelCol='#c4b5fd';typeLabel='position now';typeEmoji='🌳';}
  else if(node.isLeaf){borderCol='#a78bfa';bgCol='rgba(124,58,237,0.08)';labelCol='#c4b5fd';typeLabel='LEAF';typeEmoji='📊';}
  else if(node.isMax) {borderCol='#9333ea';bgCol='rgba(124,58,237,0.08)';labelCol='#d8b4fe';typeLabel="bot's move";typeEmoji='🤖';}
  else                {borderCol='#f97316';bgCol='rgba(249,115,22,0.08)';labelCol='#fed7aa';typeLabel='your move';typeEmoji='😊';}
  if(node.isChosen&&!isRoot){borderCol='#22c55e';bgCol='rgba(34,197,94,0.1)';}
  if(isSelected){bgCol='rgba(255,255,255,0.07)';}
  return (
    <div onClick={()=>onSelect(node)} onMouseEnter={()=>onHover&&onHover(node)} onMouseLeave={()=>onHover&&onHover(null)}
      style={{display:'inline-flex',flexDirection:'column',gap:4,padding:'9px 13px',
        background:bgCol,border:`1.5px solid ${borderCol}`,borderRadius:10,
        cursor:hasKids?'pointer':'default',minWidth:92,textAlign:'center',
        transition:'all 0.2s',userSelect:'none',position:'relative',
        opacity: visible?1:0, transform: visible?'translateY(0)':'translateY(8px)',
        boxShadow: pulseRoot
          ? `0 0 0 3px #8b5cf6, 0 0 20px rgba(139,92,246,0.5)`
          : isSelected?`0 0 0 2px ${borderCol}55,0 4px 18px ${borderCol}22`:`0 2px 8px rgba(0,0,0,0.3)`,
        animation: pulseRoot ? 'nodePulse 1.4s ease-in-out infinite' : 'none'}}
      onMouseEnterCapture={e=>{if(hasKids)e.currentTarget.style.transform='translateY(-2px)';}}
      onMouseLeaveCapture={e=>{e.currentTarget.style.transform=visible?'translateY(0)':'translateY(8px)';}}>
      {node.isChosen&&!isRoot&&(
        <span style={{position:'absolute',top:-7,right:-7,background:'#22c55e',borderRadius:'50%',width:16,height:16,display:'flex',alignItems:'center',justifyContent:'center',fontSize:11,color:'#fff',fontWeight:700,boxShadow:'0 0 8px rgba(34,197,94,0.8)'}}>✓</span>
      )}
      {actualHumanMove&&!isRoot&&node.label===actualHumanMove.notation&&(
        <span style={{position:'absolute',top:-7,left:-7,background:'#f59e0b',borderRadius:'50%',width:16,height:16,display:'flex',alignItems:'center',justifyContent:'center',fontSize:10,color:'#000',fontWeight:900,boxShadow:'0 0 8px rgba(245,158,11,0.8)',title:'You played this'}}>★</span>
      )}
      <span style={{fontSize:12,fontWeight:700,color:borderCol,letterSpacing:0.5,fontFamily:"'DM Mono',monospace"}}>{typeEmoji} {typeLabel}</span>
      <span style={{fontSize:14,fontWeight:700,color:labelCol,fontFamily:"'DM Mono',monospace",whiteSpace:'nowrap'}}>
        {isRoot?'Start':(node.label?.length>8?node.label.slice(0,8):node.label)}
      </span>
      <div style={{display:'flex',justifyContent:'center'}}><ScorePill score={node.score}/></div>
      {hasKids&&<span style={{fontSize:11,color:borderCol,opacity:0.6,fontFamily:"'DM Mono',monospace"}}>{isSelected?'▲ hide':'▼ show'}</span>}
    </div>
  );
};

const TreeConnector = ({chosen}) => (
  <div style={{display:'flex',flexDirection:'column',alignItems:'center',width:36,flexShrink:0}}>
    <div style={{width:2,height:14,background:chosen?'#22c55e':'#3b1f6e',transition:'background 0.3s'}}/>
    <div style={{width:chosen?9:6,height:chosen?9:6,borderRadius:'50%',background:chosen?'#22c55e':'#94a3b8',boxShadow:chosen?'0 0 8px rgba(34,197,94,0.8)':'none',transition:'all 0.3s'}}/>
    <div style={{width:2,height:14,background:chosen?'#22c55e':'#3b1f6e',transition:'background 0.3s'}}/>
  </div>
);

// Collect all node IDs in BFS order for animation
const collectBFS = (root) => {
  const order = [];
  const queue = [root];
  while(queue.length){
    const n = queue.shift();
    order.push(n.id);
    (n.children||[]).forEach(c=>queue.push(c));
  }
  return order;
};

const TreeNodeBlock = ({node, isRoot, expanded, onToggle, onHover, depthLabels, depth, visibleIds, actualHumanMove, isBotTree, pulseRoot}) => {
  const isExpanded = expanded.has(node.id);
  const hasKids = node.children?.length > 0;
  const visible = visibleIds.has(node.id);
  return (
    <div style={{display:'flex',flexDirection:'column',alignItems:'center'}}>
      <NodeCard node={node} isRoot={isRoot} isSelected={isExpanded&&hasKids}
        onSelect={()=>hasKids&&onToggle(node.id,node)} onHover={onHover} visible={visible} actualHumanMove={actualHumanMove} isBotTree={isBotTree} pulseRoot={isRoot&&pulseRoot}/>
      {isExpanded && hasKids && (
        <>
          <TreeConnector chosen={node.isChosen&&!isRoot}/>
          <ChildRow nodes={node.children} expanded={expanded} onToggle={onToggle}
            onHover={onHover} depthLabels={depthLabels} depth={depth+1} visibleIds={visibleIds} actualHumanMove={actualHumanMove} isBotTree={isBotTree}/>
        </>
      )}
    </div>
  );
};

const ChildRow = ({nodes, expanded, onToggle, onHover, depthLabels, depth, visibleIds, actualHumanMove, isBotTree}) => {
  const rowRef = useRef(null);
  const cardRefs = useRef([]);
  const [lines, setLines] = useState([]);
  useEffect(()=>{
    if(!rowRef.current) return;
    const rowRect=rowRef.current.getBoundingClientRect();
    const newLines=cardRefs.current.map((el,i)=>{
      if(!el) return null;
      const r=el.getBoundingClientRect();
      return{cx:r.left+r.width/2-rowRect.left,chosen:nodes[i]?.isChosen};
    }).filter(Boolean);
    setLines(newLines);
  });
  const parentX=rowRef.current?rowRef.current.getBoundingClientRect().width/2:0;
  const depthColors=['#8b5cf6','#9333ea','#f97316','#a78bfa'];
  const dc=depthColors[depth%depthColors.length];
  return (
    <div style={{display:'flex',flexDirection:'column',alignItems:'center',width:'100%'}}>
      <div style={{fontSize:13,color:dc,letterSpacing:1,textTransform:'uppercase',marginBottom:8,fontFamily:"'DM Mono',monospace",textAlign:'center',opacity:0.7}}>
        {depthLabels[depth]??`depth ${depth}`}
      </div>
      <div ref={rowRef} style={{position:'relative',width:'100%'}}>
        {lines.length>0&&(
          <svg style={{position:'absolute',top:0,left:0,width:'100%',height:28,pointerEvents:'none',overflow:'visible'}} height={28}>
            {lines.map((l,i)=>(
              <path key={i} d={`M ${parentX} 0 C ${parentX} 18, ${l.cx} 10, ${l.cx} 28`}
                fill="none" stroke={l.chosen?'#22c55e':'#3b1f6e'} strokeWidth={l.chosen?2.5:1.5}/>
            ))}
          </svg>
        )}
        <div style={{height:28}}/>
      </div>
      <div style={{display:'flex',gap:16,flexWrap:'nowrap',justifyContent:'center',alignItems:'flex-start'}}>
        {nodes.map((n,i)=>(
          <div key={n.id} ref={el=>{cardRefs.current[i]=el;}}>
            <TreeNodeBlock node={n} isRoot={false} expanded={expanded} onToggle={onToggle}
              onHover={onHover} depthLabels={depthLabels} depth={depth} visibleIds={visibleIds} actualHumanMove={actualHumanMove} isBotTree={isBotTree}/>
          </div>
        ))}
      </div>
    </div>
  );
};

// Tutorial tooltip steps
const TUTORIAL_STEPS = [
  {emoji:'🌳', title:'ROOT', body:"Current position. Each branch = a move the bot considered."},
  {emoji:'🤖', title:'MAX nodes', body:"Purple = bot's turn. Picks the HIGHEST score child."},
  {emoji:'😊', title:'MIN nodes', body:"Orange = your turn. Bot assumes you pick the LOWEST score."},
  {emoji:'📊', title:'LEAF scores', body:"White +2 = you're up 2 pts. Black +3 = bot ahead. Scores bubble up to the root."},
];

const InteractiveTree = ({root, depthLabels, onHover, isFirstTree, actualHumanMove, isBotTree, onExpand, onTreeTutorial}) => {
  const [expanded, setExpanded] = useState(new Set());
  const [visibleIds, setVisibleIds] = useState(new Set());
  const [tutStep, setTutStep] = useState(0);
  const [tutDismissed, setTutDismissed] = useState(false);
  useEffect(()=>{
    setExpanded(new Set());
    setVisibleIds(new Set());
    if(!tutDismissed && isFirstTree) setTutStep(0);
  },[root]);

  useEffect(()=>{
    if(!root) return;
    const order = collectBFS(root);
    setVisibleIds(new Set(order));
  },[root]);

  // Auto-advance tutorial
  useEffect(()=>{
    if(tutDismissed||!isFirstTree||tutStep>=TUTORIAL_STEPS.length) return;
    const t=setTimeout(()=>setTutStep(s=>Math.min(s+1,TUTORIAL_STEPS.length)),3500);
    return()=>clearTimeout(t);
  },[tutStep,tutDismissed,isFirstTree]);

  const onToggle=useCallback((id,node)=>{
    setExpanded(prev=>{
      const next=new Set(prev);
      if(next.has(id)){ next.delete(id); }
      else { next.add(id); if(onExpand&&node) onExpand(node); }
      return next;
    });
  },[onExpand]);

  if(!root) return (
    <div style={{display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',minHeight:240,gap:14}}>
      <div style={{fontSize:56,opacity:0.12}}>♔</div>
      <div style={{fontSize:15,color:'#a78bfa',fontStyle:'italic',textAlign:'center',maxWidth:300,lineHeight:1.9,fontFamily:"'DM Mono',monospace"}}>
        Make your first move to see the bot's thinking.
      </div>
    </div>
  );

  const showTut = !tutDismissed && isFirstTree && tutStep < TUTORIAL_STEPS.length;
  const tip = showTut ? TUTORIAL_STEPS[tutStep] : null;

  return (
    <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:0,position:'relative'}}>
      {/* Tutorial coach bubble */}
      {tip&&(
        <div className="fade-in" style={{marginBottom:16,background:'linear-gradient(135deg,#1e1035,#2a1548)',border:'2px solid #9333ea',borderRadius:14,padding:'14px 20px',maxWidth:320,textAlign:'center',boxShadow:'0 0 40px rgba(139,92,246,0.35)',position:'relative'}}>
          <div style={{fontSize:24,marginBottom:6}}>{tip.emoji}</div>
          <div style={{fontSize:15,fontWeight:700,color:'#c4b5fd',marginBottom:5}}>{tip.title}</div>
          <div style={{fontSize:14,color:'#a78bfa',lineHeight:1.7}}>{tip.body}</div>
          <div style={{display:'flex',justifyContent:'center',gap:6,marginTop:10}}>
            {TUTORIAL_STEPS.map((_,i)=>(
              <div key={i} style={{width:7,height:7,borderRadius:'50%',background:i===tutStep?'#8b5cf6':'#3b1f6e',transition:'background 0.3s'}}/>
            ))}
          </div>
          <div style={{display:'flex',justifyContent:'center',gap:12,marginTop:10}}>
            <button onClick={()=>{setTutStep(s=>Math.min(s+1,TUTORIAL_STEPS.length));if(onTreeTutorial)onTreeTutorial(tutStep,false);}} style={{fontSize:14,color:'#a78bfa',background:'none',border:'1px solid #3b1f6e',borderRadius:6,padding:'4px 10px',cursor:'pointer',fontFamily:"'DM Mono',monospace"}}>next →</button>
            <button onClick={()=>{setTutDismissed(true);if(onTreeTutorial)onTreeTutorial(tutStep,true);}} style={{fontSize:14,color:'#a78bfa',background:'none',border:'none',cursor:'pointer',fontFamily:"'DM Mono',monospace"}}>skip all</button>
          </div>
        </div>
      )}

      <div style={{fontSize:13,color:'#a78bfa',letterSpacing:1.2,textTransform:'uppercase',marginBottom:10,fontFamily:"'DM Mono',monospace",textAlign:'center'}}>
        {depthLabels[0]}
      </div>
      <TreeNodeBlock node={root} isRoot={true} expanded={expanded} onToggle={onToggle}
        onHover={onHover} depthLabels={depthLabels} depth={0} visibleIds={visibleIds} actualHumanMove={actualHumanMove} isBotTree={isBotTree} pulseRoot={expanded.size===0}/>
      {expanded.size===0 ? (
        <div style={{marginTop:10,display:'flex',flexDirection:'column',alignItems:'center',gap:4}}>
          <div style={{fontSize:16,color:'#7c3aed',animation:'bounceDown 1s ease-in-out infinite'}}>▼</div>
          <div style={{fontSize:14,color:'#a78bfa',fontFamily:"'DM Mono',monospace",fontWeight:700,letterSpacing:0.5}}>click to expand</div>
        </div>
      ) : (
        <div style={{marginTop:16,textAlign:'center',fontSize:13,color:'#c4b5fd',fontStyle:'italic',fontFamily:"'DM Mono',monospace"}}>
          {expanded.size} open · click to collapse
        </div>
      )}
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════
// CHESS BOARD
// ═══════════════════════════════════════════════════════════════
const Square = React.memo(({index,piece,isLight,isSelected,onClick,isHighlighted,isLastBotMove,isNodeFrom,isNodeTo})=>{
  const bg=isLight?'#f0d9b5':'#b58863';
  const shadows=[];
  if(isSelected)           {shadows.push('inset 0 0 0 3px rgba(139,92,246,0.9)','inset 0 0 12px rgba(139,92,246,0.6)');}
  else if(isHighlighted&&piece){shadows.push('inset 0 0 0 3px rgba(239,68,68,0.9)','inset 0 0 10px rgba(239,68,68,0.5)');}
  else if(isLastBotMove)   {shadows.push('inset 0 0 0 3px rgba(52,211,153,0.8)','inset 0 0 10px rgba(52,211,153,0.4)');}
  if(isNodeFrom){shadows.push('inset 0 0 0 4px rgba(250,204,21,0.95)','inset 0 0 14px rgba(250,204,21,0.4)');}
  if(isNodeTo)  {shadows.push('inset 0 0 0 4px rgba(34,211,238,0.95)','inset 0 0 14px rgba(34,211,238,0.4)');}
  const isWP=piece&&piece===piece.toUpperCase();
  return(
    <div onClick={()=>onClick(index)} style={{position:'relative',display:'flex',alignItems:'center',justifyContent:'center',background:bg,boxShadow:shadows.join(', ')||'none',cursor:'pointer',aspectRatio:'1',transition:'box-shadow 0.12s'}}>
      <span style={{fontSize:'min(5.5vw,2.4rem)',lineHeight:1,color:isWP?'#fff':'#1a0a2e',textShadow:isWP?'0 1px 1px rgba(0,0,0,0.8)':'none',fontFamily:"'Chess Alpha','Arial Unicode MS',sans-serif",userSelect:'none',zIndex:1,position:'relative'}}>
        {piece?SYM[piece]:''}
      </span>
      {isHighlighted&&!piece&&<div style={{position:'absolute',width:'30%',height:'30%',borderRadius:'50%',background:'rgba(255,214,0,0.55)',pointerEvents:'none'}}/>}
      {(isNodeFrom||isNodeTo)&&(
        <div style={{position:'absolute',bottom:2,right:3,fontSize:11,fontWeight:700,color:isNodeFrom?'#fde047':'#d8b4fe',fontFamily:"'DM Mono',monospace",textShadow:'0 1px 3px rgba(0,0,0,0.9)',pointerEvents:'none',lineHeight:1}}>
          {isNodeFrom?'from':'to'}
        </div>
      )}
    </div>
  );
});

const ChessBoard = React.memo(({board,selectedSquare,handleSquareClick,highlightedMoves,lastBotMove,nodeHighlight})=>{
  const nfrom=nodeHighlight?.fromIndex??-1, nto=nodeHighlight?.toIndex??-1;
  const files=['a','b','c','d','e','f','g','h'], ranks=['8','7','6','5','4','3','2','1'];
  const lblSt={fontSize:12,fontWeight:700,color:'#a78bfa',fontFamily:"'DM Mono',monospace",lineHeight:1,userSelect:'none'};
  return(
    <div style={{display:'inline-flex',flexDirection:'column',gap:0,width:'100%',maxWidth:360}}>
      <div style={{display:'flex',gap:0,alignItems:'stretch'}}>
        <div style={{display:'flex',flexDirection:'column',width:12,marginRight:3,flexShrink:0}}>
          {ranks.map(r=><div key={r} style={{flex:1,display:'flex',alignItems:'center',justifyContent:'center'}}><span style={lblSt}>{r}</span></div>)}
        </div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(8,1fr)',border:'4px solid #4a2d72',borderRadius:6,overflow:'hidden',boxShadow:'0 8px 40px rgba(0,0,0,0.6)',flex:1,aspectRatio:'1'}}>
          {Array.from({length:64},(_,i)=>(
            <Square key={i} index={i} piece={board[i]}
              isLight={(Math.floor(i/8)+i%8)%2===0}
              isSelected={selectedSquare===i}
              isHighlighted={highlightedMoves.includes(i)}
              isLastBotMove={lastBotMove&&(i===lastBotMove.fromIndex||i===lastBotMove.toIndex)&&!highlightedMoves.includes(i)}
              isNodeFrom={i===nfrom} isNodeTo={i===nto} onClick={handleSquareClick}/>
          ))}
        </div>
      </div>
      <div style={{display:'flex',paddingLeft:15,marginTop:3}}>
        {files.map(f=><div key={f} style={{flex:1,display:'flex',alignItems:'center',justifyContent:'center'}}><span style={lblSt}>{f}</span></div>)}
      </div>
    </div>
  );
});

// ═══════════════════════════════════════════════════════════════
// RESIZABLE DIVIDER
// ═══════════════════════════════════════════════════════════════
const ResizableDivider = ({onDrag}) => {
  const dragging=useRef(false);
  const onMouseDown=e=>{dragging.current=true;e.preventDefault();};
  useEffect(()=>{
    const mm=e=>{if(dragging.current)onDrag(e.clientX);};
    const mu=()=>{dragging.current=false;};
    window.addEventListener('mousemove',mm); window.addEventListener('mouseup',mu);
    return()=>{window.removeEventListener('mousemove',mm);window.removeEventListener('mouseup',mu);};
  },[onDrag]);
  return(
    <div onMouseDown={onMouseDown} style={{width:5,flexShrink:0,cursor:'col-resize',background:'#3b1f6e',transition:'background 0.2s',position:'relative',zIndex:10,display:'flex',alignItems:'center',justifyContent:'center'}}
      onMouseEnter={e=>{e.currentTarget.style.background='#c4b5fd';}} onMouseLeave={e=>{e.currentTarget.style.background='#3b1f6e';}}>
      <div style={{width:1,height:40,background:'#c4b5fd',borderRadius:1}}/>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════
// CONFETTI + WIN OVERLAY
// ═══════════════════════════════════════════════════════════════
const Confetti = ({active}) => {
  const [pieces,setPieces]=useState([]);
  useEffect(()=>{
    if(!active){setPieces([]);return;}
    const colors=['#fde047','#4ade80','#a78bfa','#f472b6','#a78bfa','#fb923c'];
    setPieces(Array.from({length:70},(_,i)=>({id:i,x:Math.random()*100,delay:Math.random()*1.2,dur:2.5+Math.random()*2,color:colors[Math.floor(Math.random()*colors.length)],size:6+Math.random()*8,rot:Math.random()*360})));
  },[active]);
  if(!active||!pieces.length) return null;
  return(
    <div style={{position:'fixed',top:0,left:0,width:'100%',height:'100%',pointerEvents:'none',zIndex:100,overflow:'hidden'}}>
      {pieces.map(p=><div key={p.id} style={{position:'absolute',left:`${p.x}%`,top:'-20px',width:p.size,height:p.size,borderRadius:p.id%3===0?'50%':2,background:p.color,opacity:0.9,animation:`confetti-fall ${p.dur}s ${p.delay}s ease-in forwards`,transform:`rotate(${p.rot}deg)`}}/>)}
      <style>{`@keyframes confetti-fall{0%{transform:translateY(0) rotate(0deg);opacity:1;}80%{opacity:1;}100%{transform:translateY(110vh) rotate(720deg);opacity:0;}}`}</style>
    </div>
  );
};

const WinOverlay = ({msg, onReset, onNextDepth, moveLog}) => {
  if(!msg) return null;
  const pw = msg.playerWon;
  const newDepthUnlocked = pw && msg.newDepth != null;
  return(
    <div style={{position:'fixed',top:0,left:0,width:'100%',height:'100%',background:'rgba(15,5,35,0.8)',backdropFilter:'blur(8px)',zIndex:99,display:'flex',alignItems:'center',justifyContent:'center'}}>
      <div className="fade-in" style={{background:pw?'linear-gradient(135deg,rgba(20,83,45,0.97),rgba(5,46,22,0.97))':'linear-gradient(135deg,rgba(69,10,10,0.97),rgba(30,5,5,0.97))',border:`2px solid ${pw?'#22c55e':'#ef4444'}`,borderRadius:20,padding:'36px 48px',textAlign:'center',boxShadow:`0 0 80px ${pw?'rgba(34,197,94,0.4)':'rgba(239,68,68,0.4)'}`,maxWidth:480,width:'90%'}}>
        <div style={{fontSize:56,marginBottom:10,lineHeight:1}}>{pw?'🏆':'🤖'}</div>
        <div style={{fontSize:26,fontWeight:800,color:pw?'#86efac':'#fca5a5',fontFamily:"'DM Sans',sans-serif",marginBottom:6}}>{pw?'You won!':'Bot wins.'}</div>
        <div style={{fontSize:15,color:pw?'#4ade80':'#f87171',fontFamily:"'DM Mono',monospace",marginBottom:4,fontWeight:600}}>{msg.headline}</div>

        {newDepthUnlocked && (
          <div style={{margin:'14px 0',padding:'12px 16px',background:'rgba(139,92,246,0.1)',border:'1px solid rgba(139,92,246,0.4)',borderRadius:10}}>
            <div style={{fontSize:14,color:'#d8b4fe',fontFamily:"'DM Mono',monospace",marginBottom:2}}>🔓 DEPTH {msg.newDepth} UNLOCKED</div>
            <div style={{fontSize:13,color:'#a78bfa',fontFamily:"'DM Mono',monospace",lineHeight:1.6}}>
              Depth {msg.newDepth} — {msg.newDepth===4?'3×':'9×'} more positions than depth {msg.newDepth-1}.
            </div>
          </div>
        )}

        {!newDepthUnlocked && <div style={{fontSize:14,color:'#a78bfa',fontFamily:"'DM Sans',sans-serif",lineHeight:1.6,marginBottom:16}}>{msg.sub}</div>}

        {moveLog&&moveLog.length>0&&(
          <div style={{background:'rgba(255,255,255,0.06)',borderRadius:10,padding:'12px 16px',marginBottom:20,maxHeight:160,overflowY:'auto',textAlign:'left'}}>
            <div style={{fontSize:13,color:'#a78bfa',letterSpacing:1.5,textTransform:'uppercase',fontFamily:"'DM Mono',monospace",marginBottom:8}}>Full Game · {Math.ceil(moveLog.length/2)} moves</div>
            <div style={{display:'flex',flexDirection:'column',gap:4}}>
              {Array.from({length:Math.ceil(moveLog.length/2)},(_,i)=>{
                const w=moveLog[i*2],b=moveLog[i*2+1];
                const isLastW=i*2===moveLog.length-1, isLastB=b&&i*2+1===moveLog.length-1;
                return(
                  <div key={i} style={{display:'flex',gap:8,alignItems:'center',fontSize:14,fontFamily:"'DM Mono',monospace"}}>
                    <span style={{color:'#a78bfa',width:22,textAlign:'right',flexShrink:0}}>{i+1}.</span>
                    <span style={{color:isLastW?'#fde047':'#3b1f6e',fontWeight:isLastW?800:600,minWidth:52}}>{w?.notation}</span>
                    {b&&<span style={{color:isLastB?'#fde047':'#a78bfa',fontWeight:isLastB?800:600,minWidth:52}}>{b.notation}</span>}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div style={{display:'flex',gap:10,justifyContent:'center',flexWrap:'wrap'}}>
          {newDepthUnlocked && (
            <button onClick={onNextDepth} style={{padding:'12px 28px',borderRadius:10,border:'none',cursor:'pointer',background:'linear-gradient(135deg,#7c3aed,#9333ea)',color:'#fff',fontSize:16,fontWeight:700,fontFamily:"'DM Sans',sans-serif",boxShadow:'0 4px 20px rgba(139,92,246,0.5)'}}>
              Try Depth {msg.newDepth} →
            </button>
          )}
          <button onClick={onReset} style={{padding:'12px 28px',borderRadius:10,cursor:'pointer',background:pw?'rgba(34,197,94,0.2)':'#ef4444',color:pw?'#4ade80':'#fff',fontSize:16,fontWeight:700,fontFamily:"'DM Sans',sans-serif",border:pw?'1px solid #22c55e':'none'}}>
            {newDepthUnlocked ? 'Replay depth '+msg.prevDepth : 'Play Again'}
          </button>
        </div>
      </div>
    </div>
  );
};


// ═══════════════════════════════════════════════════════════════
// PRACTICE DRAWER
// ═══════════════════════════════════════════════════════════════
const PIECES_INFO = [
  {key:'K',name:'King',sym:'♚',value:'∞',color:'#f59e0b',desc:"The most important piece. Moves one square in any direction. Cannot move into check.",moves:[[2,2],[2,3],[2,4],[3,2],[3,4],[4,2],[4,3],[4,4]],from:[3,3]},
  {key:'Q',name:'Queen',sym:'♛',value:'9',color:'#a855f7',desc:"Most powerful piece. Moves any number of squares in any direction — row, column, or diagonal.",moves:[[0,3],[1,3],[2,3],[3,0],[3,1],[3,2],[3,4],[3,5],[3,6],[3,7],[4,4],[5,5],[6,6],[7,7],[2,4],[1,5],[0,6],[4,2],[5,1],[6,0]],from:[3,3]},
  {key:'R',name:'Rook',sym:'♜',value:'5',color:'#8b5cf6',desc:"Moves any number of squares horizontally or vertically. Essential for endgames.",moves:[[0,3],[1,3],[2,3],[3,0],[3,1],[3,2],[3,4],[3,5],[3,6],[3,7],[4,3],[5,3],[6,3],[7,3]],from:[3,3]},
  {key:'B',name:'Bishop',sym:'♝',value:'3',color:'#10b981',desc:"Moves any number of squares diagonally. Always stays on the same color square.",moves:[[0,0],[1,1],[2,2],[4,4],[5,5],[6,6],[7,7],[0,6],[1,5],[2,4],[4,2],[5,1],[6,0]],from:[3,3]},
  {key:'N',name:'Knight',sym:'♞',value:'3',color:'#7c3aed',desc:"Moves in an L-shape. The only piece that can jump over others.",moves:[[1,2],[1,4],[2,1],[2,5],[4,1],[4,5],[5,2],[5,4]],from:[3,3]},
  {key:'P',name:'Pawn',sym:'♟',value:'1',color:'#a78bfa',desc:"Moves forward one square (two from starting row). Captures diagonally. Promotes on the last rank.",moves:[[2,3]],from:[3,3],special:true},
];

const RULES = [
  {icon:'♟',title:'Objective',body:"Checkmate the opponent's King — trap it with no escape."},
  {icon:'♜',title:'Capturing',body:'Move onto an enemy square to capture that piece.'},
  {icon:'♛',title:'Check',body:"Your King is in check when under attack. You must deal with it immediately."},
  {icon:'♞',title:'Castling',body:"King swaps with Rook (2 squares). Neither can have moved, King not in check."},
  {icon:'♝',title:'En passant',body:'Special pawn capture: if enemy pawn moves 2 squares beside yours, you can capture it.'},
  {icon:'♚',title:'Promotion',body:'Pawn reaches the far end — replace it with any piece (almost always a Queen).'},
];

const PieceBoard = ({piece}) => {
  const squares = Array.from({length:64}, (_,i) => {
    const row = Math.floor(i/8), col = i%8;
    const isLight = (row+col)%2===0;
    const isFrom = piece.from[0]===row && piece.from[1]===col;
    const isMove = piece.moves.some(([r,c])=>r===row&&c===col);
    let bg = isLight ? '#f0d9b5' : '#b58863';
    if (isFrom) bg = isLight ? '#cdd16f' : '#aaa23a';
    else if (isMove) bg = isLight ? '#cdd16f88' : '#aaa23a88';
    return (
      <div key={i} style={{background:bg,display:'flex',alignItems:'center',justifyContent:'center',aspectRatio:'1'}}>
        {isFrom && <span style={{fontSize:'1.25rem',lineHeight:1,color:piece.color,userSelect:'none'}}>{piece.sym}</span>}
        {isMove && !isFrom && <div style={{width:'30%',height:'30%',borderRadius:'50%',background:piece.color,opacity:0.5}}/>}
      </div>
    );
  });
  return <div style={{display:'grid',gridTemplateColumns:'repeat(8,1fr)',width:160,height:160,borderRadius:6,overflow:'hidden',border:'2px solid #3b1f6e',flexShrink:0}}>{squares}</div>;
};

const PracticeDrawer = ({isOpen, onClose}) => {
  const [pBoard, setPBoard] = useState(STARTING_BOARD);
  const [pSel, setPSel] = useState(null);
  const [pLog, setPLog] = useState([]);
  const [pMsg, setPMsg] = useState(null);

  const pHL = pSel !== null ? genMoves(pBoard,'w').filter(m=>m.fromIndex===pSel).map(m=>m.toIndex) : [];

  const pClick = (idx) => {
    if (pMsg) return;
    const pc = pBoard[idx];
    if (pSel !== null) {
      if (pSel === idx) { setPSel(null); return; }
      const mv = genMoves(pBoard,'w').find(m=>m.fromIndex===pSel&&m.toIndex===idx);
      if (mv) {
        const nb = [...mv.newBoard];
        setPBoard(nb);
        setPLog(l=>[...l,{side:'w',notation:mv.notation}]);
        if (!nb.includes('k')) { setPMsg('You captured the Black King!'); setPSel(null); return; }
        const bm = orderMoves(genMoves(nb,'b'))[0];
        if (bm) {
          const nb2 = [...bm.newBoard];
          setPBoard(nb2);
          setPLog(l=>[...l,{side:'b',notation:bm.notation}]);
          if (!nb2.includes('K')) setPMsg('Black captured your King!');
        }
        setPSel(null);
      } else {
        if (pc && pc===pc.toUpperCase()) setPSel(idx); else setPSel(null);
      }
    } else {
      if (pc && pc===pc.toUpperCase()) setPSel(idx);
    }
  };

  const pReset = () => { setPBoard(STARTING_BOARD); setPSel(null); setPLog([]); setPMsg(null); };

  return (
    <div>
      {isOpen && <div onClick={onClose} style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.5)',zIndex:199}}/>}
      <div style={{position:'fixed',top:0,right:0,height:'100%',width:420,maxWidth:'95vw',background:'#1a0e30',borderLeft:'1px solid #3b1f6e',zIndex:200,transform:isOpen?'translateX(0)':'translateX(100%)',transition:'transform 0.3s ease',display:'flex',flexDirection:'column'}}>
        <div style={{padding:'14px 20px',borderBottom:'1px solid #2d1654',display:'flex',alignItems:'center',justifyContent:'space-between',background:'#160c28',boxShadow:'0 1px 8px rgba(139,92,246,0.06)',flexShrink:0}}>
          <div style={{fontSize:16,fontWeight:700,color:'#e2d9f3'}}>Practice Board</div>
          <div style={{display:'flex',gap:8}}>
            <button onClick={pReset} style={{padding:'4px 12px',background:'transparent',border:'1px solid #3b1f6e',borderRadius:6,color:'#a78bfa',fontSize:14,cursor:'pointer'}}>Reset</button>
            <button onClick={onClose} style={{width:28,height:28,borderRadius:'50%',border:'1px solid #3b1f6e',background:'transparent',color:'#a78bfa',fontSize:16,cursor:'pointer'}}>x</button>
          </div>
        </div>
        <div style={{flex:1,overflowY:'auto',padding:20}}>
          {pMsg && (
            <div style={{marginBottom:12,padding:'8px 14px',background:'rgba(124,58,237,0.08)',border:'1px solid rgba(124,58,237,0.2)',borderRadius:8,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
              <span style={{fontSize:14,color:'#a78bfa'}}>{pMsg}</span>
              <button onClick={pReset} style={{fontSize:14,color:'#8b5cf6',background:'rgba(124,58,237,0.1)',border:'1px solid rgba(139,92,246,0.3)',borderRadius:5,padding:'2px 8px',cursor:'pointer'}}>Again</button>
            </div>
          )}
          <div style={{display:'flex',justifyContent:'center',marginBottom:14}}>
            <div>
              {Array.from({length:8},(_,row)=>(
                <div key={row} style={{display:'flex'}}>
                  <div style={{width:14,display:'flex',alignItems:'center',justifyContent:'center',fontSize:12,color:'#a78bfa',userSelect:'none'}}>{8-row}</div>
                  {Array.from({length:8},(_,col)=>{
                    const idx=row*8+col, pc=pBoard[idx];
                    const isLight=(row+col)%2===0, isSel=pSel===idx, isHL=pHL.includes(idx), isWP=pc&&pc===pc.toUpperCase();
                    let bg=isLight?'#f0d9b5':'#b58863';
                    if(isSel) bg='rgba(139,92,246,0.75)';
                    else if(isHL) bg=pc?'rgba(239,68,68,0.55)':'rgba(255,214,0,0.45)';
                    return (
                      <div key={col} onClick={()=>pClick(idx)} style={{width:44,height:44,background:bg,display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer',position:'relative'}}>
                        {pc && <span style={{fontSize:'1.7rem',lineHeight:1,color:isWP?'#fff':'#1a0a2e',textShadow:isWP?'0 1px 2px rgba(0,0,0,0.9)':'none',userSelect:'none'}}>{SYM[pc]}</span>}
                        {isHL&&!pc && <div style={{width:12,height:12,borderRadius:'50%',background:'rgba(255,214,0,0.8)',pointerEvents:'none'}}/>}
                        {row===7 && <div style={{position:'absolute',bottom:1,right:2,fontSize:10,color:'rgba(0,0,0,0.3)',userSelect:'none'}}>{'abcdefgh'[col]}</div>}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
          <div style={{background:'#160c2a',borderRadius:8,padding:'10px 14px',border:'1px solid #4c2889'}}>
            <div style={{fontSize:13,color:'#a78bfa',letterSpacing:1.5,textTransform:'uppercase',marginBottom:6}}>Move Log</div>
            {pLog.length===0
              ? <div style={{fontSize:14,color:'#c4b5fd',fontStyle:'italic'}}>Click a White piece to start</div>
              : Array.from({length:Math.ceil(pLog.length/2)},(_,i)=>(
                  <div key={i} style={{display:'flex',gap:8,fontSize:14,marginBottom:2}}>
                    <span style={{color:'#a78bfa',width:18,textAlign:'right'}}>{i+1}.</span>
                    <span style={{color:'#e2d9f3',minWidth:48}}>{pLog[i*2]&&pLog[i*2].notation}</span>
                    {pLog[i*2+1]&&<span style={{color:'#a78bfa'}}>{pLog[i*2+1].notation}</span>}
                  </div>
                ))
            }
          </div>
          <div style={{marginTop:10,fontSize:14,color:'#c4b5fd',textAlign:'center',lineHeight:1.6}}>
            Click White piece to see moves. Yellow = empty. Red = capture.
          </div>
        </div>
      </div>
    </div>
  );
};


// ═══════════════════════════════════════════════════════════════
// CHESS KNOWLEDGE PAGE — tool overview + chess familiarity
// ═══════════════════════════════════════════════════════════════
const ChessKnowledgePage = ({userName, onAnswer, onBack}) => (
  <div style={{minHeight:'100vh',background:'#0e0820',display:'flex',alignItems:'center',justifyContent:'center',fontFamily:"'DM Sans',sans-serif",padding:'28px 20px',overflowY:'auto'}}>
    <style>{`
      @keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-8px)}}
      @keyframes glow{0%,100%{filter:drop-shadow(0 0 12px rgba(139,92,246,0.6))}50%{filter:drop-shadow(0 0 28px rgba(167,139,250,0.9))}}
      @keyframes shimmer{0%{background-position:300% center}100%{background-position:-300% center}}
      .float{animation:float 3s ease-in-out infinite}
      .glow{animation:glow 2.5s ease-in-out infinite}
      .shine{display:inline-block;background:linear-gradient(90deg,#a78bfa 0%,#e9d5ff 30%,#ffffff 50%,#e9d5ff 70%,#a78bfa 100%);background-size:300% auto;-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;animation:shimmer 2.5s linear infinite}
      .fade-in{animation:fadeUp 0.35s ease both}
      @keyframes fadeUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
    `}</style>
    <div className="fade-in" style={{maxWidth:520,width:'100%'}}>

      {/* Back button */}
      <button onClick={onBack} style={{display:'flex',alignItems:'center',gap:6,background:'none',border:'none',color:'#4c2889',fontSize:13,cursor:'pointer',fontFamily:"'DM Mono',monospace",marginBottom:16,padding:0}}
        onMouseEnter={e=>e.currentTarget.style.color='#a78bfa'} onMouseLeave={e=>e.currentTarget.style.color='#4c2889'}>
        ← back
      </button>

      {/* Logo — same as WelcomePage */}
      <div style={{textAlign:'center',marginBottom:28}}>
        <div className="float" style={{fontSize:64,lineHeight:1,marginBottom:10,color:'#fff'}}>
          <span className="glow">♚</span>
        </div>
        <div style={{fontSize:26,fontWeight:800,letterSpacing:-0.5,lineHeight:1,marginBottom:6,textAlign:'center'}}>
          <span className="shine">Minimax Chess</span>
        </div>

        <div style={{fontSize:15,fontWeight:700,color:'#a78bfa',fontFamily:"'DM Mono',monospace",textAlign:'center'}}>
          Hey {userName}, here is what you will do! 👋
        </div>
      </div>

      {/* 3 phases — compact icon cards */}
      <div style={{display:'flex',flexDirection:'column',gap:8,marginBottom:24}}>
        {[
          {icon:'🎮',color:'#94a3b8',step:'Game 1 — Play',title:'Play against the bot'},
          {icon:'🌳',color:'#38bdf8',step:'Game 2 — Learn',title:'Learn how the bot thinks'},
          {icon:'🧠',color:'#a78bfa',step:'Game 3 — Apply',title:'Apply the algorithm — free play'},
        ].map(({icon,color,step,title})=>(
          <div key={step} style={{display:'flex',gap:14,padding:'14px 16px',background:'#160c28',borderRadius:12,border:`1px solid ${color}30`,alignItems:'center'}}>
            <div style={{fontSize:32,flexShrink:0,lineHeight:1}}>{icon}</div>
            <div style={{flex:1}}>
              <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
                <span style={{fontSize:11,color,background:color+'15',border:`1px solid ${color}40`,borderRadius:99,padding:'2px 9px',fontFamily:"'DM Mono',monospace",fontWeight:700,letterSpacing:0.5}}>{step}</span>
                <span style={{fontSize:15,fontWeight:700,color:'#e2d9f3'}}>{title}</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Chess question */}
      <div style={{background:'rgba(124,58,237,0.06)',border:'1px solid #3b1f6e',borderRadius:14,padding:'16px 18px'}}>
        <div style={{fontSize:14,fontWeight:700,color:'#c4b5fd',marginBottom:12,textAlign:'center'}}>
          One quick thing — do you know chess? ♟
        </div>
        <div style={{display:'flex',flexDirection:'column',gap:8}}>
          <button onClick={()=>onAnswer(true)}
            style={{padding:'12px 16px',borderRadius:10,border:'2px solid #3b1f6e',cursor:'pointer',background:'transparent',color:'#e2d9f3',fontSize:14,fontWeight:600,fontFamily:"'DM Sans',sans-serif",textAlign:'left',display:'flex',alignItems:'center',gap:12,transition:'all 0.15s'}}
            onMouseEnter={e=>{e.currentTarget.style.borderColor='#22c55e';e.currentTarget.style.background='rgba(34,197,94,0.06)';}}
            onMouseLeave={e=>{e.currentTarget.style.borderColor='#3b1f6e';e.currentTarget.style.background='transparent';}}>
            <span style={{fontSize:20}}>♟</span>
            <div>
              <div style={{fontWeight:700}}>Yep, I know how to play!</div>
              <div style={{fontSize:12,color:'#a78bfa',fontWeight:400,fontFamily:"'DM Mono',monospace",marginTop:2}}>Chess rules panel available if you need a reminder</div>
            </div>
          </button>
          <button onClick={()=>onAnswer(false)}
            style={{padding:'12px 16px',borderRadius:10,border:'2px solid #3b1f6e',cursor:'pointer',background:'transparent',color:'#e2d9f3',fontSize:14,fontWeight:600,fontFamily:"'DM Sans',sans-serif",textAlign:'left',display:'flex',alignItems:'center',gap:12,transition:'all 0.15s'}}
            onMouseEnter={e=>{e.currentTarget.style.borderColor='#a78bfa';e.currentTarget.style.background='rgba(124,58,237,0.07)';}}
            onMouseLeave={e=>{e.currentTarget.style.borderColor='#3b1f6e';e.currentTarget.style.background='transparent';}}>
            <span style={{fontSize:20}}>📖</span>
            <div>
              <div style={{fontWeight:700}}>No, let me learn how to play!</div>
              <div style={{fontSize:12,color:'#a78bfa',fontWeight:400,fontFamily:"'DM Mono',monospace",marginTop:2}}>Rules panel auto-opens on the right side of the board</div>
            </div>
          </button>
        </div>
      </div>

    </div>
  </div>
);


const WelcomePage = ({onStart}) => {
  const [name,         setName]         = useState('');
  const [lastInitial,  setLastInitial]  = useState('');
  const [age,          setAge]          = useState('');
  const [grade,        setGrade]        = useState('');
  const [error,        setError]        = useState('');

  const submit = () => {
    if(!name.trim())           { setError('Please enter your first name.');   return; }
    if(!lastInitial.trim())    { setError('Please enter your last initial.');  return; }
    if(!age || isNaN(age) || Number(age)<4 || Number(age)>99)
                                { setError('Please enter a valid age.');        return; }
    if(!grade.trim())          { setError('Please enter your grade.');         return; }
    onStart({ name: name.trim(), lastInitial: lastInitial.trim().toUpperCase().charAt(0), age: Number(age), grade: grade.trim() });
  };

  const field = (label, content) => (
    <div style={{display:'flex',flexDirection:'column',gap:6}}>
      <label style={{fontSize:13,fontWeight:700,color:'#a78bfa',fontFamily:"'DM Mono',monospace",letterSpacing:1.5,textTransform:'uppercase'}}>{label}</label>
      {content}
    </div>
  );

  const inp = (extra={}) => ({
    style:{
      padding:'11px 14px', borderRadius:8, border:'1px solid #4c2889',
      background:'#160c2a', color:'#e2d9f3', fontSize:16,
      fontFamily:"'DM Sans',sans-serif", outline:'none', width:'100%',
      transition:'border-color 0.2s',
      ...extra,
    },
    className:'wf',
    onKeyDown: e=>e.key==='Enter'&&submit(),
  });

  return (
    <div style={{minHeight:'100vh',width:'100%',background:'#0e0820',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',padding:'24px 20px',fontFamily:"'DM Sans',sans-serif"}}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&family=DM+Mono:wght@400;500;700&display=swap');
        *{box-sizing:border-box;margin:0;padding:0}
        html,body,#root{width:100%;min-height:100vh;background:#0e0820}
        body{font-family:'DM Sans',sans-serif}
        ::-webkit-scrollbar{width:6px;height:6px}
        ::-webkit-scrollbar-track{background:#160c2a}
        ::-webkit-scrollbar-thumb{background:#c4b5fd;border-radius:3px}
        ::-webkit-scrollbar-thumb:hover{background:#a78bfa}
        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes fadeUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
        @keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-8px)}}
        @keyframes nodePulse{0%,100%{box-shadow:0 0 0 3px #8b5cf6,0 0 16px rgba(124,58,237,0.4)}50%{box-shadow:0 0 0 7px rgba(124,58,237,0.12),0 0 28px rgba(139,92,246,0.5)}}
        @keyframes bounceDown{0%,100%{transform:translateY(0)}50%{transform:translateY(5px)}}
        @keyframes shimmer{0%{background-position:300% center}100%{background-position:-300% center}}
        @keyframes glow{0%,100%{filter:drop-shadow(0 0 12px rgba(139,92,246,0.6))}50%{filter:drop-shadow(0 0 28px rgba(167,139,250,0.9))}}
        .fin{animation:fadeUp 0.35s ease both}
        .fade-in{animation:fadeUp 0.35s ease both}
        .wup{animation:fadeUp 0.5s ease both}
        .shine{display:inline-block;background:linear-gradient(90deg,#a78bfa 0%,#e9d5ff 30%,#ffffff 50%,#e9d5ff 70%,#a78bfa 100%);background-size:300% auto;-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;animation:shimmer 2.5s linear infinite}
        .float{animation:float 3s ease-in-out infinite}
        .glow{animation:glow 2.5s ease-in-out infinite}
        .wf:focus{outline:none;border-color:#8b5cf6!important;box-shadow:0 0 0 3px rgba(124,58,237,0.15)!important}
        .funbtn{transition:all 0.18s}
        .funbtn:hover{transform:translateY(-2px);box-shadow:0 8px 32px rgba(139,92,246,0.55)!important}`}</style>

      <div className="wup" style={{width:'100%',maxWidth:480,display:'flex',flexDirection:'column',alignItems:'center',gap:0}}>

        {/* Logo — same as ChessKnowledgePage */}
        <div className="float" style={{fontSize:64,lineHeight:1,marginBottom:10,color:'#fff'}}>
          <span className="glow">♚</span>
        </div>
        <div style={{fontSize:26,fontWeight:800,letterSpacing:-0.5,lineHeight:1,marginBottom:6,textAlign:'center'}}>
          <span className="shine">Minimax Chess</span>
        </div>


        {/* Play → Learn → Apply tagline */}
        <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:28}}>
          {[['🎮','Play'],['🌳','Learn'],['🧠','Apply']].map(([emoji,label],i)=>(
            <React.Fragment key={label}>
              <div style={{display:'flex',alignItems:'center',gap:5,padding:'5px 14px',background:'rgba(124,58,237,0.1)',border:'1px solid #3b1f6e',borderRadius:99}}>
                <span style={{fontSize:14}}>{emoji}</span>
                <span style={{fontSize:13,fontWeight:700,color:'#c4b5fd',fontFamily:"'DM Mono',monospace"}}>{label}</span>
              </div>
              {i < 2 && <span style={{color:'#3b1f6e',fontSize:16,fontWeight:700}}>&#8594;</span>}
            </React.Fragment>
          ))}
        </div>

        {/* Form card */}
        <div style={{width:'100%',background:'#160c28',border:'1px solid #4c2889',borderRadius:20,padding:'24px 28px',boxShadow:'0 4px 40px rgba(139,92,246,0.12)',display:'flex',flexDirection:'column',gap:16}}>
          <div style={{fontSize:15,fontWeight:700,color:'#a78bfa',textAlign:'center'}}>
            Who are you? 👋
          </div>

          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
            {field('First Name',
              <input {...inp()} value={name} onChange={e=>{setName(e.target.value);setError('');}} autoFocus/>
            )}
            {field('Last Initial',
              <input {...inp({textTransform:'uppercase'})} maxLength={1} value={lastInitial}
                onChange={e=>{setLastInitial(e.target.value.replace(/[^a-zA-Z]/,''));setError('');}}/>
            )}
            {field('Age',
              <input {...inp()} type="number" min="4" max="99" value={age}
                onChange={e=>{setAge(e.target.value);setError('');}}/>
            )}
            {field('Grade',
              <input {...inp()} value={grade}
                onChange={e=>{setGrade(e.target.value);setError('');}}/>
            )}
          </div>

          {error && (
            <div style={{padding:'8px 12px',background:'rgba(239,68,68,0.07)',border:'1px solid rgba(239,68,68,0.2)',borderRadius:8,fontSize:13,color:'#f87171',fontFamily:"'DM Mono',monospace"}}>
              ⚠ {error}
            </div>
          )}

          <button onClick={submit} className="funbtn"
            style={{padding:'14px',borderRadius:12,border:'none',cursor:'pointer',
              background:'linear-gradient(135deg,#7c3aed,#9333ea)',
              color:'#fff',fontSize:17,fontWeight:800,letterSpacing:0.3,
              fontFamily:"'DM Sans',sans-serif",
              boxShadow:'0 4px 24px rgba(139,92,246,0.45)'}}>
            Start the Lab ⚗️ →
          </button>
        </div>

      </div>
    </div>
  );
};


const LearnPage = ({onNext, onPieceView, onPracticeBoardOpen}) => {
  const [active, setActive] = useState(0);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const pieceEnteredAt = React.useRef(Date.now());
  const piece = PIECES_INFO[active];
  return (
    <div style={{minHeight:'100vh',background:'#0e0820',color:'#e2d9f3',fontFamily:"'DM Sans',sans-serif",display:'flex',flexDirection:'column'}}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&family=DM+Mono:wght@400;500;700&display=swap');
        *{box-sizing:border-box;margin:0;padding:0}
        body{font-family:'DM Sans',sans-serif}
        ::-webkit-scrollbar{width:6px;height:6px}
        ::-webkit-scrollbar-track{background:#160c2a}
        ::-webkit-scrollbar-thumb{background:#c4b5fd;border-radius:3px}
        ::-webkit-scrollbar-thumb:hover{background:#a78bfa}
        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes fadeUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
        @keyframes nodePulse{0%,100%{box-shadow:0 0 0 3px #8b5cf6,0 0 16px rgba(124,58,237,0.4)}50%{box-shadow:0 0 0 7px rgba(124,58,237,0.12),0 0 28px rgba(139,92,246,0.5)}}
        @keyframes bounceDown{0%,100%{transform:translateY(0)}50%{transform:translateY(5px)}}
        .fin{animation:fadeUp 0.35s ease both}
        .fade-in{animation:fadeUp 0.35s ease both}
        .wup{animation:fadeUp 0.5s ease both}
        @keyframes shimmer{0%{background-position:300% center}100%{background-position:-300% center}}
        .shine{display:inline-block;background:linear-gradient(90deg,#a78bfa 0%,#e9d5ff 30%,#ffffff 50%,#e9d5ff 70%,#a78bfa 100%);background-size:300% auto;-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;animation:shimmer 2.5s linear infinite}
        .wf:focus{outline:none;border-color:#8b5cf6!important;box-shadow:0 0 0 3px rgba(124,58,237,0.15)!important}`}</style>
      <div style={{borderBottom:'1px solid #3b1f6e',padding:'14px 32px',display:'flex',alignItems:'center',justifyContent:'space-between',background:'#160c28',boxShadow:'0 1px 8px rgba(139,92,246,0.06)',flexShrink:0}}>
        <div style={{display:'flex',alignItems:'center',gap:12}}>
          <div style={{fontSize:44,lineHeight:1,color:'#fff',filter:'drop-shadow(0 0 16px rgba(139,92,246,0.8))',marginBottom:4}}>♔</div>
          <div>
            <div style={{fontSize:17,fontWeight:800,letterSpacing:-0.3}}><span className="shine">Minimax Chess</span></div>
            <div style={{fontSize:13,color:'#a78bfa',fontFamily:"'DM Mono',monospace"}}>Step 1 of 3 — Learn the pieces</div>
          </div>
        </div>
        <div style={{display:'flex',gap:8}}>
          <button onClick={()=>{setDrawerOpen(true);if(onPracticeBoardOpen)onPracticeBoardOpen('header_button');}} style={{padding:'8px 16px',background:'transparent',border:'1px solid #7c3aed',borderRadius:8,color:'#a78bfa',fontSize:14,fontWeight:700,cursor:'pointer'}}>Practice Board</button>
          <button onClick={onNext} style={{padding:'8px 18px',background:'linear-gradient(135deg,#7c3aed,#c4b5fd)',border:'none',borderRadius:8,color:'#fff',fontSize:14,fontWeight:700,cursor:'pointer'}}>Learn Minimax →</button>
        </div>
      </div>
      <div style={{flex:1,overflowY:'auto',padding:'40px 32px'}}>
        <div className="fin" style={{textAlign:'center',marginBottom:40}}>
          <div style={{fontSize:14,color:'#a78bfa',fontFamily:"'DM Mono',monospace",letterSpacing:2,textTransform:'uppercase',marginBottom:8}}>Chess Fundamentals</div>
          <div style={{fontSize:28,fontWeight:800,color:'#e2d9f3',marginBottom:8}}>Learn Before You Play</div>
          <div style={{fontSize:15,color:'#a78bfa'}}>Learn the pieces, then face the bot.</div>
        </div>

        <div className="fin" style={{marginBottom:48}}>
          <div style={{fontSize:14,color:'#a78bfa',fontFamily:"'DM Mono',monospace",letterSpacing:2,textTransform:'uppercase',marginBottom:20,display:'flex',alignItems:'center',gap:10}}>
            <div style={{flex:1,height:1,background:'#3b1f6e'}}/>The Pieces<div style={{flex:1,height:1,background:'#3b1f6e'}}/>
          </div>
          <div style={{display:'flex',gap:8,flexWrap:'wrap',justifyContent:'center',marginBottom:24}}>
            {PIECES_INFO.map((p,i)=>(
              <button key={p.key} onClick={()=>{const dwell=Date.now()-pieceEnteredAt.current;pieceEnteredAt.current=Date.now();setActive(i);if(onPieceView)onPieceView(p.name,dwell);}} style={{padding:'8px 16px',borderRadius:9,border:'1.5px solid '+(active===i?p.color:'#3b1f6e'),background:active===i?p.color+'18':'transparent',color:active===i?p.color:'#a78bfa',fontSize:14,fontWeight:active===i?700:400,cursor:'pointer',transition:'all 0.15s',display:'flex',alignItems:'center',gap:6}}>
                <span style={{fontSize:'1.1rem'}}>{p.sym}</span>{p.name}
              </button>
            ))}
          </div>
          <div style={{background:'#160c28',border:'1px solid '+piece.color+'33',borderRadius:16,padding:'24px 28px',boxShadow:'0 4px 20px rgba(139,92,246,0.07)',display:'flex',gap:28,alignItems:'flex-start',flexWrap:'wrap'}}>
            <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:10,flexShrink:0}}>
              <PieceBoard piece={piece}/>
              <div style={{display:'flex',alignItems:'center',gap:6,fontSize:13,color:'#a78bfa',fontFamily:"'DM Mono',monospace"}}>
                <div style={{width:10,height:10,borderRadius:'50%',background:piece.color,opacity:0.5}}/> reachable squares
              </div>
            </div>
            <div style={{flex:1,minWidth:200}}>
              <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:12}}>
                <span style={{fontSize:'2.5rem',color:piece.color}}>{piece.sym}</span>
                <div>
                  <div style={{fontSize:19,fontWeight:700,color:'#e2d9f3'}}>{piece.name}</div>
                  <div style={{fontSize:14,color:piece.color,fontFamily:"'DM Mono',monospace"}}>Value: {piece.value} pts</div>
                </div>
              </div>
              <div style={{fontSize:15,color:'#a78bfa',lineHeight:1.7,marginBottom:14}}>{piece.desc}</div>
              {piece.special && <div style={{padding:'8px 12px',background:'rgba(250,204,21,0.07)',border:'1px solid rgba(250,204,21,0.2)',borderRadius:7,fontSize:14,color:'#b45309'}}>Pawns capture diagonally even though they move straight forward!</div>}
            </div>
          </div>
        </div>

        <div className="fin" style={{marginBottom:48}}>
          <div style={{fontSize:14,color:'#a78bfa',fontFamily:"'DM Mono',monospace",letterSpacing:2,textTransform:'uppercase',marginBottom:20,display:'flex',alignItems:'center',gap:10}}>
            <div style={{flex:1,height:1,background:'#3b1f6e'}}/>Key Rules<div style={{flex:1,height:1,background:'#3b1f6e'}}/>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(280px,1fr))',gap:12}}>
            {RULES.map((r,i)=>(
              <div key={i} style={{background:'#160c28',borderRadius:12,padding:'18px 20px',border:'1px solid #3b1f6e',display:'flex',gap:12,alignItems:'flex-start',boxShadow:'0 2px 10px rgba(139,92,246,0.06)'}}>
                <span style={{fontSize:'1.5rem',flexShrink:0}}>{r.icon}</span>
                <div>
                  <div style={{fontSize:15,fontWeight:700,color:'#e2d9f3',marginBottom:4}}>{r.title}</div>
                  <div style={{fontSize:14,color:'#a78bfa',lineHeight:1.6}}>{r.body}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="fin" style={{marginBottom:48}}>
          <div style={{fontSize:14,color:'#a78bfa',fontFamily:"'DM Mono',monospace",letterSpacing:2,textTransform:'uppercase',marginBottom:20,display:'flex',alignItems:'center',gap:10}}>
            <div style={{flex:1,height:1,background:'#3b1f6e'}}/>How Smart is the Bot?<div style={{flex:1,height:1,background:'#3b1f6e'}}/>
          </div>
          <div style={{display:'flex',flexDirection:'column',gap:8}}>
            {[
              {d:3,label:'Depth 3',sub:'bot → you → bot',badge:'Start here',locked:false},
              {d:4,label:'Depth 4',sub:'bot → you → bot → you',badge:'Beat depth 3',locked:true},
              {d:5,label:'Depth 5',sub:'bot → you → bot → you → bot',badge:'Beat depth 4',locked:true},
            ].map(({d,label,sub,badge,locked})=>(
              <div key={d} style={{display:'flex',alignItems:'center',gap:14,padding:'12px 16px',background:locked?'transparent':'rgba(139,92,246,0.07)',border:'1px solid '+(locked?'#2d1b4e':'#7c3aed'),borderRadius:10,opacity:locked?0.5:1}}>
                <div style={{width:36,height:36,borderRadius:8,background:locked?'#1e1035':'rgba(139,92,246,0.2)',border:'1px solid '+(locked?'#2d1b4e':'#7c3aed'),display:'flex',alignItems:'center',justifyContent:'center',fontSize:18,fontWeight:900,color:locked?'#4a2d72':'#c4b5fd',fontFamily:"'DM Mono',monospace",flexShrink:0}}>{d}</div>
                <div style={{flex:1}}>
                  <div style={{fontSize:14,fontWeight:700,color:locked?'#4a2d72':'#e2d9f3',marginBottom:2}}>{label}</div>
                  <div style={{fontSize:12,color:'#6b3fa0',fontFamily:"'DM Mono',monospace"}}>{sub}</div>
                </div>
                <div style={{fontSize:11,color:locked?'#4a2d72':'#8b5cf6',background:locked?'transparent':'rgba(139,92,246,0.12)',border:'1px solid '+(locked?'#2d1b4e':'#7c3aed'),borderRadius:99,padding:'3px 10px',fontFamily:"'DM Mono',monospace",whiteSpace:'nowrap'}}>{locked?'🔒 '+badge:badge}</div>
              </div>
            ))}
          </div>
          <div style={{marginTop:14,fontSize:14,color:'#a78bfa',fontFamily:"'DM Mono',monospace",textAlign:'center',lineHeight:1.8}}>
            Each extra depth level roughly <span style={{color:'#a78bfa'}}>triples</span> positions searched. Beat each level to unlock the next.
          </div>
        </div>

        <div className="fin" style={{textAlign:'center',padding:'40px 0 20px'}}>
          <div style={{fontSize:16,color:'#a78bfa',marginBottom:20}}>Ready to play?</div>
          <div style={{display:'flex',gap:12,justifyContent:'center',flexWrap:'wrap'}}>
            <button onClick={()=>{setDrawerOpen(true);if(onPracticeBoardOpen)onPracticeBoardOpen('bottom_button');}} style={{padding:'14px 28px',background:'transparent',border:'1px solid #7c3aed',borderRadius:10,color:'#a78bfa',fontSize:16,fontWeight:700,cursor:'pointer'}}>Practice Board</button>
            <button onClick={onNext} style={{padding:'14px 36px',background:'linear-gradient(135deg,#7c3aed,#c4b5fd)',border:'none',borderRadius:10,color:'#fff',fontSize:16,fontWeight:700,cursor:'pointer',boxShadow:'0 4px 20px rgba(139,92,246,0.25)'}}>Learn Minimax →</button>
          </div>
        </div>
      </div>
      <PracticeDrawer isOpen={drawerOpen} onClose={()=>setDrawerOpen(false)}/>
    </div>
  );
};

const MINIMAX_STEPS = [
  {emoji:'🤔',title:'The Core Idea',color:'#7c3aed',body:"The bot doesn't just find its best move — it assumes you'll always play your best too. It must win even against a perfect opponent."},
  {emoji:'🌳',title:'The Search Tree',color:'#6d28d9',body:'The bot builds a tree of every possible move and reply, several levels deep, then scores each position at the bottom.'},
  {emoji:'📊',title:'Scoring',color:'#c4b5fd',body:'Leaf nodes are scored by counting material. Q=9, R=5, B/N=3, P=1. Positive = bot ahead. Negative = you ahead.'},
  {emoji:'🤖',title:'MAX — Bot Picks Highest',color:'#7c3aed',body:"At the bot's turn in the tree, it picks the branch with the HIGHEST score. Purple MAX nodes."},
  {emoji:'😊',title:'MIN — Bot Models You',color:'#9333ea',body:"At your turn, the bot assumes you pick the LOWEST score branch — worst for the bot. Orange MIN nodes."},
  {emoji:'⬆️',title:'Scores Bubble Up',color:'#6d28d9',body:'Leaf scores travel back up. MIN passes up the lowest child; MAX passes up the highest. The root sees the true best move.'},
  {emoji:'🔭',title:'Search Depth',color:'#c4b5fd',body:'Depth = half-moves ahead. Depth 3: bot, you, bot. More depth = stronger bot. Beat each level to unlock the next.'},
];

const DepthFunFact = () => (
  <div style={{margin:'0 auto 24px',maxWidth:540,padding:'14px 18px',background:'rgba(56,189,248,0.07)',border:'1px solid rgba(56,189,248,0.2)',borderRadius:12}}>
    <div style={{fontSize:13,fontWeight:700,color:'#38bdf8',fontFamily:"'DM Mono',monospace",marginBottom:6}}>💡 Real-world depth</div>
    <div style={{fontSize:14,color:'#7dd3fc',fontFamily:"'DM Sans',sans-serif",lineHeight:1.7}}>
      Chess apps adjust bot difficulty by changing search depth — exactly what you just experienced.
      Depth 3 checks ~9,000 positions. Depth 5 checks ~3 million. World-class engines like Stockfish search <strong style={{color:'#e0f2fe'}}>20+ moves deep</strong> and evaluate millions of positions per second. The same minimax idea, just much, much deeper.
    </div>
  </div>
);

const MinimaxPage = ({onBack, onPlay, onStepView, onTreeTutorialStep, showDepthInfo, isModal}) => {
  const [step, setStep] = useState(0);
  const s = MINIMAX_STEPS[step];
  const isLast = step === MINIMAX_STEPS.length - 1;
  const stepEnteredAt = useRef(Date.now());

  const advanceStep = (next, direction) => {
    const ms = Date.now() - stepEnteredAt.current;
    if(onStepView) onStepView(step, MINIMAX_STEPS[step].title, ms, direction);
    stepEnteredAt.current = Date.now();
    setStep(next);
  };

  const showFact = showDepthInfo;
  const NodeBox = ({label, score, color, chosen}) => (
    <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:3}}>
      <div style={{padding:'6px 12px',borderRadius:8,border:'2px solid '+(chosen?'#22c55e':color),background:chosen?'rgba(34,197,94,0.1)':color+'18',minWidth:60,textAlign:'center'}}>
        <div style={{fontSize:13,fontWeight:700,color:chosen?'#22c55e':color,fontFamily:"'DM Mono',monospace"}}>{label}</div>
        {score!==undefined&&<div style={{fontSize:14,fontWeight:800,color:'#e2d9f3',fontFamily:"'DM Mono',monospace"}}>{score}</div>}
      </div>
      {chosen&&<div style={{fontSize:11,color:'#22c55e',fontFamily:"'DM Mono',monospace"}}>chosen</div>}
    </div>
  );

  const Vert = () => <div style={{width:2,height:16,background:'#3b1f6e',margin:'0 auto'}}/>;

  const visual = () => {
    // Step 1: Core Idea — two players with opposing goals
    if (s.emoji==='🤔') return (
      <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:18}}>
        <div style={{display:'flex',gap:0,alignItems:'stretch',borderRadius:10,overflow:'hidden',border:'1px solid #3b1f6e',boxShadow:'0 2px 12px rgba(139,92,246,0.08)',width:'100%',maxWidth:340}}>
          <div style={{background:'rgba(124,58,237,0.07)',padding:'20px 16px',textAlign:'center',flex:1}}>
            <div style={{fontSize:26,marginBottom:6}}>😊</div>
            <div style={{fontSize:14,fontWeight:700,color:'#c4b5fd',marginBottom:6}}>You</div>
            <div style={{fontSize:13,color:'#a78bfa',fontFamily:"'DM Mono',monospace",lineHeight:1.7}}>want score as<br/><span style={{color:'#16a34a',fontWeight:700}}>LOW as possible</span></div>
          </div>
          <div style={{display:'flex',alignItems:'center',justifyContent:'center',background:'#160c2a',padding:'0 12px',flexShrink:0}}>
            <div style={{fontSize:19,color:'#a78bfa'}}>⚔</div>
          </div>
          <div style={{background:'rgba(124,58,237,0.07)',padding:'20px 16px',textAlign:'center',flex:1}}>
            <div style={{fontSize:26,marginBottom:6}}>🤖</div>
            <div style={{fontSize:14,fontWeight:700,color:'#a78bfa',marginBottom:6}}>Bot</div>
            <div style={{fontSize:13,color:'#a78bfa',fontFamily:"'DM Mono',monospace",lineHeight:1.7}}>wants score as<br/><span style={{color:'#dc2626',fontWeight:700}}>HIGH as possible</span></div>
          </div>
        </div>
        <div style={{fontSize:14,color:'#a78bfa',fontFamily:"'DM Mono',monospace",textAlign:'center',lineHeight:1.9,maxWidth:320}}>
          The bot assumes you always play your best move.<br/>
          So it must find the move that wins<br/>
          <span style={{color:'#22c55e',fontWeight:700}}>even against a perfect opponent.</span>
        </div>
      </div>
    );

    // Step 2: The Tree — branching from root
    if (s.emoji==='🌳') return (
      <div style={{display:'flex',flexDirection:'column',alignItems:'center'}}>
        <NodeBox label="ROOT" color="#8b5cf6"/>
        <Vert/>
        <div style={{display:'flex',gap:20}}>
          {[['e4','#9333ea'],['d4','#9333ea'],['Nf3','#9333ea']].map(([l,c])=>(
            <div key={l} style={{display:'flex',flexDirection:'column',alignItems:'center'}}>
              <NodeBox label={l} color={c}/>
              <Vert/>
              <div style={{display:'flex',gap:8}}>
                {['e5','c5'].map(r=><NodeBox key={r} label={r} color="#f97316"/>)}
              </div>
            </div>
          ))}
        </div>
        <div style={{marginTop:12,fontSize:13,color:'#a78bfa',fontFamily:"'DM Mono',monospace",textAlign:'center'}}>
          3 bot moves × 2 replies = 6 leaf positions to score
        </div>
      </div>
    );

    // Step 3: Leaf Scores — piece values + score sign meaning
    if (s.emoji==='📊') return (
      <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:14}}>
        <div style={{display:'flex',gap:8,justifyContent:'center',flexWrap:'wrap'}}>
          {[['♛','Q','9','#a855f7'],['♜','R','5','#8b5cf6'],['♝','B','3','#10b981'],['♞','N','3','#9333ea'],['♟','P','1','#94a3b8']].map(([sym,name,val,col])=>(
            <div key={name} style={{textAlign:'center',padding:'9px 11px',background:'#160c2a',border:'1px solid #3b1f6e',borderRadius:8,minWidth:50}}>
              <div style={{fontSize:'1.5rem',color:col}}>{sym}</div>
              <div style={{fontSize:13,fontWeight:700,color:col,fontFamily:"'DM Mono',monospace"}}>{name}</div>
              <div style={{fontSize:15,fontWeight:800,color:'#e2d9f3',fontFamily:"'DM Mono',monospace"}}>{val}</div>
            </div>
          ))}
        </div>
        <div style={{display:'flex',gap:10,justifyContent:'center'}}>
          <div style={{padding:'7px 16px',borderRadius:8,background:'rgba(74,222,128,0.08)',border:'1px solid #4ade8066',fontSize:14,color:'#16a34a',fontFamily:"'DM Mono',monospace",textAlign:'center'}}>
            <div style={{fontWeight:700}}>score &lt; 0</div>
            <div style={{fontSize:13,opacity:0.8,marginTop:2}}>You are ahead</div>
          </div>
          <div style={{padding:'7px 16px',borderRadius:8,background:'rgba(248,113,113,0.08)',border:'1px solid #f8717166',fontSize:14,color:'#dc2626',fontFamily:"'DM Mono',monospace",textAlign:'center'}}>
            <div style={{fontWeight:700}}>score &gt; 0</div>
            <div style={{fontSize:13,opacity:0.8,marginTop:2}}>Bot is ahead</div>
          </div>
        </div>
      </div>
    );

    // Step 4: MAX — bot picks highest at its turn
    if (s.emoji==='🤖') return (
      <div style={{display:'flex',flexDirection:'column',alignItems:'center'}}>
        <NodeBox label="ROOT" color="#8b5cf6" score="?"/>
        <Vert/>
        <div style={{display:'flex',gap:20}}>
          <NodeBox label="e4" color="#9333ea" score="+1.0" chosen={true}/>
          <NodeBox label="d4" color="#9333ea" score="-0.5"/>
          <NodeBox label="Nf3" color="#9333ea" score="0.0"/>
        </div>
        <div style={{marginTop:12,fontSize:14,color:'#a78bfa',fontFamily:"'DM Mono',monospace"}}>MAX picks highest → e4 ✓</div>
      </div>
    );

    // Step 5: MIN — flows directly from e4 chosen in step 4
    if (s.emoji==='😊') return (
      <div style={{display:'flex',flexDirection:'column',alignItems:'center'}}>
        <div style={{fontSize:12,color:'#9333ea',marginBottom:3,fontFamily:"'DM Mono',monospace",opacity:0.75}}>bot chose e4 (MAX) ↓</div>
        <NodeBox label="e4" color="#9333ea" score="+1.0" chosen={true}/>
        <Vert/>
        <div style={{fontSize:12,color:'#f97316',marginBottom:5,fontFamily:"'DM Mono',monospace"}}>your turn — MIN picks lowest</div>
        <div style={{display:'flex',gap:20}}>
          <NodeBox label="e5" color="#f97316" score="+1.0" chosen={true}/>
          <NodeBox label="c5" color="#f97316" score="+2.5"/>
          <NodeBox label="Nf6" color="#f97316" score="+3.0"/>
        </div>
        <div style={{marginTop:12,fontSize:14,color:'#f97316',fontFamily:"'DM Mono',monospace"}}>MIN picks lowest → e5 ✓</div>
      </div>
    );
    if (s.emoji==='⬆️') {
      // SVG tree flowing LEFT → RIGHT. 4 columns, rows evenly spaced.
      // Node box: 72w × 44h. Half-width = 36.
      // Columns (node centers): C0=52, C1=172, C2=292, C3=412
      // Rows (node centers):    R0=55, R1=135, R2=215, R3=295
      const NW=72, NH=44, NHW=36, NHH=22;
      const C=[52,172,292,412];
      const R=[55,135,215,295];
      const nodes = [
        {id:'root',x:C[0],y:(R[1]+R[2])/2, label:'ROOT',score:'+1.0',color:'#8b5cf6',role:'MAX',chosen:true},
        {id:'e4',  x:C[1],y:R[1],           label:'e4',  score:'+1.0',color:'#9333ea',role:'MAX',chosen:true},
        {id:'d4',  x:C[1],y:R[2],           label:'d4',  score:'-0.5',color:'#9333ea',role:'MAX',chosen:false},
        {id:'e5',  x:C[2],y:R[0],           label:'e5',  score:'+1.0',color:'#f97316',role:'MIN',chosen:true},
        {id:'c5',  x:C[2],y:R[1],           label:'c5',  score:'+2.5',color:'#f97316',role:'MIN',chosen:false},
        {id:'e6',  x:C[2],y:R[2],           label:'e6',  score:'-0.5',color:'#f97316',role:'MIN',chosen:true},
        {id:'d5',  x:C[2],y:R[3],           label:'d5',  score:'+0.8',color:'#f97316',role:'MIN',chosen:false},
        {id:'l1',  x:C[3],y:R[0],           label:'+1.0',color:'#a78bfa',role:'LEAF',chosen:true},
        {id:'l2',  x:C[3],y:R[1],           label:'+2.5',color:'#a78bfa',role:'LEAF',chosen:false},
        {id:'l3',  x:C[3],y:R[2],           label:'-0.5',color:'#a78bfa',role:'LEAF',chosen:true},
        {id:'l4',  x:C[3],y:R[3],           label:'+0.8',color:'#a78bfa',role:'LEAF',chosen:false},
      ];
      const edges = [
        {a:'root',b:'e4',hot:true}, {a:'root',b:'d4',hot:false},
        {a:'e4',  b:'e5',hot:true}, {a:'e4',  b:'c5',hot:false},
        {a:'d4',  b:'e6',hot:true}, {a:'d4',  b:'d5',hot:false},
        {a:'e5',  b:'l1',hot:true}, {a:'c5',  b:'l2',hot:false},
        {a:'e6',  b:'l3',hot:true}, {a:'d5',  b:'l4',hot:false},
      ];
      const byId = Object.fromEntries(nodes.map(n=>[n.id,n]));
      const W=470, H=350;
      const colLabels=[
        {x:C[0],label:'ROOT',color:'#8b5cf6'},
        {x:C[1],label:'MAX — bot picks',color:'#9333ea'},
        {x:C[2],label:'MIN — you pick',color:'#f97316'},
        {x:C[3],label:'LEAF scores',color:'#a78bfa'},
      ];
      return (
        <div style={{overflowX:'auto',width:'100%'}}>
          <svg width={W} height={H} style={{display:'block',margin:'0 auto'}}>
            {colLabels.map(({x,label,color})=>(
              <text key={x} x={x} y={H-8} textAnchor="middle" fill={color} fontSize={9} fontFamily="'DM Mono',monospace" opacity={0.8}>{label}</text>
            ))}
            {edges.map(({a,b,hot},i)=>{
              const na=byId[a], nb=byId[b];
              return <line key={i} x1={na.x+NHW} y1={na.y} x2={nb.x-NHW} y2={nb.y}
                stroke={hot?'#22c55e':'#c4b5fd'} strokeWidth={hot?2:1.5} strokeDasharray={hot?undefined:'5 4'}/>;
            })}
            {nodes.map(n=>{
              const c = n.chosen ? '#22c55e' : n.color;
              const bg = n.chosen ? 'rgba(34,197,94,0.12)' : n.color+'1a';
              const hasScore = !!n.score;
              const labelY = hasScore ? n.y-8 : n.y+4;
              return (
                <g key={n.id}>
                  <rect x={n.x-NHW} y={n.y-NHH} width={NW} height={NH} rx={7} fill={bg} stroke={c} strokeWidth={n.chosen?2:1.5}/>
                  <text x={n.x} y={labelY} textAnchor="middle" fill={c} fontSize={10} fontWeight={700} fontFamily="'DM Mono',monospace">{n.label}</text>
                  {hasScore && <text x={n.x} y={n.y+11} textAnchor="middle" fill="#e9d5ff" fontSize={12} fontWeight={800} fontFamily="'DM Mono',monospace">{n.score}</text>}
                </g>
              );
            })}
          </svg>
          <div style={{textAlign:'center',fontSize:13,color:'#22c55e',fontFamily:"'DM Mono',monospace",marginTop:2}}>
            Leaves scored → MIN picks lowest → MAX picks highest → ROOT = +1.0 → bot plays e4
          </div>
        </div>
      );
    }
    if (s.emoji==='🔭') return (
      <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:16}}>
        <div style={{display:'flex',gap:12,justifyContent:'center'}}>
          {[
            {d:3,label:'Depth 3',sub:'bot · you · bot',color:'#22c55e',status:'Start here'},
            {d:4,label:'Depth 4',sub:'bot · you · bot · you',color:'#8b5cf6',status:'Beat depth 3'},
            {d:5,label:'Depth 5',sub:'5 moves deep',color:'#a855f7',status:'Beat depth 4'},
          ].map(({d,label,sub,color,status})=>(
            <div key={d} style={{textAlign:'center',padding:'14px 16px',background:d===3?color+'18':'rgba(124,58,237,0.05)',border:'2px solid '+(d===3?color:'#e2d9f3'),borderRadius:10,minWidth:100,opacity:d===3?1:0.6}}>
              <div style={{fontSize:22,fontWeight:900,color:d===3?color:'#a78bfa',fontFamily:"'DM Mono',monospace"}}>{d}</div>
              <div style={{fontSize:14,fontWeight:700,color:d===3?color:'#a78bfa',marginBottom:4}}>{label}</div>
              <div style={{fontSize:12,color:'#a78bfa',fontFamily:"'DM Mono',monospace",marginBottom:6}}>{sub}</div>
              <div style={{fontSize:12,color:d===3?color:'#c4b5fd',background:d===3?color+'18':'rgba(0,0,0,0.03)',border:'1px solid '+(d===3?color:'#e2d9f3'),borderRadius:99,padding:'2px 6px',display:'inline-block'}}>{d===3?'UNLOCKED':status}</div>
            </div>
          ))}
        </div>
        <div style={{fontSize:14,color:'#a78bfa',fontFamily:"'DM Mono',monospace",textAlign:'center',lineHeight:1.8}}>
          Each extra depth roughly <span style={{color:'#a78bfa'}}>triples</span> nodes searched.<br/>
          Depth 3 = ~27 nodes. Depth 4 = ~81. Depth 5 = ~243.
        </div>
      </div>
    );
    return (
      <div style={{textAlign:'center',padding:'20px',color:'#a78bfa'}}>
        <div style={{fontSize:40,marginBottom:12}}>{s.emoji}</div>
        <div style={{fontSize:15,lineHeight:1.7}}>{s.title}</div>
      </div>
    );
  };

  return (
    <div style={{minHeight:'100vh',background:'#0e0820',color:'#e2d9f3',fontFamily:"'DM Sans',sans-serif",display:'flex',flexDirection:'column'}}>
      <div style={{borderBottom:'1px solid #3b1f6e',padding:'14px 32px',display:'flex',alignItems:'center',justifyContent:'space-between',background:'#160c28',boxShadow:'0 1px 8px rgba(139,92,246,0.06)',flexShrink:0}}>
        <div style={{display:'flex',alignItems:'center',gap:12}}>
          <div style={{fontSize:44,lineHeight:1,color:'#fff',filter:'drop-shadow(0 0 16px rgba(139,92,246,0.8))',marginBottom:4}}>♔</div>
          <div>
            <div style={{fontSize:17,fontWeight:800,letterSpacing:-0.3}}><span className="shine">How Minimax Works</span></div>
            <div style={{fontSize:13,color:'#a78bfa',fontFamily:"'DM Mono',monospace"}}>Step 2 of 3 — The algorithm</div>
          </div>
        </div>
        <button onClick={onBack} style={{padding:'6px 14px',background:'transparent',border:'1px solid #4c2889',borderRadius:8,color:'#a78bfa',fontSize:14,cursor:'pointer'}}>← Back</button>
      </div>
      <div style={{height:3,background:'#3b1f6e',flexShrink:0}}>
        <div style={{height:'100%',background:'linear-gradient(90deg,#8b5cf6,'+s.color+')',transition:'width 0.4s',width:((step+1)/MINIMAX_STEPS.length*100)+'%'}}/>
      </div>
      <div style={{flex:1,overflowY:'auto',display:'flex',alignItems:'center',justifyContent:'center',padding:32}}>
        <div style={{maxWidth:560,width:'100%'}}>
          <div style={{display:'flex',justifyContent:'center',gap:6,marginBottom:28}}>
            {MINIMAX_STEPS.map((_,i)=>(
              <div key={i} onClick={()=>setStep(i)} style={{width:i===step?22:7,height:7,borderRadius:99,background:i===step?s.color:'#e2d9f3',transition:'all 0.3s',cursor:'pointer'}}/>
            ))}
          </div>
          <div style={{background:'#160c2a',border:'1.5px solid '+s.color+'33',borderRadius:16,padding:32}}>
            <div style={{textAlign:'center',marginBottom:28}}>
              <div style={{fontSize:40,marginBottom:10}}>{s.emoji}</div>
              {showFact && step===0 && <DepthFunFact/>}
            <div style={{fontSize:13,color:s.color,fontFamily:"'DM Mono',monospace",letterSpacing:2,textTransform:'uppercase',marginBottom:6}}>Step {step+1} of {MINIMAX_STEPS.length}</div>
              <div style={{fontSize:20,fontWeight:700,color:'#e2d9f3',marginBottom:14}}>{s.title}</div>
              <div style={{fontSize:15,color:'#a78bfa',lineHeight:1.8}}>{s.body}</div>
            </div>
            <div style={{background:'#160c28',borderRadius:12,padding:20,border:'1px solid #4c2889',minHeight:160,display:'flex',alignItems:'center',justifyContent:'center'}}>
              {visual()}
            </div>
          </div>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginTop:24}}>
            <button onClick={()=>advanceStep(Math.max(0,step-1),'prev')} disabled={step===0} style={{padding:'10px 24px',borderRadius:9,border:'1px solid #2d1b4e',background:'transparent',color:step===0?'#3b1f6e':'#94a3b8',fontSize:15,cursor:step===0?'default':'pointer',fontFamily:"'DM Mono',monospace"}}>← Prev</button>
            {isLast
              ? <button onClick={()=>{advanceStep(step,'finish');onPlay();}} style={{padding:'10px 28px',borderRadius:9,border:'1px solid #22c55e',background:'rgba(34,197,94,0.15)',color:'#22c55e',fontSize:15,fontWeight:700,cursor:'pointer',fontFamily:"'DM Mono',monospace",boxShadow:'0 0 20px rgba(34,197,94,0.3)'}}>Play vs Bot →</button>
              : <button onClick={()=>advanceStep(step+1,'next')} style={{padding:'10px 28px',borderRadius:9,border:'1px solid '+s.color,background:s.color+'18',color:s.color,fontSize:15,fontWeight:700,cursor:'pointer',fontFamily:"'DM Mono',monospace"}}>Next →</button>
            }
          </div>
        </div>
      </div>
    </div>
  );
};



// ═══════════════════════════════════════════════════════════════
// REVEAL OVERLAY — Black → Glass transition
// ═══════════════════════════════════════════════════════════════
const Game1WinOverlay = ({playerWon, onLearnHowBotThinks, onPlayAgain}) => (
  <div style={{position:'fixed',top:0,left:0,width:'100%',height:'100%',background:'rgba(4,2,16,0.92)',backdropFilter:'blur(12px)',zIndex:99,display:'flex',alignItems:'center',justifyContent:'center'}}>
    <div className="fade-in" style={{textAlign:'center',maxWidth:460,width:'90%',padding:'0 24px'}}>
      <div style={{fontSize:60,marginBottom:14,lineHeight:1}}>{playerWon ? '🏆' : '🤖'}</div>
      <div style={{fontSize:26,fontWeight:800,color:playerWon?'#86efac':'#fca5a5',fontFamily:"'DM Sans',sans-serif",marginBottom:12}}>
        {playerWon ? 'You won!' : 'Bot wins.'}
      </div>
      <div style={{fontSize:15,color:'#a78bfa',fontFamily:"'DM Sans',sans-serif",lineHeight:1.8,marginBottom:28}}>
        The bot planned every move — you just couldn't see how.<br/>
      </div>
      <div style={{display:'flex',flexDirection:'column',gap:10,alignItems:'center'}}>
        <button onClick={onLearnHowBotThinks} style={{padding:'15px 40px',borderRadius:12,border:'none',cursor:'pointer',background:'linear-gradient(135deg,#7c3aed,#9333ea)',color:'#fff',fontSize:17,fontWeight:700,fontFamily:"'DM Sans',sans-serif",boxShadow:'0 4px 28px rgba(139,92,246,0.5)',width:'100%',maxWidth:340}}>
          Start a new game to learn how the bot thinks →
        </button>
        <button onClick={onPlayAgain} style={{padding:'10px 24px',borderRadius:10,border:'1px solid #3b1f6e',cursor:'pointer',background:'transparent',color:'#6d28d9',fontSize:14,fontFamily:"'DM Mono',monospace"}}>
          play again first
        </button>
      </div>
    </div>
  </div>
);

// ═══════════════════════════════════════════════════════════════
// PHASE BADGE — shows current phase in header
// ═══════════════════════════════════════════════════════════════
const PhaseBadge = ({phase}) => {
  const config = {
    black:  {label:'Game 1 — Play',   color:'#94a3b8', bg:'rgba(100,116,139,0.10)', border:'#334155', tip:'Play against the bot — no hints'},
    glass:  {label:'Game 2 — Learn',  color:'#38bdf8', bg:'rgba(56,189,248,0.10)', border:'#0369a1', tip:'Learn how the bot thinks'},
    replay: {label:'Game 3 — Apply',  color:'#a78bfa', bg:'rgba(139,92,246,0.12)', border:'#6d28d9', tip:'Apply what you learned'},
    open:   {label:'Game 3 — Apply',  color:'#a78bfa', bg:'rgba(139,92,246,0.12)', border:'#6d28d9', tip:'Use what you learned — free play'},
  };
  const c = config[phase];
  if(!c) return null;
  return(
    <div title={c.tip} style={{padding:'4px 12px',borderRadius:20,background:c.bg,border:`1px solid ${c.border}`,display:'flex',alignItems:'center',gap:6}}>
      <span style={{fontSize:13,fontWeight:700,color:c.color,fontFamily:"'DM Mono',monospace",letterSpacing:0.5}}>{c.label}</span>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════
// BLACK BOX RIGHT PANEL — tree hidden
// ═══════════════════════════════════════════════════════════════
const ChessGuidePanel = ({thinking, onLearnHowBotThinks, open, onClose}) => {
  const [active, setActive] = useState(0);
  const piece = PIECES_INFO[active];
  return (
    <div style={{display:'flex',flexDirection:'row',background:'#0a0618',borderLeft:'1px solid #2d1b4e',flexShrink:0,width:open?360:0,minWidth:open?360:0,transition:'width 0.3s cubic-bezier(0.4,0,0.2,1),min-width 0.3s cubic-bezier(0.4,0,0.2,1)',overflow:'hidden',position:'relative'}}>
      <div style={{width:360,flexShrink:0,display:'flex',flexDirection:'column',height:'100%'}}>

      {/* Header */}
      <div style={{borderBottom:'1px solid #2d1b4e',padding:'10px 14px',background:'#160c28',display:'flex',alignItems:'center',justifyContent:'space-between',flexShrink:0}}>
        <div style={{fontSize:13,fontWeight:700,color:'#a78bfa',fontFamily:"'DM Mono',monospace"}}>📖 Chess Rules</div>
        <div style={{display:'flex',alignItems:'center',gap:8}}>
          {thinking && (
            <div style={{display:'flex',alignItems:'center',gap:4,fontSize:11,color:'#4c2889',fontFamily:"'DM Mono',monospace"}}>
              {[0,1,2].map(i=>(
                <div key={i} style={{width:4,height:4,borderRadius:'50%',background:'#4c2889',animation:`thinking-dot 1s ${i*0.2}s ease-in-out infinite`}}/>
              ))}
            </div>
          )}
          <button onClick={onClose} style={{width:24,height:24,borderRadius:'50%',border:'1px solid #3b1f6e',background:'transparent',color:'#6d28d9',fontSize:14,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center'}}>✕</button>
        </div>
      </div>

      <div style={{flex:1,overflowY:'auto',padding:'14px',display:'flex',flexDirection:'column',gap:14}}>

        {/* Piece tabs */}
        <div>
          <div style={{fontSize:11,color:'#4c2889',letterSpacing:1.5,textTransform:'uppercase',fontFamily:"'DM Mono',monospace",marginBottom:8}}>The Pieces</div>
          <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
            {PIECES_INFO.map((p,i)=>(
              <button key={p.key} onClick={()=>setActive(i)}
                style={{padding:'5px 11px',borderRadius:7,border:'1.5px solid '+(active===i?p.color:'#2d1b4e'),background:active===i?p.color+'18':'transparent',color:active===i?p.color:'#6d28d9',fontSize:13,fontWeight:active===i?700:400,cursor:'pointer',transition:'all 0.15s',display:'flex',alignItems:'center',gap:5}}>
                <span style={{fontSize:'1rem'}}>{p.sym}</span>{p.name}
              </button>
            ))}
          </div>
        </div>

        {/* Piece card */}
        <div style={{background:'#160c28',border:'1px solid '+piece.color+'33',borderRadius:12,padding:'16px'}}>
          <div style={{display:'flex',gap:16,alignItems:'flex-start',flexWrap:'wrap'}}>
            <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:8,flexShrink:0}}>
              <PieceBoard piece={piece}/>
              <div style={{fontSize:11,color:'#4c2889',fontFamily:"'DM Mono',monospace"}}>● reachable squares</div>
            </div>
            <div style={{flex:1,minWidth:160}}>
              <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:8}}>
                <span style={{fontSize:'2rem',color:piece.color}}>{piece.sym}</span>
                <div>
                  <div style={{fontSize:16,fontWeight:700,color:'#e2d9f3'}}>{piece.name}</div>
                  <div style={{fontSize:13,color:piece.color,fontFamily:"'DM Mono',monospace"}}>Value: {piece.value} pts</div>
                </div>
              </div>
              <div style={{fontSize:13,color:'#a78bfa',lineHeight:1.65,marginBottom:piece.special?10:0}}>{piece.desc}</div>
              {piece.special && (
                <div style={{padding:'6px 10px',background:'rgba(250,204,21,0.07)',border:'1px solid rgba(250,204,21,0.2)',borderRadius:6,fontSize:12,color:'#b45309'}}>
                  Pawns capture diagonally even though they move straight!
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Piece value grid */}
        <div>
          <div style={{fontSize:11,color:'#4c2889',letterSpacing:1.5,textTransform:'uppercase',fontFamily:"'DM Mono',monospace",marginBottom:8}}>Piece Values</div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(6,1fr)',gap:4}}>
            {[['P',1],['N',3],['B',3],['R',5],['Q',9],['K','∞']].map(([p,v])=>(
              <div key={p} style={{background:'#0a0618',borderRadius:6,padding:'6px 0',textAlign:'center',border:'1px solid #2d1b4e'}}>
                <div style={{fontSize:'1.3rem',lineHeight:1}}>{SYM[p]}</div>
                <div style={{fontSize:12,color:'#6d28d9',fontWeight:700,fontFamily:"'DM Mono',monospace"}}>{v}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Key rules — compact */}
        <div>
          <div style={{fontSize:11,color:'#4c2889',letterSpacing:1.5,textTransform:'uppercase',fontFamily:"'DM Mono',monospace",marginBottom:8}}>Key Rules</div>
          <div style={{display:'flex',flexDirection:'column',gap:6}}>
            {RULES.map((r,i)=>(
              <div key={i} style={{display:'flex',gap:10,padding:'8px 12px',background:'#160c28',borderRadius:8,border:'1px solid #2d1b4e',alignItems:'flex-start'}}>
                <span style={{fontSize:'1.1rem',flexShrink:0}}>{r.icon}</span>
                <div>
                  <div style={{fontSize:13,fontWeight:700,color:'#c4b5fd',marginBottom:2}}>{r.title}</div>
                  <div style={{fontSize:12,color:'#7c6a9c',lineHeight:1.5}}>{r.body}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

      </div>


      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════
// GAME 2 INTRO SCREEN — shown after Game 1 before tree appears
// ═══════════════════════════════════════════════════════════════
const Game2Intro = ({onStart, onBack}) => (
  <div style={{minHeight:'100vh',background:'#0e0820',display:'flex',alignItems:'center',justifyContent:'center',fontFamily:"'DM Sans',sans-serif"}}>
    <div className="fade-in" style={{maxWidth:520,width:'90%',textAlign:'center',padding:'0 24px'}}>
      <button onClick={onBack} style={{display:'flex',alignItems:'center',gap:6,background:'none',border:'none',color:'#4c2889',fontSize:13,cursor:'pointer',fontFamily:"'DM Mono',monospace",marginBottom:16,padding:0}} onMouseEnter={e=>e.currentTarget.style.color='#a78bfa'} onMouseLeave={e=>e.currentTarget.style.color='#4c2889'}>← back</button>
      <div style={{fontSize:56,marginBottom:20,lineHeight:1}}>🧠</div>
      <div style={{fontSize:26,fontWeight:800,color:'#e2d9f3',marginBottom:20,letterSpacing:-0.3}}>
        Now watch it think.
      </div>
      <div style={{display:'flex',flexDirection:'column',gap:12,marginBottom:32,textAlign:'left'}}>
        {[
          {icon:'🌳', text:'After every bot move, a tree appears on the right showing every move it considered.'},
          {icon:'✅', text:'The green path is the line it actually chose — trace it from top to bottom to read its plan.'},
          {icon:'📊', text:'The numbers are scores — higher means better for the bot. It always picks the highest it can get.'},
          {icon:'😊', text:"Your moves are shown too — the bot assumes you'll always pick the move that's worst for it."},
        ].map(({icon,text})=>(
          <div key={icon} style={{display:'flex',gap:14,alignItems:'flex-start',padding:'12px 16px',background:'#160c28',borderRadius:10,border:'1px solid #2d1b4e'}}>
            <span style={{fontSize:20,flexShrink:0}}>{icon}</span>
            <span style={{fontSize:14,color:'#c4b5fd',lineHeight:1.6}}>{text}</span>
          </div>
        ))}
      </div>
      <button onClick={onStart} style={{padding:'15px 48px',borderRadius:12,border:'none',cursor:'pointer',background:'linear-gradient(135deg,#7c3aed,#9333ea)',color:'#fff',fontSize:17,fontWeight:700,fontFamily:"'DM Sans',sans-serif",boxShadow:'0 4px 28px rgba(139,92,246,0.5)'}}>
        Start Game 2 →
      </button>
    </div>
  </div>
);

// ═══════════════════════════════════════════════════════════════
// GLASS BOX WIN OVERLAY — transitions to open box
// ═══════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════
// END SCREEN
// ═══════════════════════════════════════════════════════════════
const EndScreen = ({userInfo, allReflections, gamesPlayed, maxDepthReached}) => {
  const roundLabels = ["Round 1","Round 2","Round 3"];
  const chipLabels = {
    yes:"Yes, a lot", bit:"A little bit", no:"Not really", lost:"Got confused",
    right:"Predicted correctly", wrong:"Tried but wrong", nope:"Did not try",
    get:"I get it", close:"Getting there", fuzzy:"Still fuzzy",
  };
  const name = userInfo && userInfo.name ? userInfo.name : "Player";
  return (
    <div style={{minHeight:"100vh",background:"#0e0820",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'DM Sans',sans-serif",padding:"32px 20px",overflowY:"auto"}}>
      <style>{`.float{animation:floatAnim 3s ease-in-out infinite} .glow-k{animation:glowAnim 2.5s ease-in-out infinite} .shine{display:inline-block;background:linear-gradient(90deg,#a78bfa 0%,#ffffff 50%,#a78bfa 100%);background-size:300% auto;-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;animation:shimmerAnim 2.5s linear infinite} @keyframes floatAnim{0%,100%{transform:translateY(0)}50%{transform:translateY(-8px)}} @keyframes glowAnim{0%,100%{filter:drop-shadow(0 0 12px rgba(139,92,246,0.6))}50%{filter:drop-shadow(0 0 28px rgba(167,139,250,0.9))}} @keyframes shimmerAnim{0%{background-position:300% center}100%{background-position:-300% center}} @keyframes fadeUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}} .fade-in{animation:fadeUp 0.35s ease both}`}</style>
      <div className="fade-in" style={{maxWidth:520,width:"100%"}}>

        <div style={{textAlign:"center",marginBottom:28}}>
          <div className="float" style={{fontSize:56,lineHeight:1,marginBottom:10}}>
            <span className="glow-k" style={{display:"inline-block"}}>&#9818;</span>
          </div>
          <div style={{fontSize:22,fontWeight:800,letterSpacing:-0.3,marginBottom:6}}>
            <span className="shine">Minimax Chess</span>
          </div>
          <div style={{fontSize:22,fontWeight:800,color:"#e2d9f3",marginBottom:6}}>
            {"Great work, " + name + "!"}
          </div>
          <div style={{fontSize:14,color:"#6d28d9",fontFamily:"'DM Mono',monospace"}}>Session complete</div>
        </div>

        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10,marginBottom:24}}>
          <div style={{background:"#160c28",border:"1px solid #2d1b4e",borderRadius:12,padding:"14px 10px",textAlign:"center"}}>
            <div style={{fontSize:22,marginBottom:4}}>&#127918;</div>
            <div style={{fontSize:18,fontWeight:800,color:"#e2d9f3",marginBottom:2}}>{gamesPlayed}</div>
            <div style={{fontSize:11,color:"#4c2889",fontFamily:"'DM Mono',monospace"}}>Games played</div>
          </div>
          <div style={{background:"#160c28",border:"1px solid #2d1b4e",borderRadius:12,padding:"14px 10px",textAlign:"center"}}>
            <div style={{fontSize:22,marginBottom:4}}>&#129504;</div>
            <div style={{fontSize:18,fontWeight:800,color:"#e2d9f3",marginBottom:2}}>Depth {maxDepthReached}</div>
            <div style={{fontSize:11,color:"#4c2889",fontFamily:"'DM Mono',monospace"}}>Max depth</div>
          </div>
          <div style={{background:"#160c28",border:"1px solid #2d1b4e",borderRadius:12,padding:"14px 10px",textAlign:"center"}}>
            <div style={{fontSize:22,marginBottom:4}}>&#128172;</div>
            <div style={{fontSize:18,fontWeight:800,color:"#e2d9f3",marginBottom:2}}>{allReflections.length}</div>
            <div style={{fontSize:11,color:"#4c2889",fontFamily:"'DM Mono',monospace"}}>Reflections</div>
          </div>
        </div>

        <div style={{background:"rgba(124,58,237,0.06)",border:"1px solid #3b1f6e",borderRadius:14,padding:"18px 20px",marginBottom:20}}>
          <div style={{fontSize:12,color:"#7c3aed",letterSpacing:1.5,textTransform:"uppercase",fontFamily:"'DM Mono',monospace",marginBottom:10}}>What is minimax?</div>
          <div style={{fontSize:14,color:"#c4b5fd",lineHeight:1.8}}>
            Minimax is how the bot decides every move. It imagines every possible reply up to{" "}
            <strong style={{color:"#e2d9f3"}}>depth {maxDepthReached}</strong> moves ahead,
            assigns scores to each outcome, and picks the move with the best score.
          </div>
        </div>

        {allReflections.length > 0 && (
          <div style={{display:"flex",flexDirection:"column",gap:10,marginBottom:24}}>
            <div style={{fontSize:12,color:"#4c2889",letterSpacing:1.5,textTransform:"uppercase",fontFamily:"'DM Mono',monospace",marginBottom:2}}>Your reflections</div>
            {allReflections.map(function(r, idx){
              return (
                <div key={idx} style={{background:"#160c28",border:"1px solid #2d1b4e",borderRadius:12,padding:"14px 16px"}}>
                  <div style={{fontSize:11,color:"#6d28d9",fontFamily:"'DM Mono',monospace",marginBottom:8,textTransform:"uppercase",letterSpacing:1}}>
                    {roundLabels[idx] || ("Round " + r.round)} &middot; depth {r.depth}
                  </div>
                  <div style={{marginBottom:6}}>
                    <span style={{padding:"3px 10px",borderRadius:99,background:"rgba(124,58,237,0.12)",border:"1px solid #4c2889",fontSize:12,color:"#a78bfa",fontFamily:"'DM Mono',monospace"}}>
                      {chipLabels[r.chipVal] || r.chipVal}
                    </span>
                  </div>
                  <div style={{fontSize:13,color:"#e2d9f3",lineHeight:1.6,fontStyle:"italic"}}>
                    {r.freeText}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div style={{textAlign:"center",padding:"16px",background:"#160c28",borderRadius:12,border:"1px solid #2d1b4e"}}>
          <div style={{fontSize:14,color:"#a78bfa",lineHeight:1.7}}>
            {"Thank you for playing, " + name + "!"}<br/>
            <span style={{color:"#6d28d9",fontSize:13}}>Your responses help us understand how people learn about AI.</span>
          </div>
        </div>
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════
// REFLECTION OVERLAY
// ═══════════════════════════════════════════════════════════════
const ROUND_DATA = [
  {
    header: "Quick reflection",
    sub: "2 questions",
    q1: "Did you use the tree to figure out what the bot was going to do?",
    opts: [
      {val:"yes",  label:"Yes, a lot",   emoji:"&#129504;"},
      {val:"bit",  label:"A little bit", emoji:"&#129300;"},
      {val:"no",   label:"Not really",   emoji:"&#127919;"},
      {val:"lost", label:"Got confused", emoji:"&#128565;"},
    ],
    q2: "In your own words, what is the bot doing when it picks a move?",
    hint: "One sentence is fine",
    ph:   "Describe it in your own words...",
    freeText: true,
  },
  {
    header: "Round 2 reflection",
    sub: "1 question",
    q1: "Did you try to predict the bot move using the tree?",
    opts: [
      {val:"right", label:"Yes and I was right", emoji:"&#127919;"},
      {val:"wrong", label:"Tried but was wrong",  emoji:"&#10060;"},
      {val:"nope",  label:"Did not try",          emoji:"&#128064;"},
      {val:"lost",  label:"Tree was too big",     emoji:"&#128565;"},
    ],
    freeText: false,
  },
  {
    header: "Round 3 reflection",
    sub: "2 questions",
    q1: "How well do you understand how the bot thinks now?",
    opts: [
      {val:"get",   label:"I get it",      emoji:"&#128161;"},
      {val:"close", label:"Getting there", emoji:"&#128269;"},
      {val:"fuzzy", label:"Still fuzzy",   emoji:"&#129300;"},
      {val:"lost",  label:"Still lost",    emoji:"&#128565;"},
    ],
    q2: "How would you explain minimax to a friend?",
    hint: "Imagine explaining it to a younger sibling",
    ph:   "Type your answer here...",
    freeText: true,
  },
];

const ReflectionOverlay = ({roundIndex, depth, onDone, onEnd}) => {
  const [chipVal,   setChipVal]   = useState(null);
  const [freeText,  setFreeText]  = useState("");
  const [attempted, setAttempted] = useState(false);

  const round    = ROUND_DATA[Math.min(roundIndex, ROUND_DATA.length - 1)];
  const canDone  = roundIndex >= 2;
  const needsFreeText = round.freeText === true;
  const canSubmit = chipVal !== null && (!needsFreeText || freeText.trim().length >= 3);

  const collectData = function() {
    return { round: roundIndex + 1, chipVal: chipVal, freeText: freeText.trim(), depth: depth };
  };

  const handleSubmit = function() {
    setAttempted(true);
    if (!canSubmit) return;
    onDone(collectData());
  };

  const handleEnd = function() {
    setAttempted(true);
    if (!canSubmit) return;
    onDone(collectData());
    onEnd();
  };

  return (
    <div style={{position:"fixed",top:0,left:0,width:"100%",height:"100%",background:"rgba(15,5,35,0.9)",backdropFilter:"blur(10px)",zIndex:98,display:"flex",alignItems:"center",justifyContent:"center",padding:"20px",overflowY:"auto"}}>
      <div className="fade-in" style={{background:"#0e0820",border:"1px solid #3b1f6e",borderRadius:20,padding:"32px 36px",maxWidth:500,width:"100%",boxShadow:"0 0 60px rgba(139,92,246,0.2)"}}>

        <div style={{textAlign:"center",marginBottom:24}}>
          <div style={{fontSize:28,marginBottom:8}}>&#128172;</div>
          <div style={{fontSize:18,fontWeight:800,color:"#e2d9f3",marginBottom:4}}>{round.header}</div>
          <div style={{fontSize:13,color:"#4c2889",fontFamily:"'DM Mono',monospace"}}>{round.sub}</div>
        </div>

        <div style={{marginBottom:22}}>
          <div style={{fontSize:14,fontWeight:700,color:"#c4b5fd",marginBottom:10}}>{round.q1}</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
            {round.opts.map(function(opt){
              var active = chipVal === opt.val;
              return (
                <button key={opt.val}
                  onClick={function(){ setChipVal(opt.val); }}
                  style={{padding:"10px 12px",borderRadius:10,border:"2px solid " + (active ? "#7c3aed" : "#2d1b4e"),background:active ? "rgba(124,58,237,0.15)" : "transparent",color:active ? "#e2d9f3" : "#6d28d9",fontSize:13,fontWeight:active ? 700 : 400,cursor:"pointer",fontFamily:"'DM Sans',sans-serif",display:"flex",alignItems:"center",gap:8,textAlign:"left"}}>
                  <span dangerouslySetInnerHTML={{__html: opt.emoji + " "}} />
                  <span>{opt.label}</span>
                </button>
              );
            })}
          </div>
          {attempted && chipVal === null && (
            <div style={{fontSize:12,color:"#f87171",fontFamily:"'DM Mono',monospace",marginTop:6}}>Pick one to continue</div>
          )}
        </div>

        {needsFreeText && (
          <div style={{marginBottom:24}}>
            <div style={{fontSize:14,fontWeight:700,color:"#c4b5fd",marginBottom:4}}>{round.q2}</div>
            <div style={{fontSize:12,color:"#4c2889",fontFamily:"'DM Mono',monospace",marginBottom:8}}>{round.hint}</div>
            <textarea
              value={freeText}
              onChange={function(e){ setFreeText(e.target.value); }}
              placeholder={round.ph}
              rows={3}
              style={{width:"100%",background:"#160c28",border:"1px solid " + (attempted && freeText.trim().length < 3 ? "#ef4444" : "#3b1f6e"),borderRadius:10,padding:"10px 12px",color:"#e2d9f3",fontSize:14,fontFamily:"'DM Sans',sans-serif",resize:"vertical",outline:"none",lineHeight:1.6,boxSizing:"border-box"}}
            />
            {attempted && freeText.trim().length < 3 && (
              <div style={{fontSize:12,color:"#f87171",fontFamily:"'DM Mono',monospace",marginTop:4}}>Write at least a few words</div>
            )}
          </div>
        )}

        <div style={{display:"flex",flexDirection:"column",gap:8}}>
          <button onClick={handleSubmit}
            style={{width:"100%",padding:"13px",borderRadius:11,border:"none",cursor:"pointer",background:canSubmit ? "linear-gradient(135deg,#7c3aed,#9333ea)" : "#1a0e30",color:canSubmit ? "#fff" : "#3b1f6e",fontSize:15,fontWeight:700,fontFamily:"'DM Sans',sans-serif",boxShadow:canSubmit ? "0 3px 16px rgba(139,92,246,0.4)" : "none"}}>
            Continue
          </button>
          {canDone && (
            <button onClick={handleEnd}
              style={{width:"100%",padding:"10px",borderRadius:11,border:"1px solid #3b1f6e",cursor:"pointer",background:"transparent",color:"#6d28d9",fontSize:14,fontFamily:"'DM Mono',monospace"}}>
              I am done
            </button>
          )}
        </div>

      </div>
    </div>
  );
};


const GlassWinOverlay = ({msg, onLearnMore, onReplay, onTryNewDepth, onClose, moveLog, depth, unlockedDepth}) => {
  const newDepthUnlocked = msg?.playerWon && msg?.newDepth != null;
  const newDepth = msg?.newDepth;
  if(!msg) return null;
  const pw = msg.playerWon;
  return(
    <div style={{position:'fixed',top:0,left:0,width:'100%',height:'100%',background:'rgba(15,5,35,0.82)',backdropFilter:'blur(8px)',zIndex:99,display:'flex',alignItems:'center',justifyContent:'center'}}>
      <div className="fade-in" style={{background:'#0e0820',border:`2px solid ${pw?'#22c55e':'#ef4444'}`,borderRadius:20,padding:'32px 36px',textAlign:'center',boxShadow:`0 0 80px ${pw?'rgba(34,197,94,0.3)':'rgba(239,68,68,0.3)'}`,maxWidth:460,width:'90%',position:'relative'}}>

        {/* Close — always available, no pressure */}
        <button onClick={onClose} title="Close and keep exploring the tree"
          style={{position:'absolute',top:12,right:14,background:'none',border:'none',color:'#3b1f6e',fontSize:18,cursor:'pointer',lineHeight:1,padding:4}}
          onMouseEnter={e=>e.currentTarget.style.color='#a78bfa'} onMouseLeave={e=>e.currentTarget.style.color='#3b1f6e'}>✕</button>

        {/* Result */}
        <div style={{fontSize:44,marginBottom:8,lineHeight:1}}>{pw?'🏆':'🤖'}</div>
        <div style={{fontSize:24,fontWeight:800,color:pw?'#86efac':'#fca5a5',fontFamily:"'DM Sans',sans-serif",marginBottom:4}}>
          {pw ? 'You won!' : 'Bot wins.'}
        </div>
        <div style={{fontSize:13,color:pw?'#4ade80':'#f87171',fontFamily:"'DM Mono',monospace",marginBottom:20,opacity:0.85}}>{msg.headline}</div>

        {/* Unlock banner — shown when new depth earned */}
        {newDepthUnlocked && (
          <div style={{padding:'14px 16px',background:'linear-gradient(135deg,rgba(20,83,45,0.6),rgba(5,46,22,0.6))',border:'2px solid #22c55e',borderRadius:14,marginBottom:16,textAlign:'center',boxShadow:'0 0 20px rgba(34,197,94,0.2)'}}>
            <div style={{fontSize:18,marginBottom:4}}>🔓</div>
            <div style={{fontSize:15,fontWeight:800,color:'#4ade80',fontFamily:"'DM Sans',sans-serif",marginBottom:3}}>
              Depth {newDepth} Unlocked!
            </div>
            <div style={{fontSize:12,color:'#86efac',fontFamily:"'DM Mono',monospace",lineHeight:1.6,marginBottom:10}}>
              The bot now thinks <strong style={{color:'#fff'}}>{newDepth===4?'3×':'9×'} deeper</strong>.<br/>
              It considers far more moves — smarter and harder to beat.
            </div>
            <div style={{display:'flex',gap:8,justifyContent:'center',flexWrap:'wrap'}}>
              <button onClick={onTryNewDepth}
                style={{padding:'8px 20px',borderRadius:8,border:'none',cursor:'pointer',background:'linear-gradient(135deg,#16a34a,#22c55e)',color:'#fff',fontSize:13,fontWeight:700,fontFamily:"'DM Sans',sans-serif",boxShadow:'0 2px 10px rgba(34,197,94,0.4)'}}>
                Play at Depth {newDepth} →
              </button>
              <button onClick={onReplay}
                style={{padding:'8px 16px',borderRadius:8,border:'1px solid #22c55e44',cursor:'pointer',background:'transparent',color:'#4ade80',fontSize:13,fontFamily:"'DM Mono',monospace"}}>
                Replay depth {depth}
              </button>
            </div>
          </div>
        )}

        {/* Explore the tree nudge — always shown */}
        <div style={{padding:'12px 14px',background:'rgba(139,92,246,0.08)',border:'1px solid #3b1f6e',borderRadius:10,marginBottom:16,textAlign:'left'}}>
          <div style={{fontSize:12,color:'#7c3aed',letterSpacing:1,textTransform:'uppercase',fontFamily:"'DM Mono',monospace",marginBottom:5}}>💡 Before you start a new game</div>
          <div style={{fontSize:13,color:'#c4b5fd',lineHeight:1.6}}>
            {pw
              ? "Trace the green path in the tree on the right — that's every move the bot planned to win."
              : "Look at the tree on the right — can you spot the move that decided the game?"}
          </div>
          <button onClick={onClose}
            style={{marginTop:8,padding:'5px 14px',borderRadius:7,border:'1px solid #4c2889',background:'transparent',color:'#a78bfa',fontSize:12,cursor:'pointer',fontFamily:"'DM Mono',monospace"}}>
            Explore the tree →
          </button>
        </div>

        {/* Bottom actions */}
        <div style={{display:'flex',gap:8,justifyContent:'center',flexWrap:'wrap'}}>
          <button onClick={onLearnMore}
            style={{padding:'10px 22px',borderRadius:9,border:'none',cursor:'pointer',background:'linear-gradient(135deg,#7c3aed,#9333ea)',color:'#fff',fontSize:14,fontWeight:700,fontFamily:"'DM Sans',sans-serif",boxShadow:'0 3px 16px rgba(139,92,246,0.4)'}}>
            How does minimax work? →
          </button>
          {!newDepthUnlocked && (
            <button onClick={onReplay}
              style={{padding:'10px 18px',borderRadius:9,cursor:'pointer',background:'transparent',color:'#a78bfa',fontSize:14,fontWeight:600,fontFamily:"'DM Mono',monospace",border:'1px solid #3b1f6e'}}>
              Play again
            </button>
          )}
        </div>

      </div>
    </div>
  );
};


// ═══════════════════════════════════════════════════════════════
// MAIN APP
// ═══════════════════════════════════════════════════════════════
export default function App(){
  // Phase: welcome → black → (reveal) → glass → open → replay
  const [phase, setPhase] = useState('welcome');
  const [userInfo, setUserInfo] = useState(null);
  const [sessionId, setSessionId] = useState(null);
  const [depth, setDepth] = useState(3);
  const [unlockedDepth, setUnlockedDepth] = useState(3);
  const [board, setBoard] = useState(STARTING_BOARD);
  const [sel, setSel] = useState(null);
  const [turn, setTurn] = useState('w');
  const [thinking, setThinking] = useState(false);
  const [tree, setTree] = useState(null);
  const [gameOver, setGameOver] = useState(false);
  const [msg, setMsg] = useState(null);
  const [lastBot, setLastBot] = useState(null);
  const [lastHumanMove, setLastHumanMove] = useState(null);
  const [chosenMove, setChosenMove] = useState(null);
  const [moveLog, setMoveLog] = useState([]);
  const [nodeHighlight, setNodeHighlight] = useState(null);
  const [winMsg, setWinMsg] = useState(null);
  const [showReflection, setShowReflection] = useState(false); // reflection overlay before win overlay
  const [reflectionData, setReflectionData] = useState(null); // stores Q responses
  const [allReflections, setAllReflections] = useState([]);   // all rounds collected
  const [glassRound, setGlassRound] = useState(0);            // 0-indexed round counter for glass phase
  const [gamesPlayed, setGamesPlayed] = useState(0);          // total games finished
  const [maxDepthReached, setMaxDepthReached] = useState(3);  // highest depth used
  const [sessionEnded, setSessionEnded] = useState(false);    // show end screen
  const [showConfetti, setShowConfetti] = useState(false);
  const [leftWidth, setLeftWidth] = useState(440);
  const [isFirstTree, setIsFirstTree] = useState(true);
  const [botExplain, setBotExplain] = useState(null);
  const [thinkScore, setThinkScore] = useState(null);
  const [showWhyPanel, setShowWhyPanel] = useState(false);
  const [showReveal, setShowReveal] = useState(false); // black-box win overlay
  const [knowsChess, setKnowsChess] = useState(false);
  const [showMinimaxModal, setShowMinimaxModal] = useState(false); // minimax tutorial modal in game 2
  const [guideOpen, setGuideOpen] = useState(false); // chess rules panel
  const [pulseDepth, setPulseDepth] = useState(null); // depth button to pulse after unlock
  const containerRef = useRef(null);
  const prevBoardRef = useRef(STARTING_BOARD);
  const treeExpandCount = useRef(0);
  const treeHoverCount = useRef(0);

  const handleDrag = useCallback((clientX) => {
    if(!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    setLeftWidth(Math.max(300, Math.min(560, clientX - rect.left)));
  }, []);

  const isGlassPhase = phase === 'glass' || phase === 'replay';

  const applyMove = useCallback((nb, det=null) => {
    if(!nb.includes('K') || !nb.includes('k')){
      setBoard(nb); setSel(null);
      if(det) setLastBot({fromIndex:det.fromIndex, toIndex:det.toIndex, notation:det.notation});
      setGameOver(true);
      const playerWon = !nb.includes('k');
      if(playerWon) setShowConfetti(true);
      const playerName = userInfo?.name ? userInfo.name : 'You';
      const headline = playerWon ? `${playerName} beat depth ${depth}!` : `Depth ${depth} bot wins.`;
      const sub = playerWon ? 'Great game!' : 'Study the tree to see how it beat you.';
      const nextDepth = Math.min(depth + 1, 5);
      const justUnlocked = playerWon && depth >= unlockedDepth;
      if(justUnlocked){ setUnlockedDepth(nextDepth); setPulseDepth(nextDepth); if(sessionId) logDepthUnlocked(sessionId, nextDepth); }
      if(phase === 'black'){
        setTimeout(() => setShowReveal(true), 900);
      } else {
        setGamesPlayed(g => g+1);
        setMaxDepthReached(m => Math.max(m, depth));
        if(sessionId) saveGame(sessionId, { phase, depth, playerWon, moveCount: moveLog.length, recordedAt: Date.now() });
        if(glassRound < 3) setTimeout(() => setShowReflection({playerWon, headline, sub, newDepth: justUnlocked ? nextDepth : null}), 800);
        else setTimeout(() => setWinMsg({playerWon, headline, sub, newDepth: justUnlocked ? nextDepth : null}), 800);
      }
      return true;
    }
    setBoard(nb); setSel(null);
    if(det?.isBotMove) setLastBot({fromIndex:det.fromIndex, toIndex:det.toIndex, notation:det.notation});
    return false;
  }, [phase, userInfo]);

  const scorePlayerThinking = useCallback((playerMove, boardBefore) => {
    const allMoves = genMoves(boardBefore, 'w');
    const captures = allMoves.filter(m => m.capturedPiece);
    const playedCapture = captures.find(m => m.fromIndex===playerMove.fromIndex && m.toIndex===playerMove.toIndex);
    const bestCapture = [...captures].sort((a,b) => Math.abs(PIECE_VALUES[b.capturedPiece]) - Math.abs(PIECE_VALUES[a.capturedPiece]))[0];
    if(playedCapture && bestCapture && playedCapture.toIndex === bestCapture.toIndex)
      return {stars:3, msg:'⭐⭐⭐ Great capture! You found the best material gain.'};
    if(playedCapture)
      return {stars:2, msg:'⭐⭐ Good — you captured a piece! Did you find the best one?'};
    if(captures.length > 0)
      return {stars:1, msg:`⭐ The bot left a ${bestCapture?.capturedPiece?.toUpperCase()||'piece'} hanging — did you notice?`};
    return {stars:2, msg:'⭐⭐ Solid move. Keep an eye on captures!'};
  }, []);

  const handleSquareClick = idx => {
    if(turn !== 'w' || thinking || gameOver) return;
    const piece = board[idx];
    if(sel !== null){
      if(sel === idx){ setSel(null); return; }
      const legal = genMoves(board,'w').find(m => m.fromIndex===sel && m.toIndex===idx);
      if(legal){
        const score = scorePlayerThinking(legal, board);
        setThinkScore(score);
        setMoveLog(l => [...l, {n:Math.floor(l.length/2)+1, side:'w', notation:legal.notation}]);
        prevBoardRef.current = board;
        const over = applyMove(legal.newBoard, legal);
        if(!over){ setLastHumanMove({notation:legal.notation,fromIndex:legal.fromIndex,toIndex:legal.toIndex}); setTurn('b'); setMsg(null); setLastBot(null); setTree(null); setChosenMove(null); setNodeHighlight(null); setBotExplain(null); setShowWhyPanel(false); }
      } else {
        if(piece && piece === piece.toUpperCase()) setSel(idx); else setSel(null);
      }
    } else {
      if(piece && piece === piece.toUpperCase()) setSel(idx);
    }
  };

  useEffect(() => {
    if(turn !== 'b' || gameOver) return;
    setThinking(true);
    const t = setTimeout(() => {
      try {
        const {move, score, tree:t} = findBestMove(board, depth);
        if(move){
          setTree(t);
          setChosenMove({notation:move.notation, score});
          setBotExplain(explainBotMove(t, move));
          setMoveLog(l => [...l, {n:Math.floor(l.length/2)+1, side:'b', notation:move.notation, score}]);
          setIsFirstTree(false);
          const over = applyMove(move.newBoard, {...move, isBotMove:true});
          if(!over){ setTurn('w'); setMsg(null); }
        } else { setMsg('Bot has no moves — you win!'); setGameOver(true); }
      } catch(e){ console.error(e); setMsg('Error in search.'); setGameOver(true); }
      finally { setThinking(false); }
    }, 600);
    return () => clearTimeout(t);
  }, [turn, gameOver]);

  const highlights = useMemo(() => {
    if(sel===null || turn!=='w' || thinking) return [];
    return genMoves(board,'w').filter(m => m.fromIndex===sel).map(m => m.toIndex);
  }, [board, sel, turn, thinking]);

  const resetGame = () => {
    setBoard(STARTING_BOARD); setSel(null); setTurn('w'); setThinking(false);
    setTree(null); setGameOver(false); setMsg(null);
    setLastBot(null); setChosenMove(null); setMoveLog([]);
    setNodeHighlight(null); setWinMsg(null); setShowReflection(false); setShowConfetti(false);
    setBotExplain(null); setThinkScore(null); setShowWhyPanel(false);
    setIsFirstTree(true); setLastHumanMove(null); setShowReveal(false);
    prevBoardRef.current = STARTING_BOARD;
    treeExpandCount.current = 0;
    treeHoverCount.current = 0;
  };

  const goToGlass = () => {
    resetGame();
    setGlassRound(0);
    setAllReflections([]);
    setPhase('intro');
  };

  // When entering black phase from chess-check, open guide if they don't know chess
  React.useEffect(() => {
    if(phase === 'black') setGuideOpen(!knowsChess);
  }, [phase]);

  const evalScore = evalBoard(board);
  const evalDisplay = fmtScore(evalScore);
  const evalFmt = evalDisplay ? evalDisplay.label : '0.0';
  const evalCol = evalDisplay ? evalDisplay.col : '#94a3b8';
  const statusText = gameOver ? msg : thinking ? null : turn==='w' ? (sel ? 'Select destination or click another piece' : 'Select a White piece to move') : 'Bot is responding…';

  const buildDepthLabels = (d) => {
    const labels = ['🌳 Position now'];
    for(let i=1; i<=d; i++){
      if(i===d) labels.push('📊 Leaf — count the pieces');
      else labels.push(i%2===1 ? "🤖 Bot's move (MAX — picks highest)" : '😊 Your move (MIN — picks lowest for bot)');
    }
    return labels;
  };
  const depthLabels = buildDepthLabels(depth);

  // ── WELCOME ──────────────────────────────────────────────────
  if(phase === 'welcome') return <WelcomePage onStart={info => {
    setUserInfo(info);
    createSession(info).then(id => setSessionId(id)).catch(e => console.warn('[Firebase]', e));
    setPhase('chess-check');
  }}/>;
  if(phase === 'chess-check') return <ChessKnowledgePage
    userName={userInfo?.name || 'there'}
    onAnswer={knows => { setKnowsChess(knows); if(sessionId) saveKnowsChess(sessionId, knows); setPhase('black'); }}
    onBack={()=>setPhase('welcome')}/>;

  // ── END SCREEN ──────────────────────────────────────────────
  if(sessionEnded) return <EndScreen
    userInfo={userInfo}
    allReflections={allReflections}
    gamesPlayed={gamesPlayed}
    maxDepthReached={maxDepthReached}
  />;

  // ── GAME 2 INTRO ─────────────────────────────────────────────
  if(phase === 'intro') return <Game2Intro onStart={()=>{ if(unlockedDepth < 4) setUnlockedDepth(4); setPhase('glass'); }} onBack={()=>setPhase('black')}/>;

  // ── OPEN BOX — now a modal inside game 2, but keep as fallback route ───────
  if(phase === 'open') return <MinimaxPage
    onBack={()=>setPhase('glass')}
    onPlay={()=>{ resetGame(); setPhase('replay'); }}
    showDepthInfo={true}/>;

  // ── GLOBAL STYLES + GAME SHELL (black / glass / replay) ───────
  return(
    <div style={{minHeight:'100vh',background:'#0e0820',color:'#e2d9f3',display:'flex',flexDirection:'column',fontFamily:"'DM Sans',sans-serif"}}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&family=DM+Mono:wght@400;500;700&display=swap');
        *{box-sizing:border-box;margin:0;padding:0}
        body{font-family:'DM Sans',sans-serif}
        html,body,#root{width:100%;min-height:100vh;background:#0e0820}
        ::-webkit-scrollbar{width:6px;height:6px}
        ::-webkit-scrollbar-track{background:#160c2a}
        ::-webkit-scrollbar-thumb{background:#c4b5fd;border-radius:3px}
        ::-webkit-scrollbar-thumb:hover{background:#a78bfa}
        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes fadeUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
        @keyframes nodePulse{0%,100%{box-shadow:0 0 0 3px #8b5cf6,0 0 16px rgba(124,58,237,0.4)}50%{box-shadow:0 0 0 7px rgba(124,58,237,0.12),0 0 28px rgba(139,92,246,0.5)}}
        @keyframes bounceDown{0%,100%{transform:translateY(0)}50%{transform:translateY(5px)}}
        @keyframes thinking-dot{0%,100%{opacity:0.2;transform:scale(0.8)}50%{opacity:1;transform:scale(1.2)}}
        @keyframes depthPulse{0%,100%{box-shadow:0 0 0 0 rgba(34,197,94,0.0)}50%{box-shadow:0 0 0 4px rgba(34,197,94,0.5),0 0 12px rgba(34,197,94,0.3)}}
        .fin{animation:fadeUp 0.35s ease both}
        .fade-in{animation:fadeUp 0.35s ease both}
        .wup{animation:fadeUp 0.5s ease both}
        @keyframes shimmer{0%{background-position:300% center}100%{background-position:-300% center}}
        .shine{display:inline-block;background:linear-gradient(90deg,#a78bfa 0%,#e9d5ff 30%,#ffffff 50%,#e9d5ff 70%,#a78bfa 100%);background-size:300% auto;-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;animation:shimmer 2.5s linear infinite}
        .wf:focus{outline:none;border-color:#8b5cf6!important;box-shadow:0 0 0 3px rgba(124,58,237,0.15)!important}`}</style>

      <Confetti active={showConfetti}/>

      {/* Game 1 end overlay */}
      {phase === 'black' && showReveal && (
        <Game1WinOverlay
          playerWon={!board.includes('k')}
          onLearnHowBotThinks={goToGlass}
          onPlayAgain={()=>{ resetGame(); }}
        />
      )}

      {/* Minimax tutorial modal — triggered by "How does this work?" */}
      {showMinimaxModal && (
        <div style={{position:'fixed',top:0,left:0,width:'100%',height:'100%',background:'rgba(4,2,16,0.88)',backdropFilter:'blur(10px)',zIndex:200,display:'flex',alignItems:'flex-start',justifyContent:'center',overflowY:'auto',padding:'24px 16px'}}>
          <div style={{width:'100%',maxWidth:700,background:'#0e0820',borderRadius:16,border:'1px solid #3b1f6e',overflow:'hidden',boxShadow:'0 8px 60px rgba(139,92,246,0.3)'}}>
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'14px 20px',borderBottom:'1px solid #3b1f6e',background:'#160c28'}}>
              <div style={{fontSize:15,fontWeight:700,color:'#a78bfa',fontFamily:"'DM Mono',monospace"}}>📖 How does minimax work?</div>
              <button onClick={()=>setShowMinimaxModal(false)} style={{fontSize:20,color:'#4c2889',background:'none',border:'none',cursor:'pointer',lineHeight:1}}>✕</button>
            </div>
            <MinimaxPage
              onBack={()=>setShowMinimaxModal(false)}
              onPlay={()=>{ setShowMinimaxModal(false); resetGame(); }}
              showDepthInfo={true}
              isModal={true}
            />
          </div>
        </div>
      )}

      {/* Reflection overlay — shown first after game 2 ends */}
      {isGlassPhase && showReflection && !winMsg && glassRound < 3 && (
        <ReflectionOverlay
          roundIndex={glassRound}
          playerWon={showReflection.playerWon}
          depth={depth}
          onDone={(data)=>{
            setAllReflections(prev => [...prev, data]);
            setReflectionData(data);
            if(sessionId) logReflection(sessionId, data);
            setGlassRound(r => r+1);
            setWinMsg(showReflection);
            setShowReflection(false);
          }}
          onEnd={()=>{
            setAllReflections(prev => {
              // data already added by onDone which fires first
              return prev;
            });
            setSessionEnded(true);
            setWinMsg(null);
            setShowReflection(false);
            if(sessionId) saveSessionEnd(sessionId, { gamesPlayed, maxDepthReached, reflectionCount: allReflections.length + 1 });
          }}
        />
      )}

      {/* Glass box win overlay */}
      {isGlassPhase && (
        <GlassWinOverlay
          msg={winMsg}
          onLearnMore={()=>{ setWinMsg(null); setShowMinimaxModal(true); }}
          onReplay={()=>{ setWinMsg(null); resetGame(); }}
          onTryNewDepth={()=>{ if(winMsg?.newDepth){ if(sessionId) logNextDepthAccepted(sessionId, winMsg.newDepth); setDepth(winMsg.newDepth); } setWinMsg(null); resetGame(); }}
          onClose={()=>setWinMsg(null)}
          moveLog={moveLog}
          depth={depth}
          unlockedDepth={unlockedDepth}
        />
      )}



      {/* HEADER */}
      <div style={{borderBottom:'1px solid #3b1f6e',padding:'10px 20px',display:'flex',alignItems:'center',justifyContent:'space-between',background:'#160c28',boxShadow:'0 1px 8px rgba(139,92,246,0.06)',flexShrink:0,gap:12,flexWrap:'wrap'}}>
        <div style={{display:'flex',alignItems:'center',gap:12}}>
          <button onClick={()=>{ if(phase==='black') setPhase('chess-check'); else if(isGlassPhase) setPhase('intro'); }}
            style={{background:'none',border:'none',color:'#4c2889',fontSize:13,cursor:'pointer',fontFamily:"'DM Mono',monospace",padding:'4px 8px',borderRadius:6,transition:'color 0.15s'}}
            onMouseEnter={e=>e.currentTarget.style.color='#a78bfa'} onMouseLeave={e=>e.currentTarget.style.color='#4c2889'}>← back</button>
          <div style={{width:1,height:28,background:'#3b1f6e'}}/>
          <div style={{fontSize:36,lineHeight:1,color:'#fff',filter:'drop-shadow(0 0 12px rgba(139,92,246,0.8))'}}>♔</div>
          <div>
            <div style={{fontSize:16,fontWeight:800,letterSpacing:-0.3}}><span className="shine">Minimax Chess</span></div>
            <div style={{display:'flex',alignItems:'center',gap:8}}>
              <div style={{fontSize:13,color:'#a78bfa',fontFamily:"'DM Mono',monospace"}}>{userInfo?.name || 'Player'} · depth {depth}</div>
              <PhaseBadge phase={phase}/>
            </div>
          </div>
        </div>
        <div style={{display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}>
          {isGlassPhase && <div style={{padding:'4px 14px',borderRadius:20,background:'rgba(56,189,248,0.08)',border:'1px solid #0369a1',fontSize:13,fontWeight:700,color:'#38bdf8',fontFamily:"'DM Mono',monospace",letterSpacing:0.5}}>depth {depth}</div>}
          {!gameOver && (
            <div style={{textAlign:'right'}}>
              <div style={{fontSize:12,color:'#a78bfa',fontFamily:"'DM Mono',monospace"}}>advantage</div>
              <div style={{fontSize:15,fontWeight:700,color:evalCol,fontFamily:"'DM Mono',monospace"}}>{evalFmt}</div>
            </div>
          )}
          {isGlassPhase && (
            <div style={{display:'flex',alignItems:'center',gap:6,padding:'4px 10px',background:'rgba(139,92,246,0.08)',borderRadius:8,border:'1px solid #3b1f6e'}}>
              <span style={{fontSize:12,color:'#7c3aed',fontFamily:"'DM Mono',monospace"}}>depth</span>
              {[3,4,5].map(d=>{
                const unlocked=d<=unlockedDepth, active=depth===d, isPulse=d===pulseDepth&&unlocked&&!active;
                return <button key={d}
                  onClick={()=>{if(unlocked&&d!==depth){if(sessionId) logDepthChange(sessionId,depth,d);setDepth(d);setPulseDepth(null);}}}
                  title={unlocked?`Depth ${d} — bot thinks ${d} moves ahead`:`Beat depth ${d-1} to unlock`}
                  style={{padding:'3px 10px',borderRadius:6,border:`1.5px solid ${isPulse?'#22c55e':active?'#7c3aed':unlocked?'#3b1f6e':'#1a0e30'}`,background:isPulse?'rgba(34,197,94,0.12)':active?'rgba(124,58,237,0.2)':'transparent',color:isPulse?'#4ade80':active?'#a78bfa':unlocked?'#6d28d9':'#2d1b4e',fontSize:13,cursor:unlocked?'pointer':'not-allowed',fontFamily:"'DM Mono',monospace",fontWeight:isPulse?700:400,animation:isPulse?'depthPulse 1.2s ease-in-out infinite':'none',position:'relative'}}>
                  {unlocked?d:`🔒`}
                  {isPulse && <span style={{position:'absolute',top:-18,left:'50%',transform:'translateX(-50%)',fontSize:9,color:'#4ade80',fontFamily:"'DM Mono',monospace",whiteSpace:'nowrap',background:'rgba(5,46,22,0.95)',border:'1px solid #22c55e',borderRadius:4,padding:'1px 5px',pointerEvents:'none'}}>NEW!</span>}
                </button>;
              })}
            </div>
          )}
          {phase === 'black' && <>
            <button onClick={()=>setGuideOpen(v=>!v)} style={{padding:'5px 14px',background:guideOpen?'rgba(139,92,246,0.15)':'transparent',border:'1px solid '+(guideOpen?'#7c3aed':'#3b1f6e'),borderRadius:8,color:guideOpen?'#c4b5fd':'#a78bfa',fontSize:13,cursor:'pointer',fontFamily:"'DM Mono',monospace",fontWeight:600,display:'flex',alignItems:'center',gap:6,transition:'all 0.15s'}}>
              📖 {guideOpen ? 'Hide Rules' : 'Chess Rules'}
            </button>
            <div style={{width:1,height:28,background:'#3b1f6e'}}/>
          </>}
          <div style={{width:1,height:28,background:'#3b1f6e'}}/>
          <button onClick={resetGame} disabled={thinking} style={{padding:'6px 14px',background:'transparent',border:'1px solid #3b1f6e',borderRadius:8,color:'#a78bfa',fontSize:13,cursor:'pointer',fontFamily:"'DM Mono',monospace"}}
            onMouseEnter={e=>{e.currentTarget.style.borderColor='#ef4444';e.currentTarget.style.color='#fca5a5';}}
            onMouseLeave={e=>{e.currentTarget.style.borderColor='#3b1f6e';e.currentTarget.style.color='#a78bfa';}}>↺ reset</button>
        </div>
      </div>

      {/* BODY */}
      <div ref={containerRef} style={{flex:1,display:'flex',overflow:'hidden',minHeight:0}}>

        {/* LEFT PANEL — board */}
        <div style={{width:phase==='black'?undefined:leftWidth,flex:phase==='black'?1:undefined,flexShrink:phase==='black'?1:0,borderRight:phase!=='black'?'1px solid #3b1f6e':'none',display:'flex',flexDirection:'column',overflowY:'auto',background:'#0e0820',minWidth:0}}>
          <div style={{padding:'18px 18px 0'}}>
            <ChessBoard board={board} selectedSquare={sel} handleSquareClick={handleSquareClick} highlightedMoves={highlights} lastBotMove={lastBot} nodeHighlight={isGlassPhase ? nodeHighlight : null}/>
          </div>

          {!gameOver && (
            <div style={{padding:'10px 18px 0'}}>
              <div style={{display:'flex',justifyContent:'space-between',fontSize:13,color:'#a78bfa',marginBottom:4,fontFamily:"'DM Mono',monospace"}}>
                <span style={{color:'#16a34a'}}>♔ White →</span>
                <span style={{color:evalCol,fontWeight:700}}>{evalFmt}</span>
                <span style={{color:'#dc2626'}}>← Black ♚</span>
              </div>
              <div style={{height:5,background:'#160c2a',borderRadius:99,overflow:'hidden'}}>
                <div style={{height:'100%',borderRadius:99,transition:'all 0.6s',width:`${Math.max(4,Math.min(96,50+(-evalScore)*4))}%`,background:evalCol}}/>
              </div>
            </div>
          )}

          {/* Status */}
          <div style={{padding:'10px 18px'}}>
            {statusText && (
              <div style={{fontSize:13,color:'#c4b5fd',fontFamily:"'DM Mono',monospace",padding:'6px 10px',background:'rgba(139,92,246,0.08)',borderRadius:6,border:'1px solid #2d1b4e',textAlign:'center'}}>
                {thinking ? <span>🤖 <span style={{animation:'spin 1s linear infinite',display:'inline-block'}}>⟳</span> Bot thinking…</span> : statusText}
              </div>
            )}
          </div>

          {/* Think score — glass only */}
          {isGlassPhase && thinkScore && turn==='b' && (
            <div style={{padding:'0 18px'}}>
              <div style={{padding:'8px 12px',background:'rgba(251,191,36,0.08)',border:'1px solid rgba(251,191,36,0.2)',borderRadius:8}}>
                <div style={{fontSize:13,color:'#fbbf24',fontFamily:"'DM Sans',sans-serif"}}>{thinkScore.msg}</div>
              </div>
            </div>
          )}

          {/* Bot explain — glass only */}
          {isGlassPhase && botExplain && (
            <div style={{padding:'10px 18px 0'}}>
              <div style={{background:'#1a0e30',border:'1px solid #3b1f6e',borderRadius:10,padding:'12px 14px'}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:showWhyPanel?8:0}}>
                  <div style={{fontSize:13,fontWeight:700,color:'#22c55e',fontFamily:"'DM Mono',monospace"}}>🤖 Bot played {chosenMove?.notation}</div>
                  <button onClick={()=>setShowWhyPanel(v=>!v)} style={{fontSize:13,color:'#22c55e',background:'rgba(34,197,94,0.1)',border:'1px solid rgba(34,197,94,0.3)',borderRadius:6,padding:'3px 9px',cursor:'pointer',fontFamily:"'DM Mono',monospace"}}>
                    {showWhyPanel ? '▲ hide' : '🔍 why?'}
                  </button>
                </div>
                {showWhyPanel && (
                  <div style={{fontSize:13,color:'#a78bfa',fontFamily:"'DM Sans',sans-serif",lineHeight:1.6}}>
                    <div style={{marginBottom:4}}>✅ <strong style={{color:'#c4b5fd'}}>Chose:</strong> {botExplain.reason}</div>
                    {botExplain.rejected && <div>❌ <strong style={{color:'#c4b5fd'}}>Rejected:</strong> {botExplain.rejected}</div>}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Move log */}
          <div style={{padding:'10px 18px',flex:1}}>
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:6}}>
              <div style={{fontSize:12,color:'#a78bfa',letterSpacing:1.5,textTransform:'uppercase',fontFamily:"'DM Mono',monospace"}}>Move Log</div>
              {isGlassPhase && <div style={{fontSize:11,color:'#4c2889',fontFamily:"'DM Mono',monospace"}}>K Q R B N = pieces</div>}
            </div>
            <div style={{display:'flex',flexDirection:'column',gap:3,maxHeight:140,overflowY:'auto'}}>
              {moveLog.length===0 && <div style={{fontSize:13,color:'#3b1f6e',fontStyle:'italic',fontFamily:"'DM Mono',monospace"}}>No moves yet</div>}
              {Array.from({length:Math.ceil(moveLog.length/2)},(_,i)=>{
                const w=moveLog[i*2],b=moveLog[i*2+1];
                return(
                  <div key={i} style={{display:'flex',gap:6,alignItems:'center',fontSize:13,fontFamily:"'DM Mono',monospace"}}>
                    <span style={{color:'#4c2889',width:18,textAlign:'right'}}>{i+1}.</span>
                    <span style={{color:'#a78bfa',fontWeight:600,minWidth:44}}>{w?.notation}</span>
                    {b && <span style={{color:'#c4b5fd',fontWeight:600,minWidth:44}}>{b.notation}</span>}
                    {isGlassPhase && b?.score!==undefined && <ScorePill score={b.score}/>}
                  </div>
                );
              })}
            </div>
          </div>



          {/* Piece values — glass/replay only (black phase has them in the rules panel) */}
          {isGlassPhase && (
          <div style={{padding:'0 18px 18px'}}>
            <div style={{fontSize:12,color:'#4c2889',letterSpacing:1.5,textTransform:'uppercase',fontFamily:"'DM Mono',monospace",marginBottom:5}}>Piece Values</div>
            <div style={{display:'grid',gridTemplateColumns:'repeat(6,1fr)',gap:4}}>
              {[['P',1],['N',3],['B',3],['R',5],['Q',9],['K','∞']].map(([p,v])=>(
                <div key={p} style={{background:'#0a0618',borderRadius:6,padding:'5px 0',textAlign:'center',border:'1px solid #2d1b4e'}}>
                  <div style={{fontSize:'1.4rem',lineHeight:1}}>{SYM[p]}</div>
                  <div style={{fontSize:12,color:'#6d28d9',fontWeight:700,fontFamily:"'DM Mono',monospace"}}>{v}</div>
                </div>
              ))}
            </div>
          </div>
          )}
        </div>

        {phase !== 'black' && <ResizableDivider onDrag={handleDrag}/>}

        {/* RIGHT PANEL — chess guide in Game 1, minimax tree in Game 2 */}
        {phase === 'black'
          ? <>
            {/* Game 1 sidebar — depth explainer + CTA */}
            <div style={{width:300,flexShrink:0,background:'#0a0618',borderLeft:'1px solid #2d1b4e',display:'flex',flexDirection:'column',padding:'20px 18px',gap:16,overflowY:'auto'}}>
              {/* Depth explainer */}
              <div>
                <div style={{fontSize:12,color:'#a78bfa',fontWeight:700,letterSpacing:1,textTransform:'uppercase',fontFamily:"'DM Mono',monospace",marginBottom:10}}>What does depth mean?</div>
                <div style={{display:'flex',flexDirection:'column',gap:6}}>
                  {[
                    {d:3,label:'Depth 3',desc:'Bot thinks 3 moves ahead',col:'#6d28d9'},
                    {d:4,label:'Depth 4',desc:'Bot thinks 4 moves ahead',col:'#7c3aed'},
                    {d:5,label:'Depth 5',desc:'Bot thinks 5 moves ahead',col:'#9333ea'},
                  ].map(({d,label,desc,col})=>(
                    <div key={d} style={{padding:'8px 10px',borderRadius:8,border:`1px solid ${depth===d?col+'80':'#2d1b4e'}`,background:depth===d?col+'12':'transparent',cursor:'pointer',transition:'all 0.15s'}}
                      onClick={()=>setDepth(d)}>
                      <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:2}}>
                        <div style={{width:6,height:6,borderRadius:'50%',background:col,opacity:depth===d?1:0.4}}/>
                        <span style={{fontSize:12,fontWeight:700,color:depth===d?'#c4b5fd':'#a78bfa',fontFamily:"'DM Mono',monospace"}}>{label}</span>
                        {depth===d && <span style={{fontSize:10,color:col,fontFamily:"'DM Mono',monospace",marginLeft:'auto'}}>current</span>}
                      </div>
                      <div style={{fontSize:11,color:depth===d?'#7c6a9c':'#4c2889',paddingLeft:12}}>{desc}</div>
                    </div>
                  ))}
                </div>
                <div style={{marginTop:12,padding:'8px 10px',background:'rgba(124,58,237,0.07)',border:'1px solid #3b1f6e',borderRadius:8}}>
                  <div style={{fontSize:12,color:'#c4b5fd',fontWeight:700,fontFamily:"'DM Sans',sans-serif",marginBottom:3}}>More depth = smarter, but slower.</div>
                  <div style={{fontSize:11,color:'#6d28d9',fontFamily:"'DM Mono',monospace",lineHeight:1.6}}>Each extra level means the bot considers every possible reply to every possible reply.</div>
                </div>
              </div>
              {/* Divider */}
              <div style={{height:1,background:'#2d1b4e'}}/>
              {/* CTA */}
              <div>
                <div style={{fontSize:11,color:'#4c2889',letterSpacing:1.5,textTransform:'uppercase',fontFamily:"'DM Mono',monospace",marginBottom:10}}>Ready to see inside?</div>
                <button onClick={goToGlass}
                  style={{width:'100%',padding:'12px 10px',borderRadius:10,border:'none',cursor:'pointer',background:'linear-gradient(135deg,#7c3aed,#9333ea)',color:'#fff',fontSize:13,fontWeight:700,fontFamily:"'DM Sans',sans-serif",boxShadow:'0 2px 16px rgba(139,92,246,0.35)',lineHeight:1.4,textAlign:'center'}}>
                  Start a new game →<br/>
                  <span style={{fontSize:11,fontWeight:400,opacity:0.85}}>learn how the bot thinks while you play</span>
                </button>
              </div>
            </div>
            <ChessGuidePanel thinking={thinking} onLearnHowBotThinks={goToGlass} open={guideOpen} onClose={()=>setGuideOpen(false)}/>
          </>
          : (
          <div style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden',minWidth:0}}>

            <div style={{borderBottom:'1px solid #3b1f6e',padding:'10px 24px',display:'flex',alignItems:'center',justifyContent:'space-between',background:'#160c28',flexShrink:0,flexWrap:'wrap',gap:8}}>
              <div style={{display:'flex',alignItems:'center',gap:12}}>
                <div style={{fontSize:15,fontWeight:700,color:'#a78bfa',fontFamily:"'DM Mono',monospace"}}>🧠 Minimax Tree</div>
                <button onClick={()=>setShowMinimaxModal(true)} style={{padding:'4px 12px',borderRadius:20,border:'1px solid #3b1f6e',background:'transparent',color:'#7c3aed',fontSize:12,cursor:'pointer',fontFamily:"'DM Mono',monospace",transition:'all 0.15s'}}
                  onMouseEnter={e=>{e.currentTarget.style.borderColor='#7c3aed';e.currentTarget.style.color='#a78bfa';}}
                  onMouseLeave={e=>{e.currentTarget.style.borderColor='#3b1f6e';e.currentTarget.style.color='#7c3aed';}}>
                  how does this work? →
                </button>
              </div>
              <div style={{display:'flex',gap:10,flexWrap:'wrap'}}>
                {[['#9333ea',"🤖 Bot (MAX)"],['#f97316','😊 You (MIN)'],['#22c55e','✓ Chosen'],['#f59e0b','★ Your move'],['#a78bfa','📊 Leaf']].map(([c,l])=>(
                  <span key={l} style={{display:'flex',alignItems:'center',gap:5,fontSize:12,color:'#a78bfa',fontFamily:"'DM Mono',monospace"}}>
                    <span style={{width:7,height:7,borderRadius:2,background:c,display:'inline-block',flexShrink:0}}/>
                    {l}
                  </span>
                ))}
              </div>
            </div>
            <div style={{flex:1,overflowY:'auto',overflowX:'auto',padding:'24px 32px'}}>
              {tree && (
                <div style={{textAlign:'center',marginBottom:18,padding:'10px 18px',background:'rgba(124,58,237,0.07)',border:'1px solid rgba(124,58,237,0.15)',borderRadius:10,maxWidth:520,margin:'0 auto 18px'}}>
                  <div style={{fontSize:13,color:'#a78bfa',fontFamily:"'DM Mono',monospace",lineHeight:1.8}}>
                    🤖 Bot picks highest (MAX) · 😊 You pick lowest (MIN)
                  </div>
                  <div style={{fontSize:12,color:'#22c55e',fontFamily:"'DM Mono',monospace",marginTop:2}}>Follow the <span style={{fontWeight:700}}>✓ green path</span> root → leaf for the bot's full plan</div>
                </div>
              )}
              <div style={{display:'inline-block',minWidth:'100%'}}>
                <InteractiveTree
                  root={tree}
                  depthLabels={depthLabels}
                  onHover={node=>{
                    if(node){ treeHoverCount.current++; if(sessionId) logTreeHover(sessionId, node.label); }
                    setNodeHighlight(node ? {fromIndex:node.fromIndex,toIndex:node.toIndex,label:node.label} : null);
                  }}
                  onExpand={node=>{ treeExpandCount.current++; if(sessionId) logTreeExpand(sessionId, {label:node.label,depth:node.depth}); }}
                  onTreeTutorial={()=>{}}
                  isFirstTree={isFirstTree}
                  actualHumanMove={lastHumanMove}
                  isBotTree={true}
                />
              </div>
            </div>
            <div style={{borderTop:'1px solid #3b1f6e',padding:'5px 24px',background:'#160c28',display:'flex',alignItems:'center',gap:8,flexShrink:0}}>
              <span style={{fontSize:12,color:'#3b1f6e',fontFamily:"'DM Mono',monospace"}}>scroll to explore</span>
              <div style={{flex:1,height:2,background:'#160c2a',borderRadius:99,overflow:'hidden'}}>
                <div style={{height:'100%',width:'35%',background:'linear-gradient(90deg,#4c2889,#7c3aed)',borderRadius:99}}/>
              </div>
            </div>
            <div style={{borderTop:'1px solid #3b1f6e',padding:'12px 20px',background:'#160c28',flexShrink:0}}>
              <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(160px,1fr))',gap:8}}>
                {[
                  {col:'#9333ea',emoji:'🤖',title:'Bot node — MAX',body:'Bot is choosing. It picks the HIGHEST score.'},
                  {col:'#f97316',emoji:'😊',title:'Your node — MIN',body:"Bot assumes you pick worst for it — the LOWEST score."},
                  {col:'#a78bfa',emoji:'📊',title:'Leaf score',body:'"White +2" = White has 2 more points. Scores bubble UP.'},
                  {col:'#22c55e',emoji:'✓',title:'Green path',body:'The line the bot actually played. Trace root → leaf.'},
                ].map(({col,emoji,title,body})=>(
                  <div key={title} style={{display:'flex',gap:6}}>
                    <div style={{width:2,borderRadius:99,background:col,flexShrink:0,alignSelf:'stretch'}}/>
                    <div>
                      <div style={{fontSize:13,fontWeight:700,color:col,fontFamily:"'DM Mono',monospace",marginBottom:1}}>{emoji} {title}</div>
                      <div style={{fontSize:12,color:'#7c6a9c',fontFamily:"'DM Sans',sans-serif",lineHeight:1.5}}>{body}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
          )}
      </div>
    </div>
  );
}