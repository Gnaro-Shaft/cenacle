/**
 * What a question to the CTO may be (ADR-0020): short text, no control
 * character but line breaks and tabs. Apart from the pipeline so that the bot
 * can check a question without loading the model.
 */

export const MAX_QUESTION = 2000;

/** A control character, line feed and tab excepted. */
const hasControl = (text: string): boolean =>
  [...text].some((ch) => {
    const code = ch.charCodeAt(0);
    return (code < 0x20 && ch !== "\n" && ch !== "\t") || code === 0x7f;
  });

export class QuestionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QuestionError";
  }
}

export function validQuestion(question: unknown): string {
  if (typeof question !== "string") throw new QuestionError("la question doit être un texte");
  const text = question.trim();
  if (text === "") throw new QuestionError("la question est vide");
  if (text.length > MAX_QUESTION) {
    throw new QuestionError(`la question dépasse ${MAX_QUESTION} caractères`);
  }
  if (hasControl(text)) throw new QuestionError("la question contient des caractères de contrôle");
  return text;
}
