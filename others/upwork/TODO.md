# Upwork — TODO

## Build a blockchain portfolio project: AI Agent Vault

Closes the gap the profile admits — no on-chain / smart-contract work yet —
before answering the "Blockchain Technical Leader" invite (draft reply in
`private/proposals/2026-11-14-blockchain-technical-leader.md`, not sent).

An AI agent trades on-chain, but a smart contract bounds what it can do, so a
buggy or compromised agent cannot drain funds. An on-chain successor to the
Crypto.com rotation bot.

- [ ] New public repo `github.com/fanchuanster/agent-vault`, spec-first
      (OpenSpec or Spec Kit), built with Claude Code
- [ ] **Contract** — Solidity + Foundry vault: owner holds funds; the agent key
      may only swap within a per-trade cap, a daily cap and a token/protocol
      allowlist; owner kill switch
- [ ] **Tests** — unit, fuzz and invariant tests ("the agent can never move more
      than X per day"); Slither static analysis
- [ ] **Agent** — Claude-driven agent that reads market data and proposes swaps
      through the vault (the rotation strategy, rebuilt)
- [ ] **Infra** — indexer + status dashboard on Cloudflare Workers, Terraform,
      GitHub Actions CI
- [ ] **Docs** — architecture write-up, threat model, decision records
- [ ] Deploy live on **Base Sepolia** testnet (no real funds)
- [ ] Add it to the master resume and `private/resumes/ai-blockchain.md`, the
      Upwork portfolio, and the invite reply; then send the reply

Target: first working version in 1–2 weeks.
