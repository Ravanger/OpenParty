import type { GameConnectionManager } from "@openparty/game-client";
import { END_GAME, LOBBY_PHASE, PAUSE_GAME, RESUME_GAME } from "@openparty/shared";
import type { BaseGameState } from "@openparty/shared/schema";

/** Leave, and for the host end the game or pause/resume the room: shown in every phase except the lobby, which has its own leave button. */
export class GameControlsViewModel<TState extends BaseGameState> {
  confirmingEnd = $state(false);
  menuOpen = $state(false);

  constructor(
    private readonly manager: GameConnectionManager<TState>,
    private readonly gameOver: (state: TState) => boolean = () => false,
  ) {}

  /** True while connected and outside the lobby. */
  get isVisible(): boolean {
    const { status, state } = this.manager;
    const connected = status === "connected" || status === "reconnecting";
    return connected && state !== undefined && state.phase !== LOBBY_PHASE;
  }

  /** True while in the room without a seat. */
  get isSpectator(): boolean {
    return this.manager.isSpectator;
  }

  /** True once the game's own predicate reports the state as finished. */
  get isGameOver(): boolean {
    const state = this.manager.state;
    return state !== undefined && this.gameOver(state);
  }

  /** True for the host while the controls are visible and the game is not over. */
  get canEndGame(): boolean {
    return this.isVisible && this.manager.isHost && !this.isGameOver;
  }

  /** True while the host has paused the room. */
  get isPaused(): boolean {
    return (this.manager.state?.pausedAt ?? 0) > 0;
  }

  /** True for the host while the controls are visible, the room runs and the game is not over. */
  get canPause(): boolean {
    return this.isVisible && this.manager.isHost && !this.isPaused && !this.isGameOver;
  }

  /** True for the host while the controls are visible and the room is paused. The server accepts `RESUME_GAME` in any phase but the Lobby, so the menu agrees. */
  get canResume(): boolean {
    return this.isVisible && this.manager.isHost && this.isPaused;
  }

  /** Opens or closes the menu and drops any pending end confirmation. */
  toggleMenu(): void {
    this.menuOpen = !this.menuOpen;
    this.confirmingEnd = false;
  }

  /** Closes the menu and drops any pending end confirmation. */
  closeMenu(): void {
    this.menuOpen = false;
    this.confirmingEnd = false;
  }

  /** Asks the user to confirm ending the game. */
  askEnd(): void {
    this.confirmingEnd = true;
  }

  /** Withdraws the end-game confirmation. */
  cancelEnd(): void {
    this.confirmingEnd = false;
  }

  /** Closes the menu and sends `END_GAME`; does nothing unless `canEndGame`. */
  async confirmEnd(): Promise<void> {
    this.closeMenu();
    if (this.canEndGame) await this.manager.sendAction(END_GAME);
  }

  /** Closes the menu and sends `PAUSE_GAME`; does nothing unless `canPause`. */
  async pause(): Promise<void> {
    this.closeMenu();
    if (this.canPause) await this.manager.sendAction(PAUSE_GAME);
  }

  /** Closes the menu and sends `RESUME_GAME`; does nothing unless `canResume`. */
  async resume(): Promise<void> {
    this.closeMenu();
    if (this.canResume) await this.manager.sendAction(RESUME_GAME);
  }

  /** Closes the menu and leaves the room. */
  async leave(): Promise<void> {
    this.closeMenu();
    await this.manager.leave();
  }
}
