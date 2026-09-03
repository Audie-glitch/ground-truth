# Superteam Earn: Build and Demo a Mermail Agent Skill

Event: https://superteam.fun/earn/listing/build-and-demo-a-mermail-agent-skill
Prize: 500 USDC (250 / 100 / 50 + 50 innovative + 50 best video)
Deadline: **23 September 2026, 13:59 UTC**
Access: `HUMAN_ONLY` — you submit; I cannot.

## Already built

- Official-format skill in `skill/` (`SKILL.md`, `agents/openai.yaml`,
  `references/{tools,security,workflows}.md`).
- Indexes patched: `tool-coverage.json` infrastructure list, `compatibility.json`
  skill count 16, README table, root router, validator persona + scenarios.
- `upstream.patch` applies cleanly on current `Nudgen-Marketing/mermail-skills`
  `main`. `npm test` in that tree: `Validated 16 skills and 71 business tools.`
- Read-only receipt lookup with a live Sepolia check (`scripts/lib.test.mjs`).

## 1. Fork and open the PR (you)

1. Fork https://github.com/Nudgen-Marketing/mermail-skills
2. Apply the patch (commands in the README).
3. `npm test`
4. Push `feat/mermail-onchain-receipts` and open a PR against
   `Nudgen-Marketing/mermail-skills:main`.
5. Title: `add mermail-onchain-receipts skill`
6. Body: this skill files explorer links and 0x payment hashes from a Mermail
   inbox against public RPCs, labels them, and drafts a receipt card. It does
   not own MCP tools, never auto-sends, and never calls PayBox. `npm test`
   passes. If they prefer a proposal issue first, open one with the same
   summary and link the PR.

If you add a fine-grained PAT (Contents + PRs on that fork) as
`GITHUB_FORK_TOKEN`, I can push the branch and open the PR for you.

## 2. Mermail account and live demo (you)

The video must show the skill talking to Mermail, not a code walkthrough.

1. Create a workspace at https://console.mermail.app
2. Connect Mermail MCP in Cursor (OAuth) or set `MERMAIL_API_KEY` for CLI.
3. Send one email to the agent mailbox that contains a real explorer link,
   for example the Sepolia tx
   `0x82b08a2d376cec29b5f53d5301005504d337f99c2193b546dc5457a6a0bbc2f2`.
4. In a fresh agent chat: *File on-chain payment receipts in my Mermail inbox
   from the last seven days. Draft a summary and do not send.*
5. Record 2–5 minutes in English: the prompt, MCP tools running, the RPC
   result, the draft. No send.
6. Upload to X and tag [@Mermailapp](https://x.com/Mermailapp).

## 3. Superteam form

- **Skill description:** Files blockchain payment receipts from a Mermail
  inbox. Searches for explorer links and transaction hashes, verifies each
  hash on public RPCs, labels confirmed versus failed versus unknown, and
  drafts a receipt card. Inbound mail cannot authorize a send or a payment.
- **GitHub Pull Request:** the PR from step 1.
- **Demo video:** the X post from step 2.
- **AI client:** Cursor (or whichever client you recorded).
- **Claim:** you claim at https://superteam.fun/earn/claim/ if they award it.
  Never share a seed phrase.

## Checklist

- [x] Skill written in official format
- [x] `upstream.patch` + mermail-skills `npm test` green
- [x] Receipt lookup tested against a live Sepolia transaction
- [ ] Fork, apply patch, open PR (you)
- [ ] Mermail workspace connected (you)
- [ ] Demo video on X tagging @Mermailapp (you)
- [ ] Superteam submission (you)
