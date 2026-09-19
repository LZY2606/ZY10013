/**
 * Minimal interpreter dispatch micro-benchmark (NOT a general claim).
 * Measures only the shared registry lookup path for a deeply nested query.
 */
import { guard } from '../packages/mongo2js/dist/esm/index.mjs';

const query = {
  $and: [
    { a: { $gt: 0 } },
    { $or: [{ b: { $in: [1, 2, 3] } }, { c: { $gte: 5 } }] },
    { d: { $ne: null } },
    { items: { $elemMatch: { x: 1, y: { $lt: 9 } } } },
  ],
};
const matcher = guard(query);
const object = { a: 1, b: 2, c: 9, d: 'v', items: [{ x: 1, y: 2 }] };

const N = 200_000;
const start = process.hrtime.bigint();
let acc = 0;
for (let i = 0; i < N; i++) acc += matcher(object) ? 1 : 0;
const elapsed = Number(process.hrtime.bigint() - start) / 1e6;
console.log(`iterations: ${N}`);
console.log(`matches: ${acc}`);
console.log(`total ms: ${elapsed.toFixed(1)}`);
console.log(`ns/op: ${(elapsed * 1e6 / N).toFixed(0)}`);
console.log(`node: ${process.version}`);
console.log(`platform: ${process.platform} ${process.arch}`);
