/**
 * Rebuilds conversations from pseudonymous keys only (phase 3).
 *
 * A mail's own key and the keys it answers (In-Reply-To, References) all
 * belong to the same conversation; conversations are the connected groups.
 * No address and no subject is needed — nor used: two mails with the same
 * subject are NOT the same conversation unless their headers say so.
 */

export interface Threaded {
  readonly messageKey: string | null;
  readonly threadKeys: readonly string[];
}

/** Groups mails into conversations; returns, for each mail, its group id. */
export function conversationIds(mails: readonly Threaded[]): number[] {
  const parent = new Map<string, string>();
  const find = (key: string): string => {
    let root = key;
    while (parent.get(root) !== root) root = parent.get(root) ?? root;
    let node = key;
    while (node !== root) {
      const next = parent.get(node) ?? root;
      parent.set(node, root);
      node = next;
    }
    return root;
  };
  const add = (key: string) => {
    if (!parent.has(key)) parent.set(key, key);
  };
  const keysOf = (mail: Threaded, index: number) => [
    mail.messageKey ?? `#unkeyed-${index}`,
    ...mail.threadKeys,
  ];

  mails.forEach((mail, index) => {
    const [first, ...rest] = keysOf(mail, index);
    if (first === undefined) return;
    add(first);
    for (const key of rest) {
      add(key);
      parent.set(find(key), find(first));
    }
  });

  const ids = new Map<string, number>();
  return mails.map((mail, index) => {
    const root = find(keysOf(mail, index)[0] ?? "");
    if (!ids.has(root)) ids.set(root, ids.size);
    return ids.get(root) ?? -1;
  });
}

/** Number of conversations with at least two mails. */
export function countConversations(mails: readonly Threaded[]): number {
  const sizes = new Map<number, number>();
  for (const id of conversationIds(mails)) sizes.set(id, (sizes.get(id) ?? 0) + 1);
  return [...sizes.values()].filter((n) => n >= 2).length;
}
