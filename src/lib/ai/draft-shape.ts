/**
 * The shape a model reply must have before it is shown as a follow-up draft.
 *
 * Pure, and deliberately the same three clauses as the evaluation harness's
 * draft property (`src/eval/ai.eval.test.ts`): the first line that is not
 * blank must be an exact `Subject:` line with some subject text, and the lines
 * after it must not be empty. The harness keeps its own copy rather than
 * importing this one, so it stays an independent witness.
 *
 * Shape, not content: an injected paragraph under a valid subject line passes.
 * The injection fixtures in the harness are the check for that.
 */
export function isEmailShaped(text: string): boolean {
  const [first, ...rest] = text.split("\n").filter((line) => line.trim() !== "");
  if (first === undefined) return false;
  // The first line is judged as delivered, leading whitespace included, so this
  // predicate can never be looser than the harness's on that clause.
  if (!/^Subject:\s*\S/.test(first)) return false;
  return rest.join("\n").trim() !== "";
}
