/**
 * Canonical delivery record and its hash.
 *
 * The freelancer submits a note and a link. The record below is serialized in a fixed key order and
 * hashed with keccak256; that hash is what `submitWork` stores onchain. Anyone can recompute it from
 * the stored record to confirm the stored text is the text that was committed.
 *
 * Limit: a hash of a link does not pin what the link points to later. Use immutable or
 * content-addressed links for anything that matters.
 */
import { keccak256, toHex, type Hex } from 'viem'

export interface DeliveryRecordInput {
  jobId: string
  escrowId: string
  note: string
  link: string
}

export function canonicalDelivery(input: DeliveryRecordInput): string {
  return JSON.stringify({
    v: 1,
    jobId: input.jobId,
    escrowId: input.escrowId,
    note: input.note,
    link: input.link,
  })
}

export function hashDelivery(input: DeliveryRecordInput): Hex {
  return keccak256(toHex(canonicalDelivery(input)))
}
