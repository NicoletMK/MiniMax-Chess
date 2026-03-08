import { initializeApp } from "firebase/app";
import { getFirestore, collection, addDoc, doc, updateDoc, serverTimestamp } from "firebase/firestore";

const firebaseConfig = {
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId:             import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId:     import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);

const sub = (sid, name) => collection(db, "sessions", sid, name);
const sessionRef = (sid) => doc(db, "sessions", sid);
const log = (p) => p.catch(e => console.warn("[Firebase]", e));

// ─── SESSION ────────────────────────────────────────────────────────────────
export async function createSession(profile) {
  const ref = await addDoc(collection(db, "sessions"), {
    createdAt: serverTimestamp(),
    profile,
    appVersion: "1.0",
  });
  return ref.id;
}

// ─── LEARN PAGE ─────────────────────────────────────────────────────────────
export function saveLearnPage(sessionId, data) {
  return log(updateDoc(sessionRef(sessionId), { learn: { ...data, completedAt: serverTimestamp() } }));
}

export function logPieceView(sessionId, pieceName, dwellMs) {
  return log(addDoc(sub(sessionId, "events"), {
    category: "learn", action: "piece_view",
    piece: pieceName, dwellMs,
    recordedAt: serverTimestamp(),
  }));
}

export function logPracticeBoardOpen(sessionId, source) {
  return log(addDoc(sub(sessionId, "events"), {
    category: "learn", action: "practice_board_open",
    source,
    recordedAt: serverTimestamp(),
  }));
}

// ─── MINIMAX TUTORIAL ───────────────────────────────────────────────────────
export function logMinimaxStep(sessionId, data) {
  return log(addDoc(sub(sessionId, "events"), {
    category: "tutorial", action: "step_view",
    ...data,
    recordedAt: serverTimestamp(),
  }));
}

export function logTreeTutorialStep(sessionId, stepIndex, dismissed) {
  return log(addDoc(sub(sessionId, "events"), {
    category: "tutorial",
    action: dismissed ? "tree_tutorial_dismissed" : "tree_tutorial_next",
    stepIndex,
    recordedAt: serverTimestamp(),
  }));
}

// ─── GAME ────────────────────────────────────────────────────────────────────
export function saveGame(sessionId, game) {
  return log(addDoc(sub(sessionId, "games"), {
    ...game,
    recordedAt: serverTimestamp(),
  }));
}

export function logPlayerMove(sessionId, data) {
  return log(addDoc(sub(sessionId, "events"), {
    category: "game", action: "player_move",
    ...data,
    recordedAt: serverTimestamp(),
  }));
}

export function logBotMove(sessionId, data) {
  return log(addDoc(sub(sessionId, "events"), {
    category: "game", action: "bot_move",
    ...data,
    recordedAt: serverTimestamp(),
  }));
}

export function logWhyBotClick(sessionId, data) {
  return log(addDoc(sub(sessionId, "events"), {
    category: "game", action: "why_bot_clicked",
    ...data,
    recordedAt: serverTimestamp(),
  }));
}

export function logDepthChange(sessionId, fromDepth, toDepth) {
  return log(addDoc(sub(sessionId, "events"), {
    category: "game", action: "depth_changed",
    fromDepth, toDepth,
    recordedAt: serverTimestamp(),
  }));
}

export function logDepthUnlocked(sessionId, newDepth) {
  return log(addDoc(sub(sessionId, "events"), {
    category: "game", action: "depth_unlocked",
    newDepth,
    recordedAt: serverTimestamp(),
  }));
}

export function logNextDepthAccepted(sessionId, newDepth) {
  return log(addDoc(sub(sessionId, "events"), {
    category: "game", action: "next_depth_accepted",
    newDepth,
    recordedAt: serverTimestamp(),
  }));
}

// ─── TREE INTERACTIONS ───────────────────────────────────────────────────────
export function logTreeExpand(sessionId, data) {
  return log(addDoc(sub(sessionId, "events"), {
    category: "tree", action: "node_expanded",
    ...data,
    recordedAt: serverTimestamp(),
  }));
}

export function logTreeHover(sessionId, nodeLabel) {
  return log(addDoc(sub(sessionId, "events"), {
    category: "tree", action: "node_hovered",
    nodeLabel,
    recordedAt: serverTimestamp(),
  }));
}

export function logReflection(sessionId, data) {
  return log(addDoc(sub(sessionId, "reflections"), {
    ...data,
    recordedAt: serverTimestamp(),
  }));
}


export function saveSessionEnd(sessionId, data) {
  return log(updateDoc(sessionRef(sessionId), {
    endedAt: serverTimestamp(),
    summary: data,
  }));
}


export function saveKnowsChess(sessionId, knowsChess) {
  return log(updateDoc(sessionRef(sessionId), { knowsChess, knowsChessRecordedAt: serverTimestamp() }));
}
