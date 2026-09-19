import { Condition } from '../Condition';
import {
  NamedInstruction,
  ParsingInstruction,
  FieldParsingContext,
  ParsingContext,
} from '../types';
import { OperatorRegistry, normalizeOperatorNames } from '../OperatorRegistry';
import { buildAnd } from '../builder';
import { defaultInstructionParsers } from './defaultInstructionParsers';
import {
  identity,
  hasOperators,
  object,
  pushIfNonNullCondition,
  objectKeysSkipIgnore,
} from '../utils';

export type FieldQueryOperators<T extends {}> = {
  [K in keyof T]: T[K] extends {} ? T[K] : never
}[keyof T];

type NamedParsingInstruction = NamedInstruction;
export type ParsingInstructionRegistry =
  | Record<string, ParsingInstruction>
  | OperatorRegistry<NamedParsingInstruction>;

export interface QueryOptions {
  operatorToConditionName?(name: string): string
  defaultOperatorName?: string
  fieldContext?: Record<string, unknown>
  documentContext?: Record<string, unknown>
  useIgnoreValue?: boolean
  mergeFinalConditions?(conditions: Condition[]): Condition
}

export type ObjectQueryFieldParsingContext = ParsingContext<FieldParsingContext & {
  query: {},
  hasOperators<T>(value: unknown): value is T
}>;

export class ObjectQueryParser<
  T extends Record<any, any>,
  U extends FieldQueryOperators<T> = FieldQueryOperators<T>
> {
  private readonly _instructions: OperatorRegistry<NamedParsingInstruction>;
  private _fieldInstructionContext: ObjectQueryFieldParsingContext;
  private _documentInstructionContext: ParsingContext<{ query: {} }>;
  private readonly _options: Required<
  Pick<QueryOptions, 'operatorToConditionName' | 'defaultOperatorName' | 'mergeFinalConditions'>
  >;

  private readonly _objectKeys: typeof Object.keys;

  constructor(instructions: ParsingInstructionRegistry, options: QueryOptions = object()) {
    this.parse = this.parse.bind(this);
    this._options = {
      operatorToConditionName: options.operatorToConditionName || identity,
      defaultOperatorName: options.defaultOperatorName || 'eq',
      mergeFinalConditions: options.mergeFinalConditions || buildAnd,
    };
    this._instructions = this.createRegistry(instructions);
    this._fieldInstructionContext = {
      ...options.fieldContext,
      field: '',
      query: {},
      parse: this.parse,
      hasOperators: <T>(value: unknown): value is T => hasOperators(
        value,
        this._instructions,
        options.useIgnoreValue
      ),
    };
    this._documentInstructionContext = {
      ...options.documentContext,
      parse: this.parse,
      query: {}
    };
    this._objectKeys = options.useIgnoreValue ? objectKeysSkipIgnore : Object.keys;
  }

  private createRegistry(
    instructions: ParsingInstructionRegistry
  ): OperatorRegistry<NamedParsingInstruction> {
    if (instructions instanceof OperatorRegistry) {
      return instructions as OperatorRegistry<NamedParsingInstruction>;
    }

    return normalizeOperatorNames(instructions, this._options.operatorToConditionName);
  }

  setParse(parse: this['parse']) {
    this.parse = parse;
    this._fieldInstructionContext.parse = parse;
    this._documentInstructionContext.parse = parse;
  }

  protected parseField(field: string, operator: string, value: unknown, parentQuery: {}) {
    const instruction = this._instructions.resolve(operator);

    if (!instruction) {
      throw new Error(`Unsupported operator "${operator}"`);
    }

    if (instruction.type !== 'field') {
      throw new Error(`Unexpected ${instruction.type} operator "${operator}" at field level`);
    }

    this._fieldInstructionContext.field = field;
    this._fieldInstructionContext.query = parentQuery;

    return this.parseInstruction(instruction, value, this._fieldInstructionContext);
  }

  protected parseInstruction(
    instruction: NamedInstruction,
    value: unknown,
    context: ParsingContext<{}>
  ) {
    if (typeof instruction.validate === 'function') {
      instruction.validate(instruction, value);
    }

    const parse: typeof instruction.parse = instruction.parse
      || defaultInstructionParsers[instruction.type as keyof typeof defaultInstructionParsers];
    return parse(instruction, value, context);
  }

  protected parseFieldOperators(field: string, value: U) {
    const conditions: Condition[] = [];
    const keys = this._objectKeys(value);

    for (let i = 0, length = keys.length; i < length; i++) {
      const op = keys[i];

      if (!this._instructions.has(op)) {
        throw new Error(`Field query for "${field}" may contain only operators or a plain object as a value`);
      }

      const condition = this.parseField(field, op, value[op as keyof U], value);
      pushIfNonNullCondition(conditions, condition);
    }

    return conditions;
  }

  parse<Q extends T>(query: Q): Condition {
    const conditions = [];
    const keys = this._objectKeys(query);

    this._documentInstructionContext.query = query;

    for (let i = 0, length = keys.length; i < length; i++) {
      const key = keys[i];
      const value = query[key];
      const instruction = this._instructions.resolve(key);

      if (instruction) {
        if (instruction.type !== 'document' && instruction.type !== 'compound') {
          throw new Error(`Cannot use parsing instruction for operator "${key}" in "document" context as it is supposed to be used in  "${instruction.type}" context`);
        }

        pushIfNonNullCondition(
          conditions,
          this.parseInstruction(instruction, value, this._documentInstructionContext)
        );
      } else if (this._fieldInstructionContext.hasOperators<U>(value)) {
        conditions.push(...this.parseFieldOperators(key, value));
      } else {
        pushIfNonNullCondition(
          conditions,
          this.parseField(key, this._options.defaultOperatorName, value, query)
        );
      }
    }

    return this._options.mergeFinalConditions(conditions);
  }
}
