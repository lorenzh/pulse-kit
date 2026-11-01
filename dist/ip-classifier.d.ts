/** One category and the CIDRs (`<ip>/<prefix>`, or a bare IP for one address) that belong to it. */
export interface IpRule<C extends string> {
    category: C;
    cidrs: readonly string[];
}
/** Returns the category of an address, or `null` when no rule matches or it is not an IP. */
export type AddressClassifier = (address: string) => string | null;
/** Trims, removes one pair of brackets and a `%zone` suffix. */
export declare function normalizeAddress(value: string): string;
/**
 * Builds a classifier that returns the category of the first rule that matches, in the given
 * order. IPv4-mapped IPv6 addresses match IPv4 rules. A bad CIDR throws `TypeError` here.
 */
export declare function createIpClassifier<C extends string>(rules: readonly IpRule<C>[]): (address: string) => C | null;
