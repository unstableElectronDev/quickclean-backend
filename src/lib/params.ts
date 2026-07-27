// Express 5 types route params as `string | string[]` to support repeated
// param patterns; none of our routes use those, so this just narrows back
// down to a single string before we hand it to BigInt().
export function idParam(value: string | string[]): bigint {
  return BigInt(Array.isArray(value) ? value[0] : value);
}
