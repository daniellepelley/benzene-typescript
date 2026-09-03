import { describe, expect, it } from 'vitest';
import { IServiceResolver } from '@benzenejs/abstractions';
import { Constants, XmlMediaFormat, XmlOptions, XmlSerializer } from '@benzenejs/xml';

/**
 * Port of the Benzene.Xml serialization scenarios, adapted to the fast-xml-parser library. XML is
 * shape-based here (unlike the reflection-driven System.Xml.Serialization.XmlSerializer), so the root
 * element name comes from the payload's runtime constructor and the deserialized result is a plain
 * object with the message's property shape (as every Benzene serializer produces).
 */

class Order {
  constructor(public orderId: string = '') {}
}

describe('XmlSerializer', () => {
  it('serialize roots the XML at the payload constructor name and round-trips', () => {
    const serializer = new XmlSerializer();
    const order = new Order('42');

    const xml = serializer.serialize(order);

    // Rooted at the class name, carrying the property as a child element.
    expect(xml).toContain('<Order>');
    expect(xml).toContain('<orderId>42</orderId>');
    expect(xml).toContain('</Order>');

    const decoded = serializer.deserialize<Order>(xml);
    expect(decoded).toEqual({ orderId: '42' });
  });

  it('keeps element text as strings (no numeric coercion) so values round-trip faithfully', () => {
    const serializer = new XmlSerializer();
    const decoded = serializer.deserialize<Order>(serializer.serialize(new Order('007')));

    // '007' survives as a string rather than being parsed to the number 7.
    expect(decoded).toEqual({ orderId: '007' });
    expect(typeof decoded?.orderId).toBe('string');
  });

  it('honours an explicit root name override', () => {
    const serializer = new XmlSerializer();
    const xml = serializer.serialize({ orderId: '5' }, 'Purchase');

    expect(xml).toContain('<Purchase>');
    expect(serializer.deserialize<{ orderId: string }>(xml)).toEqual({ orderId: '5' });
  });

  it('serialize returns empty string for null/undefined and deserialize returns undefined for empty', () => {
    const serializer = new XmlSerializer();

    expect(serializer.serialize(undefined)).toBe('');
    expect(serializer.serialize(null)).toBe('');
    expect(serializer.deserialize<Order>('')).toBeUndefined();
  });

  // --- W3.7 untrusted-input guards (the .NET #260 / #238 / WP-L contract). The depth bound and the
  // BOM tolerance are guarantees of the fast-xml-parser dependency (verified against 5.10.1) pinned
  // here by test rather than re-implemented — see the XmlSerializer/XmlOptions doc comments. --------

  /** `<a><a>…x…</a></a>` nested `depth` elements deep (under no extra root — the outermost IS the root). */
  function nested(depth: number): string {
    return '<a>'.repeat(depth) + 'x' + '</a>'.repeat(depth);
  }

  it('deserialize accepts nesting at the default maxDepth (32) and rejects one level deeper (#260)', () => {
    const serializer = new XmlSerializer();

    expect(serializer.deserialize(nested(XmlOptions.defaultMaxDepth))).toBeDefined();
    expect(() => serializer.deserialize(nested(XmlOptions.defaultMaxDepth + 1))).toThrow(
      /Maximum nested tags exceeded/,
    );
  });

  it('deserialize rejects a deeply-nested bomb at the cap instead of building the graph (#260)', () => {
    const serializer = new XmlSerializer();

    expect(() => serializer.deserialize(nested(10_000))).toThrow(/Maximum nested tags exceeded/);
  });

  it('honours a configured maxDepth', () => {
    const options = new XmlOptions();
    options.maxDepth = 4;
    const serializer = new XmlSerializer(options);

    expect(serializer.deserialize(nested(4))).toBeDefined();
    expect(() => serializer.deserialize(nested(5))).toThrow(/Maximum nested tags exceeded/);
  });

  it('deserialize accepts a UTF-8-BOM-prefixed body (WP-L)', () => {
    // A body that arrived as UTF-8-with-BOM bytes and was decoded without stripping the BOM: the
    // string starts with U+FEFF. Every other transport in the pipeline accepts it; XML must too.
    const serializer = new XmlSerializer();

    expect(serializer.deserialize<Order>('\uFEFF<Order><orderId>42</orderId></Order>')).toEqual({
      orderId: '42',
    });
    expect(
      serializer.deserialize<Order>('\uFEFF<?xml version="1.0"?><Order><orderId>42</orderId></Order>'),
    ).toEqual({ orderId: '42' });
  });

  it('round-trips null: serialize(null) and deserialize of its output are exact inverses (#238)', () => {
    const serializer = new XmlSerializer();

    const wire = serializer.serialize(null);

    expect(wire).toBe('');
    expect(serializer.deserialize<Order>(wire)).toBeUndefined();
    // C# `Deserialize(null)` also hands back null rather than throwing.
    expect(serializer.deserialize<Order>(null as unknown as string)).toBeUndefined();
  });
});

describe('XmlMediaFormat', () => {
  it('exposes the application/xml content type and returns the XML serializer', () => {
    const serializer = new XmlSerializer();
    const format = new XmlMediaFormat<{ headers: Record<string, string> }>(serializer);

    expect(format.contentType).toBe(Constants.xmlContentType);
    expect(format.contentType).toBe('application/xml');
    expect(format.getSerializer(undefined as unknown as IServiceResolver)).toBe(serializer);
  });
});
