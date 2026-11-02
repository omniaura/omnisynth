// Attempt every cleanup and keep the operation's original failure as the cause.
export async function withCleanup(operation, cleanups) {
  const errors = [];
  let result;
  try { result = await operation(); } catch (error) { errors.push(error); }
  for (const cleanup of cleanups) {
    try { await cleanup(); } catch (error) { errors.push(error); }
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, "Operation and cleanup failed", { cause: errors[0] });
  return result;
}
