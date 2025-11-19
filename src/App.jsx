import React, { useState, useEffect, useCallback, useMemo } from 'react';

// --- 1. CONFIGURATION & UTILITIES ---
// --- PIECE VALUES (For Evaluation Function) ---
const PIECE_VALUES = {
    P: 1, N: 3, B: 3, R: 5, Q: 9, K: 1000,
    p: -1, n: -3, b: -3, r: -5, q: -9, k: -1000,
};

// --- INITIAL BOARD STATE ---
const STARTING_BOARD = [
    'r', 'n', 'b', 'q', 'k', 'b', 'n', 'r',
    'p', 'p', 'p', 'p', 'p', 'p', 'p', 'p',
    null, null, null, null, null, null, null, null,
    null, null, null, null, null, null, null, null,
    null, null, null, null, null, null, null, null,
    null, null, null, null, null, null, null, null,
    'P', 'P', 'P', 'P', 'P', 'P', 'P', 'P',
    'R', 'N', 'B', 'Q', 'K', 'B', 'N', 'R',
];

// --- Replace PIECE_SYMBOLS to use standard, correct Unicode glyphs ---
const PIECE_SYMBOLS = {
    'r': '♜', 'n': '♞', 'b': '♝', 'q': '♛', 'k': '♚', 'p': '♟', 
    'R': '♜', 'N': '♞', 'B': '♝', 'Q': '♛', 'K': '♚', 'P': '♟', 
    //'R': '♖', 'N': '♘', 'B': '♗', 'Q': '♕', 'K': '♔', 'P': '♙',
};

const getFileRank = (index) => {
    const file = String.fromCharCode('a'.charCodeAt(0) + (index % 8));
    const rank = 8 - Math.floor(index / 8);
    return `${file}${rank}`;
};

const getMoveNotation = (fromIndex, toIndex, piece, targetPiece, promotedPiece) => {
    const fromSq = getFileRank(fromIndex);
    const toSq = getFileRank(toIndex);
    const isCapture = !!targetPiece;
    const pieceChar = piece.toUpperCase();
    
    let promotion = '';
    if (promotedPiece) {
        promotion = '=' + promotedPiece.toUpperCase();
    }
    
    let notation = '';

    if (pieceChar === 'P') {
        notation = isCapture ? `${fromSq.charAt(0)}x${toSq}${promotion}` : `${toSq}${promotion}`;
    } else {
        notation = `${pieceChar}${isCapture ? 'x' : ''}${toSq}`;
    }
    return notation;
};

// --- CORE GAME LOGIC (EVALUATION, MOVES, MINIMAX) ---

const evaluateBoard = (board) => {
    // Score is inverted so positive score favors Black (Bot)
    return board.reduce((score, piece) => {
        if (piece) {
            return score + PIECE_VALUES[piece];
        }
        return score;
    }, 0) * -1;
};

const generatePlausibleMoves = (board, player) => {
    const isWhite = player === 'w';
    const moves = [];

    const addMove = (fromIndex, toIndex, piece, capturedPiece, promotedPiece = null) => {
        const newBoard = [...board];
        let pieceToMove = piece;
        const targetRow = Math.floor(toIndex / 8);

        // Simple Promotion check (Pawn to Queen)
        if (piece.toUpperCase() === 'P' && (targetRow === 0 || targetRow === 7)) {
            pieceToMove = isWhite ? 'Q' : 'q';
        }

        newBoard[toIndex] = pieceToMove;
        newBoard[fromIndex] = null;
        
        const notation = getMoveNotation(fromIndex, toIndex, piece, capturedPiece, pieceToMove !== piece ? pieceToMove : null);
        moves.push({ fromIndex, toIndex, newBoard, piece, notation, capturedPiece });
    };

    for (let fromIndex = 0; fromIndex < 64; fromIndex++) {
        const piece = board[fromIndex];
        if (!piece) continue;

        const isPieceWhite = (piece === piece.toUpperCase());
        if (isWhite !== isPieceWhite) continue;

        const pieceType = piece.toUpperCase();
        const row = Math.floor(fromIndex / 8);
        const col = fromIndex % 8;

        const isEnemy = (targetPiece) => targetPiece && (isWhite !== (targetPiece === targetPiece.toUpperCase()));

        let directions = [];
        let maxSteps = 1;

        if (pieceType === 'R') { directions = [[-1, 0], [1, 0], [0, -1], [0, 1]]; maxSteps = 8; } 
        else if (pieceType === 'B') { directions = [[-1, -1], [-1, 1], [1, -1], [1, 1]]; maxSteps = 8; } 
        else if (pieceType === 'Q') { directions = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [-1, 1], [1, -1], [1, 1]]; maxSteps = 8; } 
        else if (pieceType === 'N') { directions = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]]; } 
        else if (pieceType === 'K') { directions = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [-1, 1], [1, -1], [1, 1]]; } 
        else if (pieceType === 'P') {
            const direction = isWhite ? -1 : 1; 
            
            const singleStepRow = row + direction;
            const targetCol = col;
            if (singleStepRow >= 0 && singleStepRow < 8) {
                const toIndex = singleStepRow * 8 + targetCol;
                if (!board[toIndex]) {
                    // Single step move
                    addMove(fromIndex, toIndex, piece, null);
                    
                    // Double step move (only from starting row)
                    if ((isWhite && row === 6) || (!isWhite && row === 1)) {
                        const doubleStepRow = row + direction * 2;
                        if (doubleStepRow >= 0 && doubleStepRow < 8) {
                            const doubleIndex = doubleStepRow * 8 + targetCol;
                            if (!board[doubleIndex]) {
                                addMove(fromIndex, doubleIndex, piece, null);
                            }
                        }
                    }
                }
            }
            
            // Captures
            for (const dCol of [-1, 1]) {
                const captureRow = row + direction;
                const captureCol = col + dCol;
                if (captureRow >= 0 && captureRow < 8 && captureCol >= 0 && captureCol < 8) {
                    const toIndex = captureRow * 8 + captureCol;
                    const targetPiece = board[toIndex];
                    if (isEnemy(targetPiece)) {
                        addMove(fromIndex, toIndex, piece, targetPiece); 
                    }
                }
            }
            continue; 
        }

        for (const [dRow, dCol] of directions) {
            for (let step = 1; step <= maxSteps; step++) {
                const newRow = row + dRow * step;
                const newCol = col + dCol * step;

                if (newRow < 0 || newRow >= 8 || newCol < 0 || newCol >= 8) break; 
                const toIndex = newRow * 8 + newCol;
                const targetPiece = board[toIndex];

                if (targetPiece) {
                    if (isEnemy(targetPiece)) {
                        addMove(fromIndex, toIndex, piece, targetPiece); 
                    }
                    break; 
                } else {
                    addMove(fromIndex, toIndex, piece, null); 
                }
                if (maxSteps === 1) break; 
            }
        }
    }
    return moves;
};

// --- Minimax & FindBestMove Logic (using existing structure) ---
let SEARCH_LOG = []; 
const logStep = (type, depth, details) => {
    // Only log specific types to keep the volume manageable for the display
    if (type === 'EVAL' || type === 'PRUNE' || details.isAlphaUpdate || details.isBetaUpdate || type === 'ROOT_MOVE') {
        SEARCH_LOG.push({ type, depth, ...details });
    }
};

const minimax = (board, depth, isBotTurn, alpha, beta) => {
    if (depth === 0) {
      const score = evaluateBoard(board);
      logStep('EVAL', depth, { score, player: isBotTurn ? 'Black' : 'White' });
      return score;
    }

    // Determine whose turn it is
    const player = isBotTurn ? 'b' : 'w';
    const moves = generatePlausibleMoves(board, player);

    // The simple move generator does not check for check/checkmate, 
    // but for this educational demo, we'll return the current evaluation if no moves exist.
    if (moves.length === 0) return evaluateBoard(board);

    if (isBotTurn) {
        // Maximizing player (Bot - Black)
        let maxEval = -Infinity;
        for (const move of moves) {
            // The evaluation is from the opposing player's turn (false = White/Minimizing)
            const evaluation = minimax(move.newBoard, depth - 1, false, alpha, beta);
            
            if (evaluation > maxEval) {
                maxEval = evaluation;
                logStep('MAX_UPDATE', depth, { 
                    score: evaluation, 
                    newMax: maxEval, 
                    isAlphaUpdate: evaluation > alpha, 
                    alpha, 
                    beta, 
                    piece: move.piece, 
                    notation: move.notation 
                });
            }
            alpha = Math.max(alpha, evaluation);
            if (beta <= alpha) {
                logStep('PRUNE', depth, { reason: 'Beta Cutoff (Too Good)', alpha, beta, piece: move.piece, notation: move.notation });
                break; 
            }
        }
        return maxEval;
    } else {
        // Minimizing player (Human - White)
        let minEval = Infinity;
        for (const move of moves) {
            // The evaluation is from the opposing player's turn (true = Black/Maximizing)
            const evaluation = minimax(move.newBoard, depth - 1, true, alpha, beta);
            
            if (evaluation < minEval) {
                minEval = evaluation;
                logStep('MIN_UPDATE', depth, { 
                    score: evaluation, 
                    newMin: minEval, 
                    isBetaUpdate: evaluation < beta, 
                    alpha, 
                    beta, 
                    piece: move.piece, 
                    notation: move.notation 
                });
            }
            beta = Math.min(beta, evaluation);
            if (beta <= alpha) {
                logStep('PRUNE', depth, { reason: 'Alpha Cutoff (Too Bad)', alpha, beta, piece: move.piece, notation: move.notation });
                break; 
            }
        }
        return minEval;
    }
};

const findBestMove = (board, depth) => {
    let bestScore = -Infinity;
    let bestMove = null;
    const botMoves = generatePlausibleMoves(board, 'b');
    const allMoves = [];
    
    SEARCH_LOG = []; 

    // Sort moves randomly for initial tie-breaking consistency
    botMoves.sort(() => Math.random() - 0.5); 

    for (const move of botMoves) {
        SEARCH_LOG.push({ type: 'ROOT_MOVE', depth: depth, move: move, notation: move.notation });

        // Minimax is called with the next turn (White/Minimizing), starting with alpha=bestScore and beta=Infinity
        const score = minimax(move.newBoard, depth - 1, false, bestScore, Infinity);
        
        allMoves.push({ move, score, notation: move.notation });

        if (score > bestScore) {
            bestScore = score;
            bestMove = move;
        }
    }

    const chosenMoveObject = allMoves.find(m => m.move === bestMove);

    allMoves.sort((a, b) => b.score - a.score);

    return { 
        move: bestMove, 
        score: bestScore, 
        allMoves, 
        chosenMoveNotation: chosenMoveObject ? chosenMoveObject.notation : 'No Move',
        searchLog: SEARCH_LOG,
    };
};


// --- 2. HELPER COMPONENTS (DEFINED OUTSIDE OF APP) ---

const formatScore = (score) => {
    if (typeof score !== 'number') return '--';
    const sign = score > 0 ? '+' : '';
    return `${sign}${score.toFixed(2)}`;
};

const Square = React.memo(({ index, piece, isLight, isSelected, onClick, isHighlighted, isLastBotMove }) => {
    const fileRank = getFileRank(index);
    const pieceSymbol = piece ? PIECE_SYMBOLS[piece] : '';

    // Board Colors
    const bgColor = isLight ? 'bg-amber-200' : 'bg-amber-800';
    let ringClass = '';
    let pieceColorClass = '';
    
    // White Pieces (P, R, N, B, Q, K) are visually light/black text
    // Black Pieces (p, r, n, b, q, k) are visually dark/white text
    const isWhitePiece = piece && piece === piece.toUpperCase();

    // 1. IMPROVEMENT: Unified color for White pieces (Bot)
    if (isWhitePiece) {
        // White pieces (Bot): Black text, no drop shadow needed for unified look
        pieceColorClass = 'text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.8)]'; 
    } else {
        // Black pieces (Kids/Human)
        pieceColorClass = 'text-black'; 
    }

    // Highlight Selection
    if (isSelected) {
      // Blue ring for selected piece
      ringClass = 'ring-4 ring-blue-500/80 shadow-[inset_0_0_10px_rgba(59,130,246,0.9)]';
    } else if (isHighlighted) { 
        // Target/Possible Move Highlight
        if (piece) {
             // Red ring for a capture (or King Capture ending move)
           ringClass = 'ring-4 ring-red-500/80 shadow-[inset_0_0_10px_rgba(239,68,68,0.9)]'; 
        } else {
            // Yellow ring for empty square target
            ringClass = 'ring-2 ring-yellow-400/80';
        }
    } else if (isLastBotMove) { // 3. IMPROVEMENT: Highlight last bot move
        // Green ring for last bot move square
        ringClass = 'ring-4 ring-green-400/80 shadow-[inset_0_0_10px_rgba(52,211,153,0.9)]';
    }
    
    // Dot highlight for possible empty targets
    const dotHighlight = isHighlighted && !piece ? 'absolute w-4 h-4 bg-yellow-400/80 rounded-full' : '';

    return (
      <div
        className={`relative flex items-center justify-center text-5xl cursor-pointer transition-all duration-100 ${bgColor} ${ringClass} rounded-sm shadow-md hover:shadow-lg`}
        onClick={() => onClick(index)}
        aria-label={`Square ${fileRank}`}
      >
        {/* Pieces will render using system default Unicode fonts */}
        <span className={`${pieceColorClass} select-none z-10 chess-piece-symbol piece-size`}>{pieceSymbol}</span>
        {dotHighlight && <div className={dotHighlight}></div>}
      </div>
    );
});

const ChessBoard = React.memo(({ board, selectedSquare, handleSquareClick, highlightedMoves, lastBotMove }) => {
    const squares = [];
    for (let i = 0; i < 64; i++) {
        const isLight = (Math.floor(i / 8) + (i % 8)) % 2 === 0;
        const isSelected = selectedSquare === i;
        const isTarget = highlightedMoves.includes(i);
        
        // 3. IMPROVEMENT: Check if this square was part of the last bot move
        const isLastBotMove = lastBotMove && (i === lastBotMove.fromIndex || i === lastBotMove.toIndex);
        
        // 2. IMPROVEMENT: Prioritize the capture highlight for the ending move square if it's a King capture
        // We only show the target highlight if a piece is selected OR if it's the last bot move capture square
        const isSquareHighlighted = isTarget || (isLastBotMove && lastBotMove.capturedKing);

        squares.push(
            <Square
                key={i}
                index={i}
                piece={board[i]}
                isLight={isLight}
                isSelected={isSelected}
                isHighlighted={isSquareHighlighted}
                isLastBotMove={isLastBotMove && !isSquareHighlighted} // Only use green highlight if not blue/red
                onClick={handleSquareClick}
            />
        );
    }

    return (
      // Enforced max-w-full to prevent overflow on very small screens, 
      // ensuring the board takes up available width dynamically.
      <div className="grid grid-cols-8 grid-rows-8 w-full max-w-full sm:max-w-xl aspect-square border-8 border-amber-900 shadow-2xl rounded-lg overflow-hidden">
        {squares}
      </div>
    );
});

const MinimaxLogDisplay = ({ minimaxLog, lastBotMove }) => {
    // Show only the latest 100 log entries
    const logs = minimaxLog.slice(-100); 
    
    // 4. IMPROVEMENT: More informative placeholder
    if (logs.length === 0 && !lastBotMove) {
        return (
            <p className="text-gray-400 italic">The search log will appear here after the Bot's first move.</p>
        );
    }

    // Scroll to bottom on new logs
    const logRef = React.useRef(null);
    useEffect(() => {
        if (logRef.current) {
            logRef.current.scrollTop = logRef.current.scrollHeight;
        }
    }, [minimaxLog]);
    
    // 4. IMPROVEMENT: Include the last bot move notation in the log display title
    const lastMoveNotation = lastBotMove ? lastBotMove.notation : 'N/A';
    
    return (
        <div className="pt-3">
            <p className="text-xl font-bold text-purple-400 mb-3 border-b pb-2 border-purple-700">
                <span className="text-xl mr-2">🌳</span> MINIMAX DECISION TREE (Depth {lastBotMove ? '3' : 'N/A'})
                {/* 3. IMPROVEMENT: Display last move notation right above the log */}
                <span className="block text-sm font-medium text-green-400 mt-1">
                    Last Bot Move: <span className="font-mono text-lg">{lastMoveNotation}</span>
                </span>
            </p>
            
            <div ref={logRef} className="space-y-2 max-h-96 overflow-y-auto pr-2 custom-scrollbar">
                {logs.length > 0 ? logs.map((log, index) => {
                    const isPrune = log.type === 'PRUNE';
                    const isEval = log.type === 'EVAL';
                    const isUpdate = log.type.includes('_UPDATE');
                    const isRoot = log.type === 'ROOT_MOVE';

                    let colorClass = 'text-gray-300';
                    let icon = '•';
                    let text = '';
                    const moveNotation = log.notation ? ` (${log.notation})` : '';
                    
                    if (isRoot) {
                        colorClass = 'text-blue-300 font-bold bg-blue-900/40 p-1 rounded';
                        icon = '🚀';
                        text = `Checking Root Move: ${log.notation}`;
                    } else if (isEval) {
                        colorClass = 'text-purple-300 font-medium';
                        icon = '💰';
                        text = `Depth ${log.depth}: Evaluated Leaf Node. Score: ${formatScore(log.score)}`;
                    } else if (isPrune) {
                        colorClass = 'text-red-400 font-extrabold bg-red-900/30 p-1 rounded';
                        icon = '✂️';
                        text = `Depth ${log.depth}: PRUNED! ${log.reason} ${moveNotation}.`;
                    } else if (isUpdate) {
                        colorClass = log.type === 'MAX_UPDATE' ? 'text-green-400' : 'text-yellow-400';
                        icon = log.type === 'MAX_UPDATE' ? '⬆️' : '⬇️';
                        const player = log.type === 'MAX_UPDATE' ? 'MAXIMIZER (Black)' : 'MINIMIZER (White)';
                        const scoreType = log.type === 'MAX_UPDATE' ? 'Max' : 'Min';
                        const alphaBetaUpdate = (log.isAlphaUpdate || log.isBetaUpdate) ? ' (A/B Update)' : '';
                        text = `Depth ${log.depth}: ${player} found better ${scoreType} score ${formatScore(log.score)}${alphaBetaUpdate}${moveNotation}.`;
                    }

                    return (
                        <div key={index} className={`text-xs sm:text-sm font-mono ${colorClass} transition-all duration-300`}>
                            <span className="mr-2">{icon}</span>{text}
                        </div>
                    );
                }) : (
                    <p className="text-gray-400 italic">No search steps yet. Waiting for the bot's first calculation...</p>
                )}
            </div>
            <p className="text-sm text-gray-400 mt-3 italic">
                **PRUNED** steps indicate where the **Alpha-Beta Optimization** saved calculation time.
            </p>
        </div>
    );
};

const BotAnalysisUnit = ({ board, analysis, minimaxLog, MINIMAX_DEPTH, lastBotMove }) => {
    const currentEval = evaluateBoard(board);

    return (
      <div className="bg-gray-800 p-6 rounded-xl shadow-2xl border-2 border-blue-600 space-y-5 transition-all duration-500 h-full">
        <h3 className="text-2xl font-extrabold text-blue-400 border-b pb-2 border-blue-700 flex items-center">
          {/* Inline CPU SVG for reliability */}
          <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6 mr-2 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1h-.75M3 15h18M5 12h14M3 9h18m1-5v10m-1-10v10m-4-10v10m-4-10v10M12 4v10M12 4v10m-4-10v10m-4-10v10"/></svg>
          Bot Strategic Analysis
        </h3>
        
        {/* Current Evaluation */}
        <div className="bg-gray-900/50 p-3 rounded-lg border-l-4 border-gray-400 shadow-inner">
            <p className="text-lg font-bold text-gray-300">
                Current Board Score: <span className={`font-mono text-xl ${currentEval > 0 ? 'text-green-400' : 'text-red-400'}`}>{formatScore(currentEval)}</span>
            </p>
            <p className="text-sm text-gray-400">Score before Bot's move. Positive favors Black (Bot).</p>
        </div>

        {/* Chosen Move */}
        {analysis && analysis.chosenMove.move && (
            <div className="bg-green-800/50 p-4 rounded-lg border-l-4 border-green-400 shadow-lg animate-pulse-once">
              <p className="text-lg font-bold text-green-300">
                <span className="text-xl mr-2">✅</span> CHOSEN MOVE (Maximized Score)
              </p>
              <div className="mt-2 flex justify-between items-center bg-green-900/40 p-3 rounded-md">
                <span className="text-3xl font-mono text-white tracking-wider">{analysis.chosenMove.notation}</span>
                <span className="text-2xl font-extrabold text-green-400">Score: {formatScore(analysis.chosenMove.score)}</span>
              </div>
            </div>
        )}
        
        {/* Minimax Log Visualization */}
        <MinimaxLogDisplay minimaxLog={minimaxLog} lastBotMove={lastBotMove} />
      </div>
    );
};


// --- 3. MAIN APP COMPONENT ---

const App = () => {
    const MINIMAX_DEPTH = 3; 
    const [board, setBoard] = useState(STARTING_BOARD);
    const [selectedSquare, setSelectedSquare] = useState(null);
    const [turn, setTurn] = useState('w'); 
    const [isBotThinking, setIsBotThinking] = useState(false);
    const [analysis, setAnalysis] = useState(null); 
    const [minimaxLog, setMinimaxLog] = useState([]); 
    const [gameOver, setGameOver] = useState(false);
    const [message, setMessage] = useState("Your move (White). Play aggressively!");
    
    // 3. IMPROVEMENT: State to track the last bot move details for highlighting
    const [lastBotMove, setLastBotMove] = useState(null);

    // --- MOVE HANDLING ---

    const processMove = useCallback((newBoard, moveDetails = null) => {
        const newWhiteKingCount = newBoard.filter(p => p === 'K').length;
        const newBlackKingCount = newBoard.filter(p => p === 'k').length;

        // Check for King Capture (Game End)
        if (newWhiteKingCount === 0 || newBlackKingCount === 0) {
            setGameOver(true);
            
            // 2. IMPROVEMENT: Capture details for end-game highlight
            if (moveDetails) {
                const capturedKing = moveDetails.capturedPiece === 'K' || moveDetails.capturedPiece === 'k';
                setLastBotMove({
                    fromIndex: moveDetails.fromIndex,
                    toIndex: moveDetails.toIndex,
                    notation: moveDetails.notation,
                    capturedKing: capturedKing
                });
            }
            
            if (newWhiteKingCount === 0) {
                setMessage("Game Over! Black wins by King capture. The Minimax Bot conquered!");
            } else {
                setMessage("Game Over! White wins by King capture.");
            }
            return true; 
        }

        setBoard(newBoard);
        setSelectedSquare(null);
        // REMOVED: setMinimaxLog([]); // Log is cleared when human moves and set when bot moves.
        
        // 3. IMPROVEMENT: Store the move only if it was a bot move (called outside of human move logic)
        if (moveDetails && moveDetails.isBotMove) {
            setLastBotMove({
                fromIndex: moveDetails.fromIndex,
                toIndex: moveDetails.toIndex,
                notation: moveDetails.notation,
                capturedKing: false
            });
        }
        return false; 
    }, []);

    const handleSquareClick = (index) => {
        if (turn === 'b' || isBotThinking || gameOver) return;

        const piece = board[index];

        if (selectedSquare !== null) {
            if (selectedSquare === index) {
                // Deselect
                setSelectedSquare(null);
            } else {
                // Attempt Move
                const mockMoves = generatePlausibleMoves(board, 'w');
                const legalMove = mockMoves.find(
                    m => m.fromIndex === selectedSquare && m.toIndex === index
                );

                if (legalMove) {
                    // Pass move details for King Capture check
                    const isGameOver = processMove(legalMove.newBoard, legalMove);
                    
                    if (!isGameOver) {
                        setTurn('b');
                        setMessage("Bot is calculating... (Depth: 3)");
                    }
                    // Clear the last bot move as a human just moved
                    setLastBotMove(null); 
                    // FIX: Clear the log state immediately after the human move
                    setMinimaxLog([]); 
                } else {
                    // Clicks on another friendly piece or an illegal square
                    const selectedPiece = board[selectedSquare];
                    const isWhitePiece = selectedPiece === selectedPiece.toUpperCase();
                    
                    if (piece && isWhitePiece) {
                        setSelectedSquare(index);
                    } else {
                        setSelectedSquare(null);
                    }
                }
            }
        } else {
            // Select piece
            if (piece && piece === piece.toUpperCase()) {
                setSelectedSquare(index);
            }
        }
    };

    // --- Bot Move Logic (Minimax) ---
    useEffect(() => {
        if (turn === 'b' && !gameOver) {
            setIsBotThinking(true);
            
            // Debouncing the AI search to ensure smooth UI transition
            const timer = setTimeout(() => {
                try {
                    // findBestMove clears the global SEARCH_LOG internally.
                    const { move, score, allMoves, chosenMoveNotation, searchLog } = findBestMove(board, MINIMAX_DEPTH);
            
                    if (move) {
                        setAnalysis({
                            chosenMove: { move, score, notation: chosenMoveNotation },
                            alternatives: allMoves.filter(m => m.move !== move).slice(0, 3), 
                        });
                        
                        // FIX: Update the log state here, after the search completes
                        setMinimaxLog(searchLog); 
                        
                        // Pass move details for King Capture check and isBotMove flag
                        const isGameOver = processMove(move.newBoard, { ...move, isBotMove: true });
                        
                        if (!isGameOver) {
                            setTurn('w');
                            setMessage("White's turn. Study the Bot's logic below!");
                        }
                    } else {
                        setMessage("Game Over! The Bot has no plausible moves.");
                        setGameOver(true);
                    }
                } catch (error) {
                    console.error("Minimax Search Failed:", error);
                    setMessage("Error: Minimax search failed. Game halted to prevent freezing.");
                    setGameOver(true); 
                } finally {
                    setIsBotThinking(false);
                }
            }, 700); 

            return () => clearTimeout(timer);
        }
    }, [turn, board, processMove, gameOver, MINIMAX_DEPTH]);

    // --- UI and Visualization Data ---
    const highlightedMoves = useMemo(() => {
        if (selectedSquare !== null && turn === 'w' && !isBotThinking) {
            return generatePlausibleMoves(board, 'w')
                .filter(m => m.fromIndex === selectedSquare)
                .map(m => m.toIndex);
        }
        return [];
    }, [board, selectedSquare, turn, isBotThinking]);
    
    const resetGame = () => {
        setBoard(STARTING_BOARD);
        setSelectedSquare(null);
        setTurn('w');
        setIsBotThinking(false);
        setAnalysis(null);
        setMinimaxLog([]);
        setGameOver(false);
        setMessage("New Game! Your move (White). Play aggressively!");
        setLastBotMove(null);
    };

    // --- Main App Render ---
    return (
        <div className="min-h-screen bg-gray-900 text-white font-sans flex items-center justify-center p-4 sm:p-8">
            
            {/* Custom styles: Removed external font import */}
            <style>{`
/* Inside App component, inside the <style> block */
@font-face {
    font-family: 'Chess Alpha';
    src: url('/fonts/ChessAlpha.woff2') format('woff2'),
         url('/fonts/ChessAlpha.woff') format('woff');
    font-weight: normal;
    font-style: normal;
}
/* Inside App component, inside the <style> block */
.piece-size {
    /* Use a value that looks good and is large enough, e.g., 4rem (64px) */
    font-size: 4rem; 
    /* Important for vertical centering */
    line-height: 1; 
}
            /* Apply the font specifically to the piece symbols */
             .chess-piece-symbol {
             font-family: 'Chess Alpha', 'Arial Unicode MS', sans-serif;
             line-height: 1; /* Helps unify vertical alignment */
            }
                /* Custom Scrollbar for Log */
                .custom-scrollbar::-webkit-scrollbar { width: 8px; }
                .custom-scrollbar::-webkit-scrollbar-thumb { background-color: #4b5563; border-radius: 4px; }
                .custom-scrollbar::-webkit-scrollbar-track { background-color: #1f2937; }

                /* Pulse animation for chosen move */
                @keyframes pulse-once {
                    0% { transform: scale(1); box-shadow: 0 0 0 0 rgba(22, 163, 74, 0.7); }
                    50% { transform: scale(1.01); box-shadow: 0 0 15px 5px rgba(22, 163, 74, 0); }
                    100% { transform: scale(1); }
                }
                .animate-pulse-once {
                    animation: pulse-once 1.5s ease-out;
                }
            `}</style>
            
            {/* Main container: Simplified to 2 columns on desktop */}
            <div className="max-w-6xl w-full bg-gray-800 rounded-3xl shadow-[0_0_50px_rgba(37,99,235,0.7)] p-6 lg:p-10 grid grid-cols-1 lg:grid-cols-2 gap-8">
                
                {/* --- Left Column: Board and Status (1st column on desktop) --- */}
                <div className="flex flex-col items-center space-y-6">
                    <div className="text-center w-full">
                        <h1 className="text-4xl font-black text-blue-400 tracking-tight">The Minimax Chess Lab</h1>
                        <p className="text-xl text-gray-300 mt-1">Strategic Foresight Simulator</p>
                    </div>
                    
                    {/* Chess Board */}
                    <ChessBoard 
                        board={board} 
                        selectedSquare={selectedSquare} 
                        handleSquareClick={handleSquareClick} 
                        highlightedMoves={highlightedMoves} 
                        lastBotMove={lastBotMove} // 3. IMPROVEMENT: Pass last bot move to board
                    />
                    
                    {/* Status Panel */}
                    <div className="w-full p-4 bg-gray-700 rounded-xl shadow-inner border-t-4 border-t-blue-500">
                        <p className={`text-lg font-semibold text-white flex items-center justify-center ${gameOver ? 'text-red-300' : ''}`}>
                            {isBotThinking ? (
                                <>
                                    <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-blue-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                    </svg>
                                    BOT CALCULATING...
                                </>
                            ) : (
                                message
                            )}
                        </p>
                        <p className="text-xs text-gray-400 mt-2 text-center">
                            The game is running in local, client-side mode (White: Human, Black: Minimax Bot).
                        </p>
                        <button
                            onClick={resetGame}
                            className="mt-4 w-full py-2 bg-red-600 hover:bg-red-700 text-white font-bold rounded-lg transition-colors shadow-md hover:shadow-xl disabled:opacity-50 flex items-center justify-center"
                            disabled={isBotThinking}
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-refresh-ccw mr-2"><path d="M20 12h-8"/><path d="M2.5 7.5c5-5 13-3 16 2"/><path d="M2.5 16.5c5 5 13 3 16-2"/><path d="m20 17 3-3-3-3"/></svg>
                            Start New Simulation
                        </button>
                    </div>
                </div>
                
                {/* --- Right Column: Analysis Unit (2nd column on desktop) --- */}
                <div className="flex flex-col space-y-8">
                    <BotAnalysisUnit board={board} analysis={analysis} minimaxLog={minimaxLog} MINIMAX_DEPTH={MINIMAX_DEPTH} lastBotMove={lastBotMove} />
                    
                    {/* Evaluation Function Box */}
                    <div className="p-6 bg-gray-700 rounded-xl shadow-lg border-2 border-yellow-600/50">
                        <h4 className="text-xl font-bold text-yellow-300 border-b pb-2 border-yellow-700">
                            Evaluation Function (Material Scorecard)
                        </h4>
                        <p className="mt-2 text-gray-300 text-sm">
                            The AI converts the board's state into a measurable score based purely on material advantage.
                        </p>
                        <ul className="mt-3 grid grid-cols-3 gap-2 text-gray-200">
                            {Object.entries(PIECE_VALUES).filter(([p]) => p === p.toUpperCase()).map(([piece, value]) => (
                                <li key={piece} className="flex flex-col items-center bg-gray-600/50 p-2 rounded-md font-mono text-sm shadow-inner">
                                    <span className="text-xl font-bold">{PIECE_SYMBOLS[piece]}</span>
                                    <span>{piece}: <span className="font-extrabold text-blue-300">{value}</span> pts</span>
                                </li>
                            ))}
                        </ul>
                    </div>
                </div>
                
            </div>
        </div>
    );
};

export default App;