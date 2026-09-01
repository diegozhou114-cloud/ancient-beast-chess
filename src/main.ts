import "./styles.css";
import { ArrowLeft, Check, ChevronRight, Copy, createIcons, House, LogIn, LogOut, Play, Plus, RefreshCw, RotateCcw, ScrollText, SlidersHorizontal, Swords, Volume2, VolumeX, Wifi, X } from "lucide";
import { AI_DIFFICULTIES, AI_DIFFICULTY_LABELS, chooseAiAction, type AiDifficulty } from "./ai";
import {
  COLS,
  RANKS,
  RANK_LABEL,
  RANK_VALUE,
  applyAction,
  countPieces,
  createGame,
  getLegalDestinations,
  type Action,
  type Camp,
  type GameState,
  type LayerMode,
  type Piece,
} from "./game";
import {
  OnlineConnection,
  clearOnlineSession,
  getOnlineLegalDestinations,
  isValidRoomCode,
  loadOnlineSession,
  normalizeRoomCode,
  normalizeServerAddress,
  onlineErrorMessage,
  saveOnlineSession,
  type ConnectionState,
  type PublicCell,
  type PublicGameState,
  type PublicPiece,
  type PublicSnapshot,
  type ServerMessage,
} from "./online";

const boardElement = element<HTMLDivElement>("board");
const roundCountElement = element<HTMLSpanElement>("round-count");
const turnBlockElement = element<HTMLDivElement>("turn-block");
const turnSealElement = element<HTMLDivElement>("turn-seal");
const turnLabelElement = element<HTMLParagraphElement>("turn-label");
const turnDetailElement = element<HTMLParagraphElement>("turn-detail");
const boardMessageElement = element<HTMLSpanElement>("board-message");
const redCountElement = element<HTMLElement>("red-count");
const blackCountElement = element<HTMLElement>("black-count");
const redFallenElement = element<HTMLDivElement>("red-fallen");
const blackFallenElement = element<HTMLDivElement>("black-fallen");
const moveLogElement = element<HTMLOListElement>("move-log");
const rankListElement = element<HTMLDivElement>("rank-list");
const resultBannerElement = element<HTMLDivElement>("result-banner");
const resultSealElement = element<HTMLDivElement>("result-seal");
const resultTitleElement = element<HTMLHeadingElement>("result-title");
const soundButton = element<HTMLButtonElement>("sound-button");
const rulesDrawer = element<HTMLElement>("rules-drawer");
const rulesBackdrop = element<HTMLDivElement>("rules-backdrop");
const homeView = element<HTMLElement>("home-view");
const setupView = element<HTMLElement>("setup-view");
const onlineView = element<HTMLElement>("online-view");
const gameView = element<HTMLElement>("game-view");
const matchModeLabelElement = element<HTMLElement>("match-mode-label");
const matchDetailPrefixElement = element<HTMLElement>("match-detail-prefix");
const matchDifficultyElement = element<HTMLElement>("match-difficulty");
const redControllerElement = element<HTMLSpanElement>("red-controller");
const blackControllerElement = element<HTMLSpanElement>("black-controller");
const setupDifficultyButtons = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-setup-difficulty]"));
const campButtons = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-player-camp]"));
const gameActionButtons = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-game-action]"));
const soloGameActionButtons = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-solo-game-action]"));
const onlineGameActionButtons = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-online-game-action]"));
const onlineStatusLine = element<HTMLElement>("online-status-line");
const onlineConnectionStatusElement = element<HTMLElement>("online-connection-status");
const onlineEntryElement = element<HTMLElement>("online-entry");
const onlineRoomElement = element<HTMLElement>("online-room");
const onlineServerInput = element<HTMLInputElement>("online-server-input");
const joinRoomCodeInput = element<HTMLInputElement>("join-room-code");
const onlineErrorElement = element<HTMLElement>("online-error");
const onlineRoomErrorElement = element<HTMLElement>("online-room-error");
const createRoomButton = element<HTMLButtonElement>("create-room-button");
const joinRoomButton = element<HTMLButtonElement>("join-room-button");
const resumeRoomButton = element<HTMLButtonElement>("resume-room-button");
const readyButton = element<HTMLButtonElement>("ready-button");
const onlineRoomCodeElement = element<HTMLElement>("online-room-code");
const onlinePlayerCampElement = element<HTMLElement>("online-player-camp");
const onlineRedSeatElement = element<HTMLElement>("online-red-seat");
const onlineBlackSeatElement = element<HTMLElement>("online-black-seat");
const resultModeLabelElement = element<HTMLElement>("result-mode-label");
const resultSecondaryLabelElement = element<HTMLElement>("result-secondary-label");
const resultPrimaryLabelElement = element<HTMLElement>("result-primary-label");

type View = "home" | "setup" | "online" | "game";
type MatchMode = "solo" | "online";
type DisplayGameState = GameState | PublicGameState;
type DisplayCell = GameState["board"][number] | PublicCell;
type DisplayPiece = Piece | PublicPiece;

let currentView: View = "home";
let matchMode: MatchMode = "solo";
let state = createGame();
let selectedIndex: number | null = null;
let aiThinking = false;
let soundEnabled = true;
let audioContext: AudioContext | null = null;
let aiTimer: number | null = null;
let aiDifficulty: AiDifficulty = "zhuyan";
let playerCamp: Camp = "red";
let pendingAiDifficulty: AiDifficulty = aiDifficulty;
let pendingPlayerCamp: Camp = playerCamp;
let onlineSession = loadOnlineSession(sessionStorage);
let onlineSnapshot: PublicSnapshot | null = null;
let onlineConnectionState: ConnectionState = "idle";
let onlineBusy = false;
let onlineActionPending = false;
let onlineReconnectTimer: number | null = null;
let onlineReconnectAttempt = 0;
let lastOnlineEndpoint = onlineSession?.endpoint ?? onlineServerInput.value;
const onlineConnection = new OnlineConnection({
  onMessage: handleOnlineMessage,
  onState: handleOnlineConnectionState,
});

renderRankList();
render();
renderSetup();
renderOnline();
renderView();
hydrateIcons();

boardElement.addEventListener("click", (event) => {
  const clicked = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-cell-index]");
  const game = getDisplayState();
  const onlineLocked = matchMode === "online" && (onlineConnectionState !== "connected" || onlineActionPending);
  if (!clicked || !game || currentView !== "game" || aiThinking || onlineLocked || game.status !== "playing" || game.turn !== playerCamp) return;
  handleBoardClick(Number(clicked.dataset.cellIndex));
});

element<HTMLButtonElement>("restart-button").addEventListener("click", restartGame);
element<HTMLButtonElement>("result-restart-button").addEventListener("click", () => {
  if (matchMode === "online") void createAnotherOnlineRoom();
  else restartGame();
});
element<HTMLButtonElement>("pve-mode-button").addEventListener("click", openSetup);
element<HTMLButtonElement>("online-mode-button").addEventListener("click", openOnline);
element<HTMLButtonElement>("setup-button").addEventListener("click", openSetup);
element<HTMLButtonElement>("result-setup-button").addEventListener("click", () => {
  if (matchMode === "online") openOnline();
  else openSetup();
});
element<HTMLButtonElement>("home-button").addEventListener("click", goHome);
element<HTMLButtonElement>("setup-home-button").addEventListener("click", goHome);
element<HTMLButtonElement>("result-home-button").addEventListener("click", goHome);
element<HTMLButtonElement>("start-game-button").addEventListener("click", startGame);
element<HTMLButtonElement>("online-home-button").addEventListener("click", goHome);
element<HTMLButtonElement>("online-resign-button").addEventListener("click", resignOnlineGame);
element<HTMLButtonElement>("leave-room-button").addEventListener("click", () => leaveOnlineRoom(false));
element<HTMLButtonElement>("copy-room-code-button").addEventListener("click", copyOnlineRoomCode);
createRoomButton.addEventListener("click", () => void beginOnlineRoom("create"));
joinRoomButton.addEventListener("click", () => void beginOnlineRoom("join"));
resumeRoomButton.addEventListener("click", () => void resumeOnlineRoom(false));
readyButton.addEventListener("click", toggleOnlineReady);
joinRoomCodeInput.addEventListener("input", () => {
  joinRoomCodeInput.value = normalizeRoomCode(joinRoomCodeInput.value);
});
joinRoomCodeInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") void beginOnlineRoom("join");
});
onlineServerInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") void beginOnlineRoom("create");
});
soundButton.addEventListener("click", toggleSound);
setupDifficultyButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const difficulty = button.dataset.setupDifficulty as AiDifficulty;
    if (!AI_DIFFICULTIES.includes(difficulty)) return;
    pendingAiDifficulty = difficulty;
    renderSetup();
  });
});
campButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const camp = button.dataset.playerCamp as Camp;
    if (camp !== "red" && camp !== "black") return;
    pendingPlayerCamp = camp;
    renderSetup();
  });
});
element<HTMLButtonElement>("rules-button").addEventListener("click", () => setRulesOpen(true));
element<HTMLButtonElement>("close-rules-button").addEventListener("click", () => setRulesOpen(false));
rulesBackdrop.addEventListener("click", () => setRulesOpen(false));
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    selectedIndex = null;
    setRulesOpen(false);
    if (currentView === "game") render();
  }
});

function handleBoardClick(index: number): void {
  const game = getDisplayState();
  if (!game) return;
  const cell = game.board[index];
  const piece = getDisplayActivePiece(cell);
  const canFlip = Boolean(cell.base && !cell.base.revealed && !cell.guest);

  if (selectedIndex !== null) {
    if (selectedIndex === index) {
      selectedIndex = null;
      render();
      return;
    }
    if (getDisplayLegalDestinations(game, selectedIndex).includes(index)) {
      performAction({ type: "move", from: selectedIndex, to: index });
      return;
    }
  }

  if (piece?.camp === playerCamp) {
    selectedIndex = index;
    render();
    playTone("select");
    return;
  }
  if (canFlip) {
    performAction({ type: "flip", at: index });
  }
}

function performAction(action: Action): void {
  if (matchMode === "online") {
    if (!onlineSnapshot?.game || onlineConnectionState !== "connected" || onlineActionPending) return;
    onlineActionPending = true;
    selectedIndex = null;
    if (!onlineConnection.send({ type: "action", version: onlineSnapshot.version, action })) {
      onlineActionPending = false;
      showOnlineError("连接已经断开");
    }
    render();
    return;
  }

  const previous = state;
  state = applyAction(state, action);
  if (state === previous) return;
  selectedIndex = null;
  playTone(action.type === "flip" ? "flip" : "move");
  render();
  scheduleAiTurn();
}

function scheduleAiTurn(): void {
  const computerCamp = getAiCamp();
  if (currentView !== "game" || state.status !== "playing" || state.turn !== computerCamp) return;
  aiThinking = true;
  render();
  aiTimer = window.setTimeout(() => {
    const action = chooseAiAction(state, aiDifficulty, Math.random, computerCamp);
    if (action) {
      state = applyAction(state, action);
      playTone(action.type === "flip" ? "flip" : "move");
    }
    aiThinking = false;
    aiTimer = null;
    render();
    scheduleAiTurn();
  }, 620);
}

function restartGame(): void {
  stopAiTurn();
  state = createGame();
  selectedIndex = null;
  render();
  playTone("restart");
  scheduleAiTurn();
}

function startGame(): void {
  matchMode = "solo";
  aiDifficulty = pendingAiDifficulty;
  playerCamp = pendingPlayerCamp;
  currentView = "game";
  state = createGame();
  selectedIndex = null;
  stopAiTurn();
  setRulesOpen(false);
  renderView();
  render();
  playTone("restart");
  scheduleAiTurn();
}

function openSetup(): void {
  if (matchMode === "online") stopOnlineConnection(true);
  matchMode = "solo";
  stopAiTurn();
  pendingAiDifficulty = aiDifficulty;
  pendingPlayerCamp = playerCamp;
  currentView = "setup";
  selectedIndex = null;
  setRulesOpen(false);
  renderSetup();
  renderView();
}

function goHome(): void {
  stopAiTurn();
  if (matchMode === "online") {
    if (onlineSnapshot?.phase === "playing") {
      onlineConnection.send({ type: "resign" });
      clearStoredOnlineSession();
    } else if (onlineSnapshot?.phase === "waiting") {
      onlineConnection.send({ type: "leave_room" });
      clearStoredOnlineSession();
    }
    window.setTimeout(() => onlineConnection.close(), 80);
    stopOnlineReconnect();
    onlineSnapshot = null;
    onlineActionPending = false;
  }
  currentView = "home";
  selectedIndex = null;
  setRulesOpen(false);
  renderView();
}

function openOnline(): void {
  stopAiTurn();
  if (matchMode === "online" && onlineSnapshot?.phase === "ended") onlineConnection.close();
  matchMode = "online";
  currentView = "online";
  selectedIndex = null;
  setRulesOpen(false);
  onlineSnapshot = null;
  onlineActionPending = false;
  onlineSession = loadOnlineSession(sessionStorage);
  if (onlineSession) onlineServerInput.value = onlineSession.endpoint;
  renderOnline();
  renderView();
}

function stopAiTurn(): void {
  if (aiTimer !== null) window.clearTimeout(aiTimer);
  aiTimer = null;
  aiThinking = false;
}

function render(): void {
  const game = getDisplayState();
  if (!game) return;
  const destinations = selectedIndex === null ? [] : getDisplayLegalDestinations(game, selectedIndex);
  const onlineLocked = matchMode === "online" && (onlineConnectionState !== "connected" || onlineActionPending);
  const boardDisabled = game.status !== "playing" || game.turn !== playerCamp || aiThinking || onlineLocked;
  boardElement.innerHTML = game.board
    .map((cell, index) => renderCell(game, cell, index, destinations, boardDisabled))
    .join("");

  const opponentCamp = playerCamp === "red" ? "black" : "red";
  const opponentName = matchMode === "online" ? "对手" : "人机";
  const isRedTurn = game.turn === "red";
  const isPlayerTurn = game.turn === playerCamp;
  const reconnecting = matchMode === "online" && onlineConnectionState !== "connected";
  const statusText = game.status === "won"
    ? game.winner === playerCamp ? "你已获胜" : `${opponentName}获胜`
    : game.status === "draw" ? "和局"
    : reconnecting ? "正在重连"
    : isPlayerTurn ? "你的回合" : `${opponentName}回合`;
  turnBlockElement.classList.toggle("turn-block--thinking", aiThinking || reconnecting || onlineActionPending);
  turnSealElement.className = `turn-seal turn-seal--${isRedTurn ? "red" : "black"}`;
  turnSealElement.textContent = isRedTurn ? "朱" : "墨";
  turnLabelElement.textContent = statusText;
  turnDetailElement.textContent = game.status !== "playing"
    ? "本局已定"
    : reconnecting ? "正在恢复席位"
    : onlineActionPending ? "等待服务器确认"
    : aiThinking ? "正在推演"
    : isPlayerTurn ? selectedIndex === null ? "翻子或行子" : "择一亮格落子"
    : `${campLabel(opponentCamp)}方行棋`;
  roundCountElement.textContent = `第 ${game.moveNumber} 手`;
  boardMessageElement.textContent = game.status !== "playing"
    ? statusText
    : reconnecting ? "连接中断，棋盘已锁定"
    : onlineActionPending ? "等待服务器确认"
    : aiThinking ? `${campLabel(opponentCamp)}方推演中`
    : isPlayerTurn ? selectedIndex === null ? "翻子或行子" : "落子处已标亮"
    : `${campLabel(opponentCamp)}方行棋`;
  redCountElement.textContent = String(countDisplayPieces(game, "red"));
  blackCountElement.textContent = String(countDisplayPieces(game, "black"));
  matchModeLabelElement.textContent = matchMode === "online" ? "联机对战" : "人机大战";
  matchDetailPrefixElement.childNodes[0].textContent = matchMode === "online" ? "房间 " : "难度 ";
  matchDifficultyElement.textContent = matchMode === "online" ? onlineSession?.roomCode ?? "------" : AI_DIFFICULTY_LABELS[aiDifficulty];
  redControllerElement.textContent = matchMode === "online"
    ? playerCamp === "red" ? "真人（你）" : onlineSnapshot?.seats.red.connected ? "真人（对手）" : "真人（对手重连中）"
    : playerCamp === "red" ? "真人（你）" : `人机（${AI_DIFFICULTY_LABELS[aiDifficulty]}）`;
  blackControllerElement.textContent = matchMode === "online"
    ? playerCamp === "black" ? "真人（你）" : onlineSnapshot?.seats.black.connected ? "真人（对手）" : "真人（对手重连中）"
    : playerCamp === "black" ? "真人（你）" : `人机（${AI_DIFFICULTY_LABELS[aiDifficulty]}）`;
  redFallenElement.innerHTML = renderFallen(game, "red");
  blackFallenElement.innerHTML = renderFallen(game, "black");
  moveLogElement.innerHTML = game.log.map((entry) => `<li>${escapeHtml(entry)}</li>`).join("");

  resultBannerElement.hidden = currentView !== "game" || game.status === "playing";
  resultModeLabelElement.textContent = matchMode === "online" ? "联机对局已定" : "本局已定";
  resultSecondaryLabelElement.textContent = matchMode === "online" ? "返回联机" : "选择难度";
  resultPrimaryLabelElement.textContent = matchMode === "online" ? "再开一房" : "再来一局";
  if (game.status === "won") {
    const playerWon = game.winner === playerCamp;
    resultSealElement.textContent = playerWon ? "胜" : "负";
    resultTitleElement.textContent = playerWon ? "你已获胜" : `${opponentName}获胜`;
  } else if (game.status === "draw") {
    resultSealElement.textContent = "和";
    resultTitleElement.textContent = "势均力敌";
  }
}

function renderSetup(): void {
  setupDifficultyButtons.forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.setupDifficulty === pendingAiDifficulty));
  });
  campButtons.forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.playerCamp === pendingPlayerCamp));
  });
}

function renderOnline(): void {
  const waiting = onlineSnapshot?.phase === "waiting" && Boolean(onlineSession);
  onlineEntryElement.hidden = waiting;
  onlineRoomElement.hidden = !waiting;
  onlineServerInput.disabled = onlineBusy;
  joinRoomCodeInput.disabled = onlineBusy;
  createRoomButton.disabled = onlineBusy;
  joinRoomButton.disabled = onlineBusy;
  resumeRoomButton.hidden = !onlineSession || Boolean(onlineSnapshot);
  resumeRoomButton.disabled = onlineBusy;

  const connectionLabel = onlineConnectionState === "connecting"
    ? onlineReconnectAttempt > 0 ? "正在重连" : "正在连接"
    : onlineConnectionState === "connected"
      ? waiting
        ? onlineSnapshot?.seats.red.occupied && onlineSnapshot.seats.black.occupied ? "等待双方准备" : "等待对手加入"
        : "已连接"
      : onlineSession && !onlineSnapshot ? "可以恢复上次房间" : "未连接";
  onlineConnectionStatusElement.textContent = connectionLabel;
  onlineStatusLine.dataset.state = onlineConnectionState === "connected" ? "connected" : onlineConnectionState === "connecting" ? "connecting" : "idle";

  if (!waiting || !onlineSession || !onlineSnapshot) return;
  onlineRoomCodeElement.textContent = onlineSession.roomCode;
  onlinePlayerCampElement.textContent = `${campLabel(onlineSession.seat)}方`;
  onlineRedSeatElement.textContent = seatStatus(onlineSnapshot.seats.red, onlineSession.seat === "red");
  onlineBlackSeatElement.textContent = seatStatus(onlineSnapshot.seats.black, onlineSession.seat === "black");
  onlineRedSeatElement.parentElement?.setAttribute("data-self", String(onlineSession.seat === "red"));
  onlineBlackSeatElement.parentElement?.setAttribute("data-self", String(onlineSession.seat === "black"));
  const selfReady = onlineSnapshot.seats[onlineSession.seat].ready;
  readyButton.querySelector("span")!.textContent = selfReady ? "取消准备" : "准备";
  readyButton.disabled = onlineBusy || onlineConnectionState !== "connected";
}

function renderView(): void {
  homeView.hidden = currentView !== "home";
  setupView.hidden = currentView !== "setup";
  onlineView.hidden = currentView !== "online";
  gameView.hidden = currentView !== "game";
  gameActionButtons.forEach((button) => {
    button.hidden = currentView !== "game";
  });
  soloGameActionButtons.forEach((button) => {
    button.hidden = currentView !== "game" || matchMode !== "solo";
  });
  onlineGameActionButtons.forEach((button) => {
    button.hidden = currentView !== "game" || matchMode !== "online";
  });
  if (currentView !== "game") resultBannerElement.hidden = true;
}

async function beginOnlineRoom(kind: "create" | "join"): Promise<void> {
  if (onlineBusy) return;
  let endpoint: string;
  try {
    endpoint = normalizeServerAddress(onlineServerInput.value);
  } catch {
    showOnlineError("请检查服务器地址");
    return;
  }
  const roomCode = normalizeRoomCode(joinRoomCodeInput.value);
  if (kind === "join" && !isValidRoomCode(roomCode)) {
    showOnlineError("请输入六位房间码");
    return;
  }

  clearStoredOnlineSession();
  onlineSnapshot = null;
  lastOnlineEndpoint = endpoint;
  onlineServerInput.value = endpoint;
  clearOnlineErrors();
  onlineBusy = true;
  renderOnline();
  try {
    await onlineConnection.connect(endpoint);
    const sent = kind === "create"
      ? onlineConnection.send({ type: "create_room" })
      : onlineConnection.send({ type: "join_room", roomCode });
    if (!sent) throw new Error("CONNECTION_CLOSED");
  } catch {
    onlineBusy = false;
    showOnlineError("无法连接服务器，请检查地址和服务器状态");
    renderOnline();
  }
}

async function resumeOnlineRoom(automatic: boolean): Promise<void> {
  const session = onlineSession ?? loadOnlineSession(sessionStorage);
  if (!session || onlineBusy) return;
  onlineSession = session;
  lastOnlineEndpoint = session.endpoint;
  onlineBusy = true;
  clearOnlineErrors();
  renderOnline();
  try {
    await onlineConnection.connect(session.endpoint);
    if (!onlineConnection.send({ type: "resume", roomCode: session.roomCode, reconnectToken: session.reconnectToken })) {
      throw new Error("CONNECTION_CLOSED");
    }
  } catch {
    onlineBusy = false;
    if (automatic) scheduleOnlineReconnect();
    else showOnlineError("恢复失败，请检查服务器状态");
    renderOnline();
  }
}

function handleOnlineMessage(message: ServerMessage): void {
  if (message.type === "welcome") return;
  if (message.type === "error") {
    onlineBusy = false;
    onlineActionPending = false;
    const errorText = onlineErrorMessage(message.code);
    if (message.code === "INVALID_RECONNECT_TOKEN") {
      clearStoredOnlineSession();
      onlineSnapshot = null;
      currentView = "online";
    }
    showOnlineError(errorText, Boolean(onlineSnapshot));
    renderOnline();
    if (currentView === "game") render();
    return;
  }
  if (message.type === "room_closed") {
    onlineBusy = false;
    onlineActionPending = false;
    clearStoredOnlineSession();
    onlineSnapshot = null;
    currentView = "online";
    showOnlineError("房间已经关闭");
    renderOnline();
    renderView();
    return;
  }
  if (message.type === "room_joined") {
    onlineBusy = false;
    onlineReconnectAttempt = 0;
    stopOnlineReconnect();
    onlineSession = {
      endpoint: lastOnlineEndpoint,
      roomCode: message.roomCode,
      reconnectToken: message.reconnectToken,
      seat: message.seat,
    };
    playerCamp = message.seat;
    saveOnlineSession(sessionStorage, onlineSession);
    applyOnlineSnapshot(message.snapshot);
    return;
  }
  applyOnlineSnapshot(message.snapshot);
}

function applyOnlineSnapshot(snapshot: PublicSnapshot): void {
  onlineSnapshot = snapshot;
  onlineBusy = false;
  onlineActionPending = false;
  clearOnlineErrors();
  if (snapshot.phase === "playing" || snapshot.phase === "ended") {
    matchMode = "online";
    currentView = "game";
    if (snapshot.phase === "ended") clearOnlineSession(sessionStorage);
    renderView();
    render();
  } else {
    currentView = "online";
    renderOnline();
    renderView();
  }
}

function handleOnlineConnectionState(connectionState: ConnectionState, intentional: boolean): void {
  onlineConnectionState = connectionState;
  if (connectionState === "closed") onlineBusy = false;
  if (connectionState === "closed" && !intentional && onlineSession && onlineSnapshot?.phase !== "ended") {
    scheduleOnlineReconnect();
  }
  renderOnline();
  if (currentView === "game" && matchMode === "online") render();
}

function scheduleOnlineReconnect(): void {
  if (!onlineSession || onlineReconnectTimer !== null || onlineSnapshot?.phase === "ended") return;
  onlineReconnectAttempt += 1;
  const delay = Math.min(5_000, onlineReconnectAttempt * 1_000);
  onlineReconnectTimer = window.setTimeout(() => {
    onlineReconnectTimer = null;
    void resumeOnlineRoom(true);
  }, delay);
  onlineConnectionState = "connecting";
  renderOnline();
  if (currentView === "game") render();
}

function stopOnlineReconnect(): void {
  if (onlineReconnectTimer !== null) window.clearTimeout(onlineReconnectTimer);
  onlineReconnectTimer = null;
}

function toggleOnlineReady(): void {
  if (!onlineSession || !onlineSnapshot || onlineSnapshot.phase !== "waiting") return;
  const ready = !onlineSnapshot.seats[onlineSession.seat].ready;
  if (onlineConnection.send({ type: "ready", ready })) {
    onlineBusy = true;
    renderOnline();
  }
}

function resignOnlineGame(): void {
  if (onlineSnapshot?.phase !== "playing" || onlineConnectionState !== "connected" || onlineActionPending) return;
  onlineActionPending = onlineConnection.send({ type: "resign" });
  render();
}

function leaveOnlineRoom(goToHome: boolean): void {
  if (onlineSnapshot?.phase === "waiting") onlineConnection.send({ type: "leave_room" });
  else if (onlineSnapshot?.phase === "playing") onlineConnection.send({ type: "resign" });
  clearStoredOnlineSession();
  onlineSnapshot = null;
  onlineActionPending = false;
  stopOnlineReconnect();
  currentView = goToHome ? "home" : "online";
  window.setTimeout(() => onlineConnection.close(), 80);
  renderOnline();
  renderView();
}

async function createAnotherOnlineRoom(): Promise<void> {
  const endpoint = onlineSession?.endpoint ?? lastOnlineEndpoint;
  stopOnlineConnection(true);
  onlineServerInput.value = endpoint;
  currentView = "online";
  renderOnline();
  renderView();
  await beginOnlineRoom("create");
}

function stopOnlineConnection(clearSession: boolean): void {
  stopOnlineReconnect();
  onlineConnection.close();
  onlineSnapshot = null;
  onlineActionPending = false;
  onlineBusy = false;
  if (clearSession) clearStoredOnlineSession();
}

function clearStoredOnlineSession(): void {
  clearOnlineSession(sessionStorage);
  onlineSession = null;
}

function copyOnlineRoomCode(): void {
  const roomCode = onlineSession?.roomCode;
  if (!roomCode) return;
  if (!navigator.clipboard) {
    onlineConnectionStatusElement.textContent = "请手动复制房间码";
    return;
  }
  void navigator.clipboard.writeText(roomCode).then(() => {
    onlineConnectionStatusElement.textContent = "房间码已复制";
  }).catch(() => {
    onlineConnectionStatusElement.textContent = "请手动复制房间码";
  });
}

function showOnlineError(message: string, inRoom = false): void {
  const target = inRoom ? onlineRoomErrorElement : onlineErrorElement;
  target.textContent = message;
  target.hidden = false;
}

function clearOnlineErrors(): void {
  onlineErrorElement.hidden = true;
  onlineRoomErrorElement.hidden = true;
  onlineErrorElement.textContent = "";
  onlineRoomErrorElement.textContent = "";
}

function seatStatus(seat: PublicSnapshot["seats"][Camp], self: boolean): string {
  if (!seat.occupied) return "等待加入";
  if (!seat.connected) return self ? "你已断线" : "对手重连中";
  if (seat.ready) return self ? "已准备（你）" : "已准备";
  return self ? "未准备（你）" : "未准备";
}

function getAiCamp(): Camp {
  return playerCamp === "red" ? "black" : "red";
}

function getDisplayState(): DisplayGameState | null {
  return matchMode === "online" ? onlineSnapshot?.game ?? null : state;
}

function getDisplayActivePiece(cell: DisplayCell): DisplayPiece | null {
  if (cell.guest) return cell.guest;
  return cell.base?.revealed ? cell.base : null;
}

function getDisplayLegalDestinations(game: DisplayGameState, from: number): number[] {
  return matchMode === "online"
    ? getOnlineLegalDestinations(game as PublicGameState, from)
    : getLegalDestinations(game as GameState, from);
}

function countDisplayPieces(game: DisplayGameState, camp: Camp): number {
  return matchMode === "online" ? 10 - game.fallen[camp].length : countPieces(game as GameState, camp);
}

function campLabel(camp: Camp): string {
  return camp === "red" ? "朱" : "墨";
}

function renderCell(game: DisplayGameState, cell: DisplayCell, index: number, destinations: number[], disabled: boolean): string {
  const activePiece = getDisplayActivePiece(cell);
  const isSelected = selectedIndex === index;
  const isLegalTarget = destinations.includes(index);
  const isLastFrom = game.lastAction?.type === "move" && game.lastAction.from === index;
  const isLastTo = (game.lastAction?.type === "move" && game.lastAction.to === index) || (game.lastAction?.type === "flip" && game.lastAction.at === index);
  const cellClass = [
    "board-cell",
    isSelected ? "board-cell--selected" : "",
    isLegalTarget ? "board-cell--legal" : "",
    cell.guest ? "board-cell--locked" : "",
    isLastFrom ? "board-cell--from" : "",
    isLastTo ? "board-cell--to" : "",
  ].filter(Boolean).join(" ");
  const label = cellLabel(cell, index);

  return `<button class="${cellClass}" type="button" role="gridcell" aria-label="${label}" aria-selected="${isSelected}" data-cell-index="${index}"${disabled ? " disabled" : ""}>
    <span class="cell-coordinate" aria-hidden="true">${String.fromCharCode(65 + (index % COLS))}${Math.floor(index / COLS) + 1}</span>
    ${renderCellContents(cell, activePiece)}
    ${isLegalTarget ? '<span class="legal-dot" aria-hidden="true"></span>' : ""}
  </button>`;
}

function renderCellContents(cell: DisplayCell, activePiece: DisplayPiece | null): string {
  if (cell.base && !cell.base.revealed) {
    const below = cell.guestMode === "below" ? renderGuest(cell.guest!, "below") : "";
    const above = cell.guestMode === "above" ? renderGuest(cell.guest!, "above") : "";
    return `${below}<span class="piece-back" aria-hidden="true"><span>兽</span></span>${above}${cell.guest ? '<span class="lock-stamp" aria-hidden="true">锁</span>' : ""}`;
  }
  if (activePiece) return renderPiece(activePiece, "piece--base");
  return '<span class="empty-mark" aria-hidden="true"></span>';
}

function renderPiece(piece: DisplayPiece, modifier: string): string {
  const level = RANK_VALUE[piece.rank];
  return `<span class="piece ${modifier} piece--${piece.camp}" aria-hidden="true"><b>${RANK_LABEL[piece.rank]}</b><small>${level}</small></span>`;
}

function renderGuest(piece: DisplayPiece, mode: LayerMode): string {
  return `<span class="guest-piece guest-piece--${mode} piece--${piece.camp}" aria-hidden="true"><b>${RANK_LABEL[piece.rank]}</b><small>${mode === "above" ? "墙" : "洞"}</small></span>`;
}

function renderFallen(game: DisplayGameState, camp: Camp): string {
  const pieces = game.fallen[camp];
  return pieces.length === 0
    ? '<span class="fallen-empty">无</span>'
    : pieces.map((piece) => `<span class="fallen-piece piece--${piece.camp}" title="${RANK_LABEL[piece.rank]}">${RANK_LABEL[piece.rank]}</span>`).join("");
}

function renderRankList(): void {
  rankListElement.innerHTML = RANKS.map((rank, index) => `<span title="${RANK_LABEL[rank]}">${RANK_LABEL[rank]}<small>${index + 1}</small></span>`).join("");
}

function cellLabel(cell: DisplayCell, index: number): string {
  const coordinate = `${String.fromCharCode(65 + (index % COLS))}${Math.floor(index / COLS) + 1}`;
  if (cell.base && !cell.base.revealed) {
    if (cell.guest) return `${coordinate}，${cell.guest.camp === "red" ? "朱" : "墨"}${RANK_LABEL[cell.guest.rank]}${cell.guestMode === "above" ? "上墙" : "钻洞"}，暗子锁定`;
    return `${coordinate}，未翻暗子`;
  }
  if (cell.base) return `${coordinate}，${cell.base.camp === "red" ? "朱" : "墨"}${RANK_LABEL[cell.base.rank]}`;
  return `${coordinate}，空位`;
}

function toggleSound(): void {
  soundEnabled = !soundEnabled;
  soundButton.title = soundEnabled ? "关闭音效" : "开启音效";
  soundButton.setAttribute("aria-label", soundButton.title);
  soundButton.innerHTML = `<i data-lucide="${soundEnabled ? "volume-2" : "volume-x"}" aria-hidden="true"></i>`;
  hydrateIcons();
  if (soundEnabled) playTone("select");
}

function setRulesOpen(open: boolean): void {
  rulesDrawer.classList.toggle("rules-drawer--open", open);
  rulesDrawer.setAttribute("aria-hidden", String(!open));
  rulesBackdrop.hidden = !open;
}

function hydrateIcons(): void {
  createIcons({ icons: { ArrowLeft, Check, ChevronRight, Copy, House, LogIn, LogOut, Play, Plus, RefreshCw, RotateCcw, ScrollText, SlidersHorizontal, Swords, Volume2, VolumeX, Wifi, X } });
}

function playTone(kind: "select" | "flip" | "move" | "restart"): void {
  if (!soundEnabled) return;
  try {
    audioContext ??= new AudioContext();
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    const now = audioContext.currentTime;
    const frequency = { select: 392, flip: 523, move: 330, restart: 262 }[kind];
    oscillator.type = kind === "flip" ? "triangle" : "sine";
    oscillator.frequency.setValueAtTime(frequency, now);
    oscillator.frequency.exponentialRampToValueAtTime(frequency * 1.18, now + 0.08);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.08, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);
    oscillator.connect(gain).connect(audioContext.destination);
    oscillator.start(now);
    oscillator.stop(now + 0.17);
  } catch {
    soundEnabled = false;
  }
}

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing #${id}`);
  return found as T;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]!);
}
