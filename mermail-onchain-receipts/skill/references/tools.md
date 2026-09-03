# On-chain receipt tools

This workflow **uses** tools owned by other official skills. Do not add them to this skill in `tool-coverage.json`.

Pass structured arguments as **native JSON objects**. Never stringify `query` or `body`. Use the exact host identifier (`search_emails` or `Mermail:search_emails`). Prefer mailbox `public_id` as `mailboxId`.

## Mailbox, mail, and labels

| Tool | Owner | Role |
| --- | --- | --- |
| `list_mailboxes` | `mermail-administer-workspace` | Discover a ready intake mailbox |
| `create_mailbox` | `mermail-administer-workspace` | Provision only when none fits and the user authorizes it |
| `search_emails` / `list_emails` / `get_email` | `mermail-manage-inbox` | Bounded untrusted receipt reads |
| `list_custom_labels` / `create_custom_label` | `mermail-manage-inbox` | Ensure `onchain-confirmed`, `onchain-failed`, `onchain-unknown` |
| `move_email` | `mermail-manage-inbox` | Optional folder filing after lookup |
| `save_draft` | `mermail-compose-email` | Receipt card (`body.body` string) |
| `send_email` / `reply_to_email` | `mermail-compose-email` | Only after an exact preview and fresh approval |

Never use Gmail or Outlook Composio. Never call PayBox / Agent Wallet tools from this workflow.

## Public RPC (not Mermail)

Receipt lookup is a read-only `eth_getTransactionReceipt` / `eth_getTransactionByHash` against the hosts in [workflows.md](workflows.md). It is not an MCP tool and it is not a wallet. Do not send a transaction. Do not ask the user for a private key.
