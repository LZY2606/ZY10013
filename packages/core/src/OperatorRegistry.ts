/**
 * Builds a registry whose condition name is derived from the operator name
 * (e.g. Mongo's `$eq` -> `eq`). Duplicate condition names are rejected.
 */
export function normalizeOperatorNames<T>(
  operators: Record<string, OperatorOrAlias<T>>,
  normalizeName: (name: string) => string
): OperatorRegistry<T & { name: string }> {
  const entries = Object.keys(operators).map(name => {
    const value = unwrapAlias(operators[name]);
    const entry = { name: normalizeName(name), ...value } as T & { name: string };
    return [name, entry] as const;
  });

  const normalizedNames = new Set<string>();
  for (const [, entry] of entries) {
    if (normalizedNames.has(entry.name)) {
      throw new Error(`Operator "${entry.name}" is already registered`);
    }
    normalizedNames.add(entry.name);
  }

  return new OperatorRegistry(Object.fromEntries(entries));
}

const ALIAS_MARKER: unique symbol = Symbol('operator alias');

/**
 * Wraps a registry entry to mark it as an alias for another operator.
 */
export interface Alias<T> {
  value: T
}

export type OperatorOrAlias<T> = T | Alias<T>;

/**
 * Wraps a registry entry to mark it as an alias for another operator.
 * Backends use it when they keep canonical implementations as a record
 * (e.g. `{ within, in: alias('within', within) }`); the registry resolves the
 * alias to the canonical entry instead of executing a duplicate mapping.
 */
export function alias<T>(target: string, operator: T): Alias<T> {
  return { [ALIAS_MARKER]: target, value: operator } as unknown as Alias<T>;
}

function inferAliasTarget(operator: unknown): string | undefined {
  if (operator && typeof operator === 'object' && ALIAS_MARKER in (operator as object)) {
    return (operator as { [ALIAS_MARKER]: string })[ALIAS_MARKER];
  }

  return undefined;
}

function unwrapAlias<T>(operator: OperatorOrAlias<T>): T {
  return inferAliasTarget(operator) ? (operator as Alias<T>).value : operator as T;
}

/**
 * Creates a registry from a record plus an explicit alias declaration
 * (`{ canonical: ['alias1', 'alias2'] }`). This is the single shared
 * representation for operator aliases across all backends.
 */
export function createOperatorRegistry<T>(
  operators: Record<string, OperatorOrAlias<T>>,
  aliases: Record<string, readonly string[]> = {}
): OperatorRegistry<T> {
  return new OperatorRegistry(operators, aliases);
}

/**
 * Sealed, stateless registry of named operators.
 *
 * A registry is built once from a plain record of operators (optionally with
 * aliases) and is shared by parsers/interpreters. Repeated interpretation of
 * queries never mutates a registry: extension always produces a new registry
 * (`extend`), and registering the same operator name twice throws instead of
 * silently letting the later registration win.
 */
export class OperatorRegistry<T> {
  private readonly _operators: Map<string, T>;
  private readonly _aliases: Map<string, string>;

  constructor(
    operators: Record<string, OperatorOrAlias<T>> = {},
    aliases: Record<string, readonly string[]> = {}
  ) {
    this._operators = new Map();
    this._aliases = new Map();

    const seenNames = new Set<string>();
    for (const name of Object.keys(operators)) {
      if (seenNames.has(name)) {
        throw new Error(`Operator "${name}" is already registered`);
      }
      seenNames.add(name);
      const target = inferAliasTarget(operators[name]);

      if (target && target !== name && target in operators) {
        this.ensureFreeName(name);
        this._aliases.set(name, target);
      } else {
        this.ensureFreeName(name);
        this._operators.set(name, unwrapAlias(operators[name]));
      }
    }

    for (const name of Object.keys(aliases)) {
      if (!this._operators.has(name)) {
        throw new Error(`Unable to create alias for unknown operator "${name}"`);
      }

      for (const other of aliases[name]) {
        this.ensureFreeName(other);
        this._aliases.set(other, name);
      }
    }
  }

  private ensureFreeName(name: string) {
    if (this._operators.has(name) || this._aliases.has(name)) {
      throw new Error(`Operator "${name}" is already registered`);
    }
  }

  has(name: string): boolean {
    return this._operators.has(name) || this._aliases.has(name);
  }

  resolve(name: string): T | undefined {
    const canonical = this._aliases.get(name);
    if (canonical) {
      return this._operators.get(canonical);
    }

    return this._operators.get(name);
  }

  nameOf(name: string): string {
    return this._aliases.get(name) || name;
  }

  entries(): [string, T][] {
    return Array.from(this._operators.entries());
  }

  extend(
    operators: Record<string, OperatorOrAlias<T>>,
    aliases: Record<string, readonly string[]> = {}
  ): OperatorRegistry<T> {
    for (const name of Object.keys(operators)) {
      if (this.has(name)) {
        throw new Error(`Operator "${name}" is already registered`);
      }
    }

    const current: Record<string, OperatorOrAlias<T>> = {};
    for (const [name, operator] of this._operators) {
      current[name] = operator;
    }

    return new OperatorRegistry<T>({ ...current, ...operators }, {
      ...this.aliasDeclarations(),
      ...aliases,
    });
  }

  private aliasDeclarations(): Record<string, string[]> {
    const result: Record<string, string[]> = {};

    for (const [name, canonical] of this._aliases) {
      result[canonical] = [...(result[canonical] || []), name];
    }

    return result;
  }

  /**
   * Replaces an existing operator and keeps all of its aliases. Use only for
   * deliberate overrides (e.g., adapting an instruction for another context).
   */
  replace(name: string, operator: T): OperatorRegistry<T> {
    const canonical = this._aliases.get(name) || name;

    if (!this._operators.has(canonical)) {
      throw new Error(`Unable to replace unknown operator "${name}"`);
    }

    const operators: Record<string, OperatorOrAlias<T>> = {};
    for (const [key, value] of this._operators) {
      operators[key] = key === canonical ? operator : value;
    }

    return new OperatorRegistry<T>(operators, this.aliasDeclarations());
  }
}
