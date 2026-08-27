import "./styles.css";
import { createIcons, RotateCcw, ScrollText, Swords, Volume2, VolumeX, X } from "lucide";
import { chooseAiAction } from "./ai";
import {
  COLS,
  RANKS,
  RANK_LABEL,
  RANK_VALUE,
  applyAction,
  countPieces,
  createGame,
  getActivePiece,
  getLegalDestinations,
  type Action,
  type Camp,
  type GameState,
  type LayerMode,
  type Piece,
} from "./game";

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

let state = createGame();
let selectedIndex: number | null = null;
let aiThinking = false;
let soundEnabled = true;
let audioContext: AudioContext | null = null;
let aiTimer: number | null = null;

renderRankList();
render();
hydrateIcons();

boardElement.addEventListener("click", (event) => {
  const clicked = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-cell-index]");
  if (!clicked || aiThinking || state.status !== "playing" || state.turn !== "red") return;
  handleBoardClick(Number(clicked.dataset.cellIndex));
});

element<HTMLButtonElement>("restart-button").addEventListener("click", restartGame);
element<HTMLButtonElement>("result-restart-button").addEventListener("click", restartGame);
soundButton.addEventListener("click", toggleSound);
element<HTMLButtonElement>("rules-button").addEventListener("click", () => setRulesOpen(true));
element<HTMLButtonElement>("close-rules-button").addEventListener("click", () => setRulesOpen(false));
rulesBackdrop.addEventListener("click", () => setRulesOpen(false));
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    selectedIndex = null;
    setRulesOpen(false);
    render();
  }
});

function handleBoardClick(index: number): void {
  const cell = state.board[index];
  const piece = getActivePiece(cell);
  const canFlip = Boolean(cell.base && !cell.base.revealed && !cell.guest);

  if (selectedIndex !== null) {
    if (selectedIndex === index) {
      selectedIndex = null;
      render();
      return;
    }
    if (getLegalDestinations(state, selectedIndex).includes(index)) {
      performAction({ type: "move", from: selectedIndex, to: index });
      return;
    }
  }

  if (piece?.camp === "red") {
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
  const previous = state;
  state = applyAction(state, action);
  if (state === previous) return;
  selectedIndex = null;
  playTone(action.type === "flip" ? "flip" : "move");
  render();
  scheduleAiTurn();
}

function scheduleAiTurn(): void {
  if (state.status !== "playing" || state.turn !== "black") return;
  aiThinking = true;
  render();
  aiTimer = window.setTimeout(() => {
    const action = chooseAiAction(state);
    if (action) {
      state = applyAction(state, action);
      playTone(action.type === "flip" ? "flip" : "move");
    }
    aiThinking = false;
    aiTimer = null;
    render();
  }, 620);
}

function restartGame(): void {
  if (aiTimer !== null) window.clearTimeout(aiTimer);
  state = createGame();
  selectedIndex = null;
  aiThinking = false;
  aiTimer = null;
  render();
  playTone("restart");
}

function render(): void {
  const destinations = selectedIndex === null ? [] : getLegalDestinations(state, selectedIndex);
  boardElement.innerHTML = state.board
    .map((cell, index) => renderCell(cell, index, destinations))
    .join("");

  const isRedTurn = state.turn === "red";
  const statusText = state.status === "won" ? `${state.winner === "red" ? "朱方" : "墨方"}胜` : state.status === "draw" ? "和局" : isRedTurn ? "你的回合" : "墨方回合";
  turnBlockElement.classList.toggle("turn-block--thinking", aiThinking);
  turnSealElement.className = `turn-seal turn-seal--${isRedTurn ? "red" : "black"}`;
  turnSealElement.textContent = isRedTurn ? "朱" : "墨";
  turnLabelElement.textContent = statusText;
  turnDetailElement.textContent = state.status !== "playing" ? "本局已定" : aiThinking ? "正在推演" : selectedIndex === null ? "翻子或行子" : "择一亮格落子";
  roundCountElement.textContent = `第 ${state.moveNumber} 手`;
  boardMessageElement.textContent = state.status !== "playing" ? statusText : aiThinking ? "墨方推演中" : selectedIndex === null ? "朱方先行" : "落子处已标亮";
  redCountElement.textContent = String(countPieces(state, "red"));
  blackCountElement.textContent = String(countPieces(state, "black"));
  redFallenElement.innerHTML = renderFallen("red");
  blackFallenElement.innerHTML = renderFallen("black");
  moveLogElement.innerHTML = state.log.map((entry) => `<li>${entry}</li>`).join("");

  resultBannerElement.hidden = state.status === "playing";
  if (state.status === "won") {
    resultSealElement.textContent = state.winner === "red" ? "胜" : "负";
    resultTitleElement.textContent = state.winner === "red" ? "朱方获胜" : "墨方获胜";
  } else if (state.status === "draw") {
    resultSealElement.textContent = "和";
    resultTitleElement.textContent = "势均力敌";
  }
}

function renderCell(cell: GameState["board"][number], index: number, destinations: number[]): string {
  const activePiece = getActivePiece(cell);
  const isSelected = selectedIndex === index;
  const isLegalTarget = destinations.includes(index);
  const isLastFrom = state.lastAction?.type === "move" && state.lastAction.from === index;
  const isLastTo = (state.lastAction?.type === "move" && state.lastAction.to === index) || (state.lastAction?.type === "flip" && state.lastAction.at === index);
  const cellClass = [
    "board-cell",
    isSelected ? "board-cell--selected" : "",
    isLegalTarget ? "board-cell--legal" : "",
    cell.guest ? "board-cell--locked" : "",
    isLastFrom ? "board-cell--from" : "",
    isLastTo ? "board-cell--to" : "",
  ].filter(Boolean).join(" ");
  const label = cellLabel(cell, index);

  return `<button class="${cellClass}" type="button" role="gridcell" aria-label="${label}" aria-selected="${isSelected}" data-cell-index="${index}">
    <span class="cell-coordinate" aria-hidden="true">${String.fromCharCode(65 + (index % COLS))}${Math.floor(index / COLS) + 1}</span>
    ${renderCellContents(cell, activePiece)}
    ${isLegalTarget ? '<span class="legal-dot" aria-hidden="true"></span>' : ""}
  </button>`;
}

function renderCellContents(cell: GameState["board"][number], activePiece: Piece | null): string {
  if (cell.base && !cell.base.revealed) {
    const below = cell.guestMode === "below" ? renderGuest(cell.guest!, "below") : "";
    const above = cell.guestMode === "above" ? renderGuest(cell.guest!, "above") : "";
    return `${below}<span class="piece-back" aria-hidden="true"><span>兽</span></span>${above}${cell.guest ? '<span class="lock-stamp" aria-hidden="true">锁</span>' : ""}`;
  }
  if (activePiece) return renderPiece(activePiece, "piece--base");
  return '<span class="empty-mark" aria-hidden="true"></span>';
}

function renderPiece(piece: Piece, modifier: string): string {
  const level = RANK_VALUE[piece.rank];
  return `<span class="piece ${modifier} piece--${piece.camp}" aria-hidden="true"><b>${RANK_LABEL[piece.rank]}</b><small>${level}</small></span>`;
}

function renderGuest(piece: Piece, mode: LayerMode): string {
  return `<span class="guest-piece guest-piece--${mode} piece--${piece.camp}" aria-hidden="true"><b>${RANK_LABEL[piece.rank]}</b><small>${mode === "above" ? "墙" : "洞"}</small></span>`;
}

function renderFallen(camp: Camp): string {
  const pieces = state.fallen[camp];
  return pieces.length === 0
    ? '<span class="fallen-empty">无</span>'
    : pieces.map((piece) => `<span class="fallen-piece piece--${piece.camp}" title="${RANK_LABEL[piece.rank]}">${RANK_LABEL[piece.rank]}</span>`).join("");
}

function renderRankList(): void {
  rankListElement.innerHTML = RANKS.map((rank, index) => `<span title="${RANK_LABEL[rank]}">${RANK_LABEL[rank]}<small>${index + 1}</small></span>`).join("");
}

function cellLabel(cell: GameState["board"][number], index: number): string {
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
  createIcons({ icons: { RotateCcw, ScrollText, Swords, Volume2, VolumeX, X } });
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
