import { ensureMine } from "@openparty/core";
import { countVoted } from "@openparty/core/kits";
import type { WitClashContext } from "./private.js";
import { PlayerPrivate } from "./state.js";

/**
 * A fresh private entry for a player; the create callback every `ensureMine` call site shares. It
 * lives next to {@link VotingSync}, which creates entries on demand, and is re-exported from
 * `round.js` so the other call sites keep their import path.
 */
export const newPlayerPrivate = (): PlayerPrivate => new PlayerPrivate();

/** The two rules a vote publishes: who may vote, and what flags each player's entry gets. */
export interface VotingSyncRules {
  /** Whether a player may vote; sets their `canVote` and counts toward `votesExpected`. */
  mayVote(playerId: string): boolean;
  /** The extra flags to set on a player's private entry, alongside `canVote`. */
  flags(playerId: string, mine: PlayerPrivate): void;
}

/**
 * Publishes the voting state shared by the matchup and tie-breaker votes: per-player flags for
 * every seat that matters (active, or with a remembered entry), plus `votesExpected` and
 * `votesCast` over the round's matchup ballots. One per hook call; holds no state of its own.
 */
export class VotingSync {
  constructor(
    private readonly ctx: WitClashContext,
    private readonly rules: VotingSyncRules,
  ) {}

  run(): void {
    const { state, priv } = this.ctx;
    const active = new Set(this.ctx.activePlayers().map((p) => p.id));
    const eligible: string[] = [];
    for (const player of this.ctx.players()) {
      if (!active.has(player.id) && !state.mine.has(player.id)) continue;
      const mine = ensureMine(this.ctx, state.mine, player.id, newPlayerPrivate);
      const canVote = this.rules.mayVote(player.id);
      if (canVote) eligible.push(player.id);
      mine.canVote = canVote;
      this.rules.flags(player.id, mine);
    }
    state.votesExpected = eligible.length;
    state.votesCast = countVoted(eligible, priv.matchupVotes);
  }
}
