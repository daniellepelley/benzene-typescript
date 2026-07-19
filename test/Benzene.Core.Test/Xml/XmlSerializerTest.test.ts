import { describe, expect, it } from 'vitest';
import { IServiceResolver } from '@benzene/abstractions';
import { Constants, XmlMediaFormat, XmlSerializer } from '@benzene/xml';

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
