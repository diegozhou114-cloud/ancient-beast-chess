import "./styles.css";
import { ArrowLeft, Check, ChevronRight, Copy, createIcons, House, LogIn, LogOut, Network, Play, Plus, RefreshCw, RotateCcw, ScrollText, SlidersHorizontal, Swords, Volume2, VolumeX, Wifi, X } from "lucide";
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
  CLIENT_VERSION,
  OnlineConnection,
  OnlineCompatibilityError,
  clearOnlineSession,
  getOnlineLegalDestinations,
  isValidRoomCode,
  loadOnlineSession,
  normalizeRoomCode,
  normalizeServerAddress,
  onlineErrorMessage,
  saveOnlineSession,
  type ConnectionState,
  type OnlineNetworkMode,
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
const onlineKickerElement = element<HTMLElement>("online-kicker");
const onlineTitleElement = element<HTMLHeadingElement>("online-title");
const onlineEntryElement = element<HTMLElement>("online-entry");
const onlineRoomElement = element<HTMLElement>("online-room");
const lanModeButton = element<HTMLButtonElement>("lan-mode-button");
const lanEntryPanel = element<HTMLElement>("lan-entry-panel");
const remoteEntryPanel = element<HTMLElement>("remote-entry-panel");
const lanRoomListElement = element<HTMLElement>("lan-room-list");
const onlineServerInput = element<HTMLInputElement>("online-server-input");
const joinRoomCodeInput = element<HTMLInputElement>("join-room-code");
const remoteRoomCodeInput = element<HTMLInputElement>("remote-room-code");
const onlineErrorElement = element<HTMLElement>("online-error");
const onlineRoomErrorElement = element<HTMLElement>("online-room-error");
const createRoomButton = element<HTMLButtonElement>("create-room-button");
const joinRoomButton = element<HTMLButtonElement>("join-room-button");
const remoteCreateRoomButton = element<HTMLButtonElement>("remote-create-room-button");
const remoteJoinRoomButton = element<HTMLButtonElement>("remote-join-room-button");
const resumeRoomButton = element<HTMLButtonElement>("resume-room-button");
const readyButton = element<HTMLButtonElement>("ready-button");
const onlineRoomCodeElement = element<HTMLElement>("online-room-code");
const onlinePlayerCampElement = element<HTMLElement>("online-player-camp");
const onlineRedSeatElement = element<HTMLElement>("online-red-seat");
const onlineBlackSeatElement = element<HTMLElement>("online-black-seat");
const joinPendingPanel = element<HTMLElement>("join-pending-panel");
const joinPendingRoomCodeElement = element<HTMLElement>("join-pending-room-code");
const joinRequestPanel = element<HTMLElement>("join-request-panel");
const acceptJoinButton = element<HTMLButtonElement>("accept-join-button");
const rejectJoinButton = element<HTMLButtonElement>("reject-join-button");
const cancelJoinButton = element<HTMLButtonElement>("cancel-join-button");
const resultModeLabelElement = element<HTMLElement>("result-mode-label");
const resultSecondaryLabelElement = element<HTMLElement>("result-secondary-label");
const resultPrimaryLabelElement = element<HTMLElement>("result-primary-label");
const clientVersionElement = element<HTMLElement>("client-version");

type View = "home" | "setup" | "online" | "game";
type MatchMode = "solo" | "online";
type JoinRejectReason = Extract<ServerMessage, { type: "join_rejected" }>["reason"];
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
const lanApi = window.ancientBeastDesktop?.lan;
const lanSupported = lanApi?.supported === true;
let onlineNetworkMode: OnlineNetworkMode = onlineSession?.networkMode === "lan" && lanSupported ? "lan" : "remote";
let lanRooms: LanRoom[] = [];
let lanNetworks: LanNetwork[] = [];
let lanNetworksLoaded = false;
let hostingLan = false;
let pendingJoinRoomCode: string | null = null;
let pendingJoinRequestId: string | null = null;
const onlineConnection = new OnlineConnection({
  onMessage: handleOnlineMessage,
  onState: handleOnlineConnectionState,
});
lanApi?.onRoomsChanged((rooms) => {
  lanRooms = rooms;
  if (currentView === "online") renderOnline();
});
lanModeButton.hidden = !lanSupported;
clientVersionElement.textContent = `v${CLIENT_VERSION}`;

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
lanModeButton.addEventListener("click", () => void openOnline("lan"));
element<HTMLButtonElement>("remote-mode-button").addEventListener("click", () => void openOnline("remote"));
element<HTMLButtonElement>("setup-button").addEventListener("click", openSetup);
element<HTMLButtonElement>("result-setup-button").addEventListener("click", () => {
  if (matchMode === "online") void openOnline(onlineNetworkMode);
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
createRoomButton.addEventListener("click", () => void beginLanHost());
joinRoomButton.addEventListener("click", () => void joinLanRoom(joinRoomCodeInput.value));
remoteCreateRoomButton.addEventListener("click", () => void beginRemoteRoom("create"));
remoteJoinRoomButton.addEventListener("click", () => void beginRemoteRoom("join"));
resumeRoomButton.addEventListener("click", () => void resumeOnlineRoom(false));
readyButton.addEventListener("click", toggleOnlineReady);
acceptJoinButton.addEventListener("click", () => respondToJoinRequest(true));
rejectJoinButton.addEventListener("click", () => respondToJoinRequest(false));
cancelJoinButton.addEventListener("click", cancelPendingJoin);
lanRoomListElement.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-lan-room-code]");
  if (button?.dataset.lanRoomCode) void joinLanRoom(button.dataset.lanRoomCode);
});
joinRoomCodeInput.addEventListener("input", () => {
  joinRoomCodeInput.value = normalizeRoomCode(joinRoomCodeInput.value);
});
joinRoomCodeInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") void joinLanRoom(joinRoomCodeInput.value);
});
remoteRoomCodeInput.addEventListener("input", () => {
  remoteRoomCodeInput.value = normalizeRoomCode(remoteRoomCodeInput.value);
});
remoteRoomCodeInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") void beginRemoteRoom("join");
});
onlineServerInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") void beginRemoteRoom("create");
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
  if (matchMode === "online") {
    stopOnlineConnection(true);
    void stopLanHost();
    void lanApi?.stopDiscovery();
  }
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
    } else if (pendingJoinRoomCode) {
      onlineConnection.send({ type: "cancel_join" });
    }
    window.setTimeout(() => {
      onlineConnection.close();
      void stopLanHost();
    }, 80);
    stopOnlineReconnect();
    onlineSnapshot = null;
    onlineActionPending = false;
    pendingJoinRoomCode = null;
    pendingJoinRequestId = null;
    void lanApi?.stopDiscovery();
  }
  currentView = "home";
  selectedIndex = null;
  setRulesOpen(false);
  renderView();
}

async function openOnline(mode: OnlineNetworkMode): Promise<void> {
  if (mode === "lan" && !lanSupported) return;
  stopAiTurn();
  if (matchMode === "online" && onlineSnapshot?.phase === "ended") {
    onlineConnection.close();
    await stopLanHost();
  }
  matchMode = "online";
  onlineNetworkMode = mode;
  currentView = "online";
  selectedIndex = null;
  setRulesOpen(false);
  onlineSnapshot = null;
  onlineActionPending = false;
  pendingJoinRoomCode = null;
  pendingJoinRequestId = null;
  const storedSession = loadOnlineSession(sessionStorage);
  onlineSession = storedSession?.networkMode === mode ? storedSession : null;
  if (onlineSession && mode === "remote") onlineServerInput.value = onlineSession.endpoint;
  if (mode === "lan" && lanApi) {
    lanNetworks = [];
    lanNetworksLoaded = false;
    void Promise.all([lanApi.startDiscovery(), lanApi.getNetworks()]).then(([rooms, networks]) => {
      lanRooms = rooms;
      lanNetworks = networks;
      lanNetworksLoaded = true;
      renderOnline();
    }).catch(() => {
      lanNetworksLoaded = true;
      showOnlineError("无法搜索局域网房间，请检查系统网络权限");
      renderOnline();
    });
  } else {
    void lanApi?.stopDiscovery();
  }
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
  matchModeLabelElement.textContent = matchMode === "online" ? onlineModeLabel() : "人机大战";
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
  resultModeLabelElement.textContent = matchMode === "online" ? `${onlineModeLabel()}已定` : "本局已定";
  resultSecondaryLabelElement.textContent = matchMode === "online" ? onlineNetworkMode === "lan" ? "返回局域网" : "返回公网" : "选择难度";
  resultPrimaryLabelElement.textContent = matchMode === "online" ? onlineNetworkMode === "lan" && !hostingLan ? "查找房间" : "再开一房" : "再来一局";
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
  const joining = Boolean(pendingJoinRoomCode) && !onlineSession;
  const resumable = onlineSession?.networkMode === onlineNetworkMode;
  onlineKickerElement.textContent = onlineNetworkMode === "lan" ? "同网相逢" : "远程联机";
  onlineTitleElement.textContent = onlineModeLabel();
  onlineEntryElement.hidden = waiting;
  onlineRoomElement.hidden = !waiting;
  lanEntryPanel.hidden = onlineNetworkMode !== "lan" || joining;
  remoteEntryPanel.hidden = onlineNetworkMode !== "remote" || joining;
  joinPendingPanel.hidden = !joining;
  if (pendingJoinRoomCode) joinPendingRoomCodeElement.textContent = pendingJoinRoomCode;
  lanRoomListElement.innerHTML = lanSupported
    ? lanRooms.length > 0
      ? lanRooms.map((room) => `<button class="lan-room-button" type="button" data-lan-room-code="${room.roomCode}"${onlineBusy ? " disabled" : ""}><strong>${room.roomCode}</strong><span>${escapeHtml(room.host)}</span></button>`).join("")
      : '<p class="lan-room-empty">暂未发现可加入的房间</p>'
    : "";
  onlineServerInput.disabled = onlineBusy;
  joinRoomCodeInput.disabled = onlineBusy;
  remoteRoomCodeInput.disabled = onlineBusy;
  createRoomButton.disabled = onlineBusy || !lanSupported;
  joinRoomButton.disabled = onlineBusy || !lanSupported;
  remoteCreateRoomButton.disabled = onlineBusy;
  remoteJoinRoomButton.disabled = onlineBusy;
  cancelJoinButton.disabled = onlineBusy || onlineConnectionState !== "connected";
  resumeRoomButton.hidden = !resumable || Boolean(onlineSnapshot) || joining;
  resumeRoomButton.disabled = onlineBusy;

  const connectionLabel = onlineConnectionState === "connecting"
    ? onlineReconnectAttempt > 0 ? "正在重连" : "正在连接"
    : onlineConnectionState === "connected"
      ? joining ? "等待房主同意"
        : waiting
        ? onlineSnapshot?.seats.red.occupied && onlineSnapshot.seats.black.occupied ? "等待双方准备" : "等待对手加入"
        : "已连接"
      : resumable && !onlineSnapshot ? "可以恢复上次房间"
        : onlineNetworkMode === "lan" ? lanNetworkLabel()
        : "未连接";
  onlineConnectionStatusElement.textContent = connectionLabel;
  onlineStatusLine.dataset.state = onlineConnectionState === "connected" ? "connected" : onlineConnectionState === "connecting" ? "connecting" : "idle";

  joinRequestPanel.hidden = !waiting || !pendingJoinRequestId || onlineSession?.seat !== "red";
  acceptJoinButton.disabled = onlineBusy;
  rejectJoinButton.disabled = onlineBusy;
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

async function beginLanHost(): Promise<void> {
  if (!lanApi || onlineBusy) return;
  clearOnlineErrors();
  onlineBusy = true;
  renderOnline();
  try {
    const host = await lanApi.startHost();
    hostingLan = true;
    await connectOnlineRoom("create", host.endpoint, "", true);
  } catch {
    onlineBusy = false;
    hostingLan = false;
    await lanApi.stopHost().catch(() => {});
    showOnlineError("无法创建局域网房间，请检查系统网络权限");
    renderOnline();
  }
}

async function joinLanRoom(input: string): Promise<void> {
  if (!lanApi || onlineBusy) return;
  const roomCode = normalizeRoomCode(input);
  if (!isValidRoomCode(roomCode)) {
    showOnlineError("请输入六位房间码");
    return;
  }
  const room = lanRooms.find((candidate) => candidate.roomCode === roomCode);
  if (!room) {
    showOnlineError("没有在局域网内发现这个房间");
    return;
  }
  joinRoomCodeInput.value = roomCode;
  await connectOnlineRoom("join", room.endpoint, roomCode, false);
}

async function beginRemoteRoom(kind: "create" | "join"): Promise<void> {
  if (onlineBusy) return;
  let endpoint: string;
  try {
    endpoint = normalizeServerAddress(onlineServerInput.value);
  } catch {
    showOnlineError("请检查服务器地址");
    return;
  }
  const roomCode = normalizeRoomCode(remoteRoomCodeInput.value);
  if (kind === "join" && !isValidRoomCode(roomCode)) {
    showOnlineError("请输入六位房间码");
    return;
  }
  await connectOnlineRoom(kind, endpoint, roomCode, false);
}

async function connectOnlineRoom(kind: "create" | "join", endpoint: string, roomCode: string, joinApproval: boolean): Promise<void> {
  clearStoredOnlineSession();
  onlineSnapshot = null;
  pendingJoinRoomCode = null;
  pendingJoinRequestId = null;
  lastOnlineEndpoint = endpoint;
  if (onlineNetworkMode === "remote") onlineServerInput.value = endpoint;
  clearOnlineErrors();
  onlineBusy = true;
  renderOnline();
  try {
    await onlineConnection.connect(endpoint);
    const sent = kind === "create"
      ? onlineConnection.send(joinApproval ? { type: "create_room", joinApproval: true } : { type: "create_room" })
      : onlineConnection.send({ type: "join_room", roomCode });
    if (!sent) throw new Error("CONNECTION_CLOSED");
  } catch (error) {
    onlineBusy = false;
    if (!showCompatibilityError(error)) showOnlineError("无法连接服务器，请检查地址和服务器状态");
    if (hostingLan) await stopLanHost();
    renderOnline();
  }
}

async function resumeOnlineRoom(automatic: boolean): Promise<void> {
  const session = onlineSession ?? loadOnlineSession(sessionStorage);
  if (!session || onlineBusy) return;
  if (session.networkMode === "lan" && !lanSupported) {
    showOnlineError("局域网房间只能在桌面客户端中恢复");
    return;
  }
  onlineSession = session;
  onlineNetworkMode = session.networkMode;
  lastOnlineEndpoint = session.endpoint;
  onlineBusy = true;
  clearOnlineErrors();
  renderOnline();
  try {
    await onlineConnection.connect(session.endpoint);
    if (!onlineConnection.send({ type: "resume", roomCode: session.roomCode, reconnectToken: session.reconnectToken })) {
      throw new Error("CONNECTION_CLOSED");
    }
  } catch (error) {
    onlineBusy = false;
    if (!showCompatibilityError(error, Boolean(onlineSnapshot))) {
      if (automatic) scheduleOnlineReconnect();
      else showOnlineError("恢复失败，请检查服务器状态");
    }
    renderOnline();
  }
}

function handleOnlineMessage(message: ServerMessage): void {
  if (message.type === "welcome") return;
  if (message.type === "join_pending") {
    onlineBusy = false;
    pendingJoinRoomCode = message.roomCode;
    renderOnline();
    return;
  }
  if (message.type === "join_requested") {
    pendingJoinRequestId = message.joinRequestId;
    onlineBusy = false;
    void setLanRoomOpen(false);
    renderOnline();
    return;
  }
  if (message.type === "join_rejected") {
    const wasJoining = Boolean(pendingJoinRoomCode);
    pendingJoinRoomCode = null;
    pendingJoinRequestId = null;
    onlineBusy = false;
    if (onlineSession?.seat === "red" && onlineSnapshot?.phase === "waiting" && !onlineSnapshot.seats.black.occupied) {
      void setLanRoomOpen(true);
    }
    showOnlineError(joinRejectedMessage(message.reason), Boolean(onlineSnapshot));
    if (wasJoining) window.setTimeout(() => onlineConnection.close(), 80);
    renderOnline();
    return;
  }
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
    pendingJoinRoomCode = null;
    pendingJoinRequestId = null;
    currentView = "online";
    void stopLanHost();
    showOnlineError("房间已经关闭");
    renderOnline();
    renderView();
    return;
  }
  if (message.type === "room_joined") {
    onlineBusy = false;
    onlineReconnectAttempt = 0;
    stopOnlineReconnect();
    pendingJoinRoomCode = null;
    pendingJoinRequestId = null;
    onlineSession = {
      endpoint: lastOnlineEndpoint,
      roomCode: message.roomCode,
      reconnectToken: message.reconnectToken,
      seat: message.seat,
      networkMode: onlineNetworkMode,
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
  if (snapshot.seats.black.occupied) pendingJoinRequestId = null;
  clearOnlineErrors();
  if (hostingLan && onlineSession?.seat === "red") {
    const open = snapshot.phase === "waiting" && !snapshot.seats.black.occupied;
    void setLanRoomOpen(open);
  }
  if (snapshot.phase === "playing" || snapshot.phase === "ended") {
    matchMode = "online";
    currentView = "game";
    if (snapshot.phase === "ended") clearOnlineSession(sessionStorage);
    void lanApi?.stopDiscovery();
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
  if (connectionState === "closed" && !intentional && pendingJoinRoomCode) {
    pendingJoinRoomCode = null;
    showOnlineError("与房主的连接已经断开");
  }
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

function respondToJoinRequest(accept: boolean): void {
  if (!pendingJoinRequestId || onlineConnectionState !== "connected") return;
  const message = accept
    ? { type: "accept_join" as const, joinRequestId: pendingJoinRequestId }
    : { type: "reject_join" as const, joinRequestId: pendingJoinRequestId };
  if (!onlineConnection.send(message)) return;
  onlineBusy = true;
  renderOnline();
}

function cancelPendingJoin(): void {
  if (!pendingJoinRoomCode) return;
  onlineConnection.send({ type: "cancel_join" });
  pendingJoinRoomCode = null;
  onlineBusy = false;
  window.setTimeout(() => onlineConnection.close(), 80);
  renderOnline();
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
  pendingJoinRoomCode = null;
  pendingJoinRequestId = null;
  stopOnlineReconnect();
  currentView = goToHome ? "home" : "online";
  window.setTimeout(() => {
    onlineConnection.close();
    void stopLanHost();
  }, 80);
  renderOnline();
  renderView();
}

async function createAnotherOnlineRoom(): Promise<void> {
  const networkMode = onlineSession?.networkMode ?? onlineNetworkMode;
  const wasLanHost = hostingLan;
  const endpoint = onlineSession?.endpoint ?? lastOnlineEndpoint;
  stopOnlineConnection(true);
  if (wasLanHost) await stopLanHost();
  onlineServerInput.value = endpoint;
  await openOnline(networkMode);
  if (networkMode === "lan") {
    if (wasLanHost) await beginLanHost();
    return;
  }
  await beginRemoteRoom("create");
}

function stopOnlineConnection(clearSession: boolean): void {
  stopOnlineReconnect();
  onlineConnection.close();
  onlineSnapshot = null;
  onlineActionPending = false;
  pendingJoinRoomCode = null;
  pendingJoinRequestId = null;
  onlineBusy = false;
  if (clearSession) clearStoredOnlineSession();
}

function clearStoredOnlineSession(): void {
  clearOnlineSession(sessionStorage);
  onlineSession = null;
}

async function stopLanHost(): Promise<void> {
  if (!hostingLan || !lanApi) return;
  hostingLan = false;
  await lanApi.stopHost().catch(() => {});
}

async function setLanRoomOpen(open: boolean): Promise<void> {
  const roomCode = onlineSession?.roomCode;
  if (!hostingLan || !lanApi || !roomCode) return;
  await lanApi.setAdvertisedRoom({ roomCode, open }).catch(() => {});
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

function showCompatibilityError(error: unknown, inRoom = false): boolean {
  if (!(error instanceof OnlineCompatibilityError)) return false;
  const subject = error.code === "SERVER_VERSION_MISMATCH" ? "游戏版本" : "联机协议";
  const message = `${subject}不兼容：客户端 ${error.expected}，服务器 ${error.actual}。无法创建、加入或恢复房间，请更新客户端或服务器。`;
  showOnlineError(message, inRoom);
  window.alert(message);
  return true;
}

function clearOnlineErrors(): void {
  onlineErrorElement.hidden = true;
  onlineRoomErrorElement.hidden = true;
  onlineErrorElement.textContent = "";
  onlineRoomErrorElement.textContent = "";
}

function joinRejectedMessage(reason: JoinRejectReason): string {
  return {
    rejected: "房主拒绝了加入申请",
    cancelled: "加入申请已经取消",
    timeout: "房主未在规定时间内处理申请",
    disconnected: "申请加入的玩家已经断开",
    host_unavailable: "房主已经离开房间",
  }[reason];
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

function onlineModeLabel(): string {
  return onlineNetworkMode === "lan" ? "局域网对战" : "公网对战";
}

function lanNetworkLabel(): string {
  if (!lanNetworksLoaded) return "正在识别局域网";
  if (lanNetworks.length === 0) return "未检测到可用局域网";
  return `当前局域网 ${lanNetworks.map((network) => `${network.address}（${network.subnet}）`).join(" · ")}`;
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
  createIcons({ icons: { ArrowLeft, Check, ChevronRight, Copy, House, LogIn, LogOut, Network, Play, Plus, RefreshCw, RotateCcw, ScrollText, SlidersHorizontal, Swords, Volume2, VolumeX, Wifi, X } });
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
