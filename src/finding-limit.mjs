/** Reject invalid library budgets before comparisons can suppress evidence. */
export function assertFindingLimit(maxFindings) {
  if (!Number.isSafeInteger(maxFindings) || maxFindings < 1 || maxFindings > 10_000) {
    // Do not coerce or stringify an untrusted caller's value (including objects).
    throw new RangeError('maxFindings must be an integer between 1 and 10000');
  }
}
