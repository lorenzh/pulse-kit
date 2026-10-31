import { BlockList, isIP } from "node:net";

/** One category and the CIDRs (`<ip>/<prefix>`, or a bare IP for one address) that belong to it. */
export interface IpRule<C extends string> {
  category: C;
  cidrs: readonly string[];
}

/** Returns the category of an address, or `null` when no rule matches or it is not an IP. */
export type AddressClassifier = (address: string) => string | null;

type Family = "ipv4" | "ipv6";

function familyOf(address: string): Family | null {
  switch (isIP(address)) {
    case 4:
      return "ipv4";
    case 6:
      return "ipv6";
    default:
      return null;
  }
}

/** Trims, removes one pair of brackets and a `%zone` suffix. */
export function normalizeAddress(value: string): string {
  let address = value.trim();
  if (address.startsWith("[") && address.endsWith("]")) address = address.slice(1, -1);
  const zone = address.indexOf("%");
  return zone === -1 ? address : address.slice(0, zone);
}

function addCidr(list: BlockList, cidr: string): void {
  const slash = cidr.indexOf("/");
  const address = slash === -1 ? cidr : cidr.slice(0, slash);
  const family = familyOf(address);
  if (family === null) throw new TypeError("invalid CIDR address");
  const max = family === "ipv4" ? 32 : 128;
  const prefixText = slash === -1 ? String(max) : cidr.slice(slash + 1);
  const prefix = /^\d{1,3}$/.test(prefixText) ? Number(prefixText) : Number.NaN;
  if (!(prefix >= 0 && prefix <= max)) throw new TypeError("invalid CIDR prefix");
  list.addSubnet(address, prefix, family);
}

/**
 * Builds a classifier that returns the category of the first rule that matches, in the given
 * order. IPv4-mapped IPv6 addresses match IPv4 rules. A bad CIDR throws `TypeError` here.
 */
export function createIpClassifier<C extends string>(
  rules: readonly IpRule<C>[],
): (address: string) => C | null {
  const lists = rules.map((rule) => {
    const list = new BlockList();
    for (const cidr of rule.cidrs) addCidr(list, cidr);
    return { category: rule.category, list };
  });
  return (value) => {
    const address = normalizeAddress(value);
    const family = familyOf(address);
    if (family === null) return null;
    return lists.find(({ list }) => list.check(address, family))?.category ?? null;
  };
}
