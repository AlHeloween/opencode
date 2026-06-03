import type { Agent, AgentSideConnection } from "@agentclientprotocol/sdk"

// Check what Agent requires
type AgentMembers = keyof Agent
// TypeScript will error here if Agent has required methods we can inspect
declare const _check: AgentMembers
