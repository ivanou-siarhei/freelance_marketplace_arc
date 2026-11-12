/**
 * Canonical dispute record and its hash.
 *
 * The client's reason and evidence link are stored offchain. The hash of this record is committed
 * onchain by `dispute`, so nobody can quietly change the stored reason afterwards. The arbiter and
 * both parties can recompute it from the stored text.
 */
import { keccak256, toHex, type Hex } from 'viem'

export interface DisputeRecordInput {
  jobId: string
  escrowId: string
  reason: string
  evidenceLink: string
}

export function canonicalDispute(input: DisputeRecordInput): string {
  return JSON.stringify({
    v: 1,
    jobId: input.jobId,
    escrowId: input.escrowId,
    reason: input.reason,
    evidenceLink: input.evidenceLink,
  })
}

export function hashDispute(input: DisputeRecordInput): Hex {
  return keccak256(toHex(canonicalDispute(input)))
}
