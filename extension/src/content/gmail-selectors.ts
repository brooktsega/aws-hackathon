// Every Gmail DOM assumption lives in this file (design §5). Gmail's markup is
// undocumented and obfuscated, so each entry is a list: primary selector first,
// fallbacks after. When Gmail changes, this is the only file that should need edits.

export const SELECTORS = {
  /** Conversation subject heading. */
  subject: ['h2.hP', '[data-thread-perm-id] h2'],
  /** One container per message in the open conversation, oldest first. */
  message: ['div.adn'],
  /** Message body. Collapsed messages have no body element. */
  body: ['.a3s.aiL', '.a3s'],
  /** Sender element; Gmail puts the address and display name in attributes. */
  sender: ['span.gD[email]', '.gD[email]', '[email].gD'],
  /** Sent-time element; the full timestamp is in the `title` attribute. */
  date: ['span.g3[title]', '.g3[title]'],
  /** Recipient chips. */
  recipient: ['span.g2[email]', '.g2[email]'],
  /** Quoted reply history, removed from a clone before reading text. */
  quoted: ['.gmail_quote', '.gmail_extra', 'blockquote'],
  /** Never part of the readable text. */
  ignored: ['script', 'style', 'noscript', '[hidden]'],
} as const;

export type SelectorKey = keyof typeof SELECTORS;

/** First element matching any selector, trying them in order. */
export function queryFirst(root: ParentNode, key: SelectorKey): Element | null {
  for (const selector of SELECTORS[key]) {
    const el = root.querySelector(selector);
    if (el) return el;
  }
  return null;
}

/** All elements for the first selector that matches anything. */
export function queryAll(root: ParentNode, key: SelectorKey): Element[] {
  for (const selector of SELECTORS[key]) {
    const found = Array.from(root.querySelectorAll(selector));
    if (found.length > 0) return found;
  }
  return [];
}
