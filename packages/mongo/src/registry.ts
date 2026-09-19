import { normalizeOperatorNames, ParsingInstruction } from '@ucast/core';
import * as instructions from './instructions';

export const allParsingInstructions = instructions;

export function createParsingInstructionsRegistry(
  extraInstructions: Record<string, ParsingInstruction> = {}
) {
  return normalizeOperatorNames(
    { ...allParsingInstructions, ...extraInstructions },
    name => name.slice(1)
  );
}

export const parsingInstructionsRegistry = createParsingInstructionsRegistry();
