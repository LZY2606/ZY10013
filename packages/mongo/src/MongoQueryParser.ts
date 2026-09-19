import {
  Condition,
  buildAnd as and,
  ParsingInstruction,
  ObjectQueryParser,
  FieldQueryOperators,
  OperatorRegistry,
  normalizeOperatorNames,
  NamedInstruction,
} from '@ucast/core';
import { MongoQuery } from './types';
import { parsingInstructionsRegistry } from './registry';

export interface ParseOptions {
  field: string
}

type Instructions = Record<string, ParsingInstruction> | OperatorRegistry<NamedInstruction>;

export class MongoQueryParser extends ObjectQueryParser<MongoQuery<any>> {
  constructor(instructions: Instructions = parsingInstructionsRegistry) {
    super(toRegistry(instructions), {
      defaultOperatorName: '$eq',
    });
  }

  parse<Q extends MongoQuery<any>, FQ extends FieldQueryOperators<Q> = FieldQueryOperators<Q>>(
    query: Q | FQ,
    options?: ParseOptions
  ): Condition {
    if (options && options.field) {
      return and(this.parseFieldOperators(options.field, query as FQ));
    }

    return super.parse(query);
  }
}

function toRegistry(instructions: Instructions) {
  if (instructions instanceof OperatorRegistry) {
    return instructions;
  }

  return normalizeOperatorNames(instructions, name => name.slice(1));
}
