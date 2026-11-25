import { render, screen } from "@testing-library/svelte";
import { tick } from "svelte";
import { describe, expect, it } from "vitest";
import { PausedOverlay } from "../../src/components/index.js";
import { expectNoViolations } from "../support/a11y.js";

const liveRegion = (container: HTMLElement) =>
  container.querySelector<HTMLElement>("[aria-live='polite'][aria-label='Pause state']");

describe("PausedOverlay", () => {
  it("renders nothing visible while running and keeps an empty live region", async () => {
    const { container } = render(PausedOverlay, { paused: false });
    await tick();
    expect(container.querySelector(".paused-overlay")).not.toBeInTheDocument();
    expect(liveRegion(container)?.textContent).toBe("");
  });

  it("shows the overlay and announces the pause on mount while paused", async () => {
    const { container } = render(PausedOverlay, { paused: true });
    await tick();
    expect(screen.getByRole("heading", { name: "Paused" })).toBeInTheDocument();
    expect(liveRegion(container)?.textContent).toBe("Paused");
    await expectNoViolations(container, "PausedOverlay");
  });

  it("announces the resume and hides the overlay", async () => {
    const result = render(PausedOverlay, { paused: true });
    await tick();
    expect(result.container.querySelector(".paused-overlay")).toBeInTheDocument();
    result.rerender({ paused: false });
    await tick();
    expect(result.container.querySelector(".paused-overlay")).not.toBeInTheDocument();
    expect(liveRegion(result.container)?.textContent).toBe("Resumed");
  });

  it("re-announces a second pause", async () => {
    const result = render(PausedOverlay, { paused: false });
    await tick();
    result.rerender({ paused: true });
    await tick();
    expect(result.container.querySelector(".paused-overlay")).toBeInTheDocument();
    expect(liveRegion(result.container)?.textContent).toBe("Paused");
  });
});
