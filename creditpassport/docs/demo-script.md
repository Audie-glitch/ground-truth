# Demo recording script (target 3:30, no narration required)

Recorded against the live testnets after deployment. Terminal on the left,
browser on the right at `http://127.0.0.1:43331`. Captions are typed as
terminal comments so the video reads without audio.

| Time | Scene | On screen |
| --- | --- | --- |
| 0:00 | Title | Browser on the landing page. Caption: `# CreditPassport: credit history you can prove. Creditcoin + Attestcoin.` |
| 0:15 | Attestation is real | `npm run cli -- chains` shows Sepolia attested height vs head. Caption: `# Creditcoin attests Sepolia a few minutes behind the head.` |
| 0:35 | Proof of any transaction | `npm run cli -- verify` picks a live Sepolia tx, fetches the proof, precompile says VALID. Caption: `# No key, no gas: the verifier precompile checks a real proof.` |
| 1:00 | A payment happens | `npm run cli -- pay --payee 0x… --amount 250` then `--amount 90 --late`. Show the Sepolia explorer links. Caption: `# Two invoices settled on Sepolia; the second misses its due block.` |
| 1:30 | The agent works | `npm run agent` already running in a second pane: `new InvoicePaid`, `block attested`, `execute sent`, `verified on Creditcoin`, then `executeBatch` if both landed in range, then `underwrote … score … limit`. Caption: `# Scan, wait for attestation, prove, verify on-chain, underwrite.` |
| 2:20 | The passport | Browser: open the payer's passport. Score, limit, available credit. Scroll to the memo and factor table, then the verified payments table; click a Creditcoin verification link and the Sepolia source link. Caption: `# Every row is a proven receipt. The cap is computed on-chain.` |
| 2:55 | Bounded agent | Terminal: `npm run cli -- profile 0x…` shows `credit limit ≤ policy max`. Caption: `# The agent cannot exceed maxCreditLimit; a late-heavy payer gets zero.` Show Bob's passport with the zero cap. |
| 3:15 | Draw | Payer draws cUSD (CLI or wallet); passport shows utilisation bar move. Caption: `# Credit drawn against proven history. No oracle operator anywhere.` |
| 3:30 | End | Landing page; caption with repo URL. |

Notes for recording:

- Start the agent before recording so the attestation wait (~7 minutes) can be
  cut; record the `pay` step, pause, then resume when the agent logs
  `block attested`. Alternatively pay 10 minutes before recording and show the
  agent log scrollback.
- Keep the browser at 1280 px wide so the payments table does not wrap.
- Use the `RecordScreen` tool for capture; save as `creditpassport-demo`.
