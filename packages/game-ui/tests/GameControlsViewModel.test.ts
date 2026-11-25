import { connectedClient } from "@openparty/game-client/testing";
import { BaseGameState } from "@openparty/shared/schema";
import { describe, expect, it, vi } from "vitest";
import { GameControlsViewModel } from "../src/GameControlsViewModel.svelte.js";

const host = (phase = "Play") =>
  connectedClient({ stateClass: BaseGameState, seat: { role: "host" }, phase });

describe("GameControlsViewModel", () => {
  it("is hidden in the lobby, and shown in every other phase", () => {
    const c = host("Lobby");
    const vm = new GameControlsViewModel(c.manager);
    expect(vm.isVisible).toBe(false);
    expect(vm.canEndGame).toBe(false);
    c.state.phase = "Play";
    expect(vm.isVisible).toBe(true);
    c.manager.status = "reconnecting";
    expect(vm.isVisible).toBe(true);
    c.manager.status = "disconnected";
    expect(vm.isVisible).toBe(false);
  });

  it("is hidden without a room", () => {
    const c = host();
    const vm = new GameControlsViewModel(c.manager);
    c.manager.dispose();
    expect(vm.isVisible).toBe(false);
    expect(vm.isGameOver).toBe(false);
  });

  it("lets only the host end the game, after a confirmation", async () => {
    const c = host();
    const vm = new GameControlsViewModel(c.manager);
    expect(vm.canEndGame).toBe(true);
    vm.askEnd();
    expect(vm.confirmingEnd).toBe(true);
    vm.cancelEnd();
    expect(vm.confirmingEnd).toBe(false);
    expect(c.room.requests).toEqual([]);
    vm.askEnd();
    await vm.confirmEnd();
    expect(vm.confirmingEnd).toBe(false);
    expect(c.room.requests).toEqual([{ type: "ACTION", payload: { type: "END_GAME" } }]);
  });

  it("sends nothing for a guest", async () => {
    const c = connectedClient({ stateClass: BaseGameState, phase: "Play" });
    const vm = new GameControlsViewModel(c.manager);
    expect(vm.isVisible).toBe(true);
    expect(vm.canEndGame).toBe(false);
    await vm.confirmEnd();
    expect(c.room.requests).toEqual([]);
  });

  it("leaves the room", async () => {
    const c = host();
    const leave = vi.spyOn(c.manager, "leave").mockResolvedValue();
    await new GameControlsViewModel(c.manager).leave();
    expect(leave).toHaveBeenCalledOnce();
  });

  it("opens and closes the menu, dropping a pending confirmation", () => {
    const vm = new GameControlsViewModel(host().manager);
    vm.toggleMenu();
    expect(vm.menuOpen).toBe(true);
    vm.askEnd();
    vm.toggleMenu();
    expect(vm.menuOpen).toBe(false);
    expect(vm.confirmingEnd).toBe(false);
    vm.toggleMenu();
    vm.askEnd();
    vm.closeMenu();
    expect(vm.menuOpen).toBe(false);
    expect(vm.confirmingEnd).toBe(false);
  });

  it("closes the menu when leaving or ending", async () => {
    const c = host();
    vi.spyOn(c.manager, "leave").mockResolvedValue();
    const vm = new GameControlsViewModel(c.manager);
    vm.toggleMenu();
    await vm.leave();
    expect(vm.menuOpen).toBe(false);
    vm.toggleMenu();
    await vm.confirmEnd();
    expect(vm.menuOpen).toBe(false);
  });

  it("never considers the game over by default", () => {
    const vm = new GameControlsViewModel(host().manager);
    expect(vm.isGameOver).toBe(false);
    expect(vm.canEndGame).toBe(true);
  });

  it("takes the game's rule for being over, and then the host cannot end it", () => {
    const c = host();
    const vm = new GameControlsViewModel(c.manager, (state) => state.phase === "Done");
    expect(vm.canEndGame).toBe(true);
    c.state.phase = "Done";
    expect(vm.isGameOver).toBe(true);
    expect(vm.canEndGame).toBe(false);
  });

  it("knows a TV display", () => {
    const c = host();
    const vm = new GameControlsViewModel(c.manager);
    expect(vm.isSpectator).toBe(false);
    c.state.players.delete(c.manager.playerId);
    expect(vm.isSpectator).toBe(true);
  });

  it("lets only the host pause and resume, closing the menu with either", async () => {
    const c = host();
    const vm = new GameControlsViewModel(c.manager);
    expect(vm.isPaused).toBe(false);
    expect(vm.canPause).toBe(true);
    expect(vm.canResume).toBe(false);
    await vm.resume();
    expect(c.room.requests).toEqual([]); // nothing to resume
    vm.toggleMenu();
    await vm.pause();
    expect(vm.menuOpen).toBe(false);
    expect(c.room.requests).toEqual([{ type: "ACTION", payload: { type: "PAUSE_GAME" } }]);
    c.state.pausedAt = Date.now();
    expect(vm.isPaused).toBe(true);
    expect(vm.canPause).toBe(false);
    expect(vm.canResume).toBe(true);
    await vm.pause(); // already paused: refused locally, nothing sent
    expect(c.room.requests).toHaveLength(1);
    vm.toggleMenu();
    await vm.resume();
    expect(vm.menuOpen).toBe(false);
    expect(c.room.requests).toEqual([
      { type: "ACTION", payload: { type: "PAUSE_GAME" } },
      { type: "ACTION", payload: { type: "RESUME_GAME" } },
    ]);
  });

  it("sends nothing for a guest and offers no pause in the lobby", async () => {
    const c = connectedClient({ stateClass: BaseGameState, phase: "Play" });
    const vm = new GameControlsViewModel(c.manager);
    expect(vm.canPause).toBe(false);
    expect(vm.canResume).toBe(false);
    await vm.pause();
    await vm.resume();
    expect(c.room.requests).toEqual([]);

    const l = host("Lobby");
    const lobbyVm = new GameControlsViewModel(l.manager);
    expect(lobbyVm.isPaused).toBe(false);
    expect(lobbyVm.canPause).toBe(false);
    expect(lobbyVm.canResume).toBe(false);
  });

  it("offers no pause once the game is over", () => {
    const c = host();
    const vm = new GameControlsViewModel(c.manager, (state) => state.phase === "Done");
    c.state.phase = "Done";
    expect(vm.canPause).toBe(false);
    expect(vm.canResume).toBe(false);
  });
});
