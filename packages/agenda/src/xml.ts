/**
 * The XML of a CalDAV answer, read by saxes (ADR-0042, point 3): strict,
 * namespace-aware, and no DTD nor entity accepted anywhere in the answer — it
 * is refused, never expanded. The text is checked before the parser sees it
 * (`<!` other than a comment or a CDATA section), and the parser refuses a
 * doctype again; an undefined entity is an error of the parser itself.
 *
 * The answer becomes a small tree of elements, bounded in depth and size.
 */
import { SaxesParser } from "saxes";

export const DAV = "DAV:";
export const CALDAV = "urn:ietf:params:xml:ns:caldav";

const MAX_DEPTH = 64;
const MAX_ELEMENTS = 200_000;

export interface XmlElement {
  readonly ns: string;
  readonly name: string;
  readonly children: XmlElement[];
  /** Its attributes without a namespace, by name (`name` of `<c:comp name="VEVENT"/>`). */
  readonly attrs: Readonly<Record<string, string>>;
  /** The element's own text and CDATA, in order (its children's not included). */
  text: string;
}

export class XmlRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "XmlRefused";
  }
}

/** `<!DOCTYPE`, `<!ENTITY`, `<!ELEMENT`…: anything after `<!` but a comment or a CDATA. */
const DECLARATION = /<!(?!--|\[CDATA\[)/;

/** The tree of an answer; throws XmlRefused on a declaration, a malformed text or a size beyond bounds. */
export function parseXml(text: string): XmlElement {
  if (DECLARATION.test(text)) throw new XmlRefused("declaration refused");
  const parser = new SaxesParser({ xmlns: true });
  const stack: XmlElement[] = [];
  let root: XmlElement | null = null;
  let count = 0;
  parser.on("doctype", () => {
    throw new XmlRefused("doctype refused");
  });
  parser.on("opentag", (tag) => {
    count += 1;
    if (stack.length >= MAX_DEPTH || count > MAX_ELEMENTS) throw new XmlRefused("too large");
    const attrs: Record<string, string> = {};
    for (const attr of Object.values(tag.attributes)) {
      if (attr.uri === "" && attr.prefix === "") attrs[attr.local] = attr.value;
    }
    const element: XmlElement = { ns: tag.uri, name: tag.local, children: [], attrs, text: "" };
    const parent = stack.at(-1);
    if (parent === undefined) root = element;
    else parent.children.push(element);
    stack.push(element);
  });
  parser.on("closetag", () => {
    stack.pop();
  });
  const addText = (t: string) => {
    const current = stack.at(-1);
    if (current !== undefined) current.text += t;
  };
  parser.on("text", addText);
  parser.on("cdata", addText);
  try {
    parser.write(text).close();
  } catch (error) {
    if (error instanceof XmlRefused) throw error;
    // The parser's message may quote the answer: never passed on.
    throw new XmlRefused("malformed");
  }
  if (root === null) throw new XmlRefused("empty");
  return root;
}

/** The children named {ns}name. */
export function childrenOf(element: XmlElement, ns: string, name: string): XmlElement[] {
  return element.children.filter((c) => c.ns === ns && c.name === name);
}

/** The first child named {ns}name, or null. */
export function childOf(element: XmlElement, ns: string, name: string): XmlElement | null {
  return childrenOf(element, ns, name)[0] ?? null;
}

/** Follows a path of {ns}name steps, first match at each step. */
export function pathOf(
  element: XmlElement,
  ...steps: readonly (readonly [string, string])[]
): XmlElement | null {
  let current: XmlElement | null = element;
  for (const [ns, name] of steps) {
    if (current === null) return null;
    current = childOf(current, ns, name);
  }
  return current;
}
