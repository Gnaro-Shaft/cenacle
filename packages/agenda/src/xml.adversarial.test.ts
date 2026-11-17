// The XML of a CalDAV answer (ADR-0042, point 3): no DTD nor entity accepted,
// wherever it stands in the answer — refused, never expanded; the parser's own
// message, which may quote the answer, never passed on; depth and size bounded.
import { describe, expect, it } from "vitest";
import { parseXml, XmlRefused } from "./xml.ts";

const refused = (text: string) => {
  let caught: unknown;
  try {
    parseXml(text);
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(XmlRefused);
  return String(caught);
};

describe("no DTD nor entity, anywhere", () => {
  it.each([
    [
      "a doctype first",
      '<!DOCTYPE d [<!ENTITY x "y">]><d:multistatus xmlns:d="DAV:">&x;</d:multistatus>',
    ],
    ["a doctype after the declaration", '<?xml version="1.0"?>\n<!DOCTYPE a><a/>'],
    ["in lower case", "<!doctype a><a/>"],
    ["an external entity", '<!DOCTYPE a [<!ENTITY e SYSTEM "file:///etc/passwd">]><a>&e;</a>'],
    ["billion laughs", '<!DOCTYPE a [<!ENTITY a "1"><!ENTITY b "&a;&a;&a;">]><a>&b;</a>'],
    ["a declaration after the root", "<a/><!ENTITY x 'y'>"],
    ["a declaration in the middle", "<a><b/><!ELEMENT a ANY><c/></a>"],
    ["inside a CDATA too", "<a><![CDATA[ x ]]><!ATTLIST a b CDATA #IMPLIED></a>"],
  ])("%s: refused", (_, text) => {
    refused(text);
  });

  it("an undefined entity is refused, and the message quotes nothing", () => {
    const message = refused("<a>Rendez-vous &secret-du-client;</a>");
    expect(message).not.toContain("secret-du-client");
    expect(message).not.toContain("Rendez-vous");
  });

  it("the five predefined entities and character references are read", () => {
    expect(parseXml("<a>&lt;&gt;&amp;&quot;&apos;&#233;&#x41;</a>").text).toBe(`<>&"'éA`);
  });

  it("a comment and a CDATA section are fine; the text of a CDATA is not parsed", () => {
    const root = parseXml("<!-- note --><a><![CDATA[BEGIN:VEVENT\n& < >]]></a>");
    expect(root.text).toBe("BEGIN:VEVENT\n& < >");
  });
});

describe("the tree", () => {
  it("namespaces are resolved, whatever the prefixes", () => {
    const a = parseXml('<x:multistatus xmlns:x="DAV:"><x:response/></x:multistatus>');
    const b = parseXml('<multistatus xmlns="DAV:"><response/></multistatus>');
    expect([a.ns, a.name, a.children[0]?.name]).toEqual(["DAV:", "multistatus", "response"]);
    expect([b.ns, b.name]).toEqual(["DAV:", "multistatus"]);
  });

  it("attributes without a namespace are kept", () => {
    const root = parseXml('<c:comp xmlns:c="urn:ietf:params:xml:ns:caldav" name="VEVENT"/>');
    expect(root.attrs).toEqual({ name: "VEVENT" });
  });

  it("malformed, empty, two roots, too deep: refused", () => {
    refused("<a><b></a>");
    refused("");
    refused("<a/><b/>");
    refused(`${"<a>".repeat(100)}${"</a>".repeat(100)}`);
  });
});
