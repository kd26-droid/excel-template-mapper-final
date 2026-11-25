// Preserve errors we cannot safely associate with a column rather than guessing.
export function parseFactwiseRowErrors(raw, headers) {
  const cells = {};
  const unmapped = [];
  const text = String(raw ?? '').trim();
  if (!text) return { cells, unmapped };
  let parsed;
  try { parsed = JSON.parse(text); } catch {
    try { parsed = JSON.parse(text.replace(/;/g, ',')); } catch {
      return { cells, unmapped: [text] };
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { cells, unmapped: [text] };
  }
  Object.entries(parsed).forEach(([reference, value]) => {
    const values = Array.isArray(value) ? value : [value];
    const codes = values.filter((v) => typeof v === 'string' && v.trim());
    const index = /^[1-9]\d*$/.test(reference) ? Number(reference) - 1 : -1;
    const header = index >= 0 && index < headers.length ? headers[index] : null;
    if (header && codes.length === values.length && codes.length) cells[header] = codes;
    else unmapped.push(`${reference}: ${JSON.stringify(value)}`);
  });
  return { cells, unmapped };
}
