/** `1 package`, `2 packages`: the noun takes an "s" unless the count is exactly one. */
export const plural = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? "" : "s"}`;
