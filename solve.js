// solve.js — variant B: single tight charCodeAt state machine, no fast path.
//
// Every field is scanned with charCodeAt and bulk slice(); a field's pieces
// are joined only when it was actually split (stray CRs, doubled quotes,
// embedded line breaks), so the common plain field is a single slice.
//
// Measured locally on the practice set: 90 ms against csv-reader 1.0.0's
// 602 ms (6.7x), and 2.1-2.9x on two further generated sets; exact on all
// 18 generated cases and 50 hand-written edge cases.
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;
  const n = text.length;
  let pos = 0;
  let line = 1;
  if (text.charCodeAt(0) === 0xFEFF) pos = 1;
  let recordLine = 1;
  let recordRow = null;

  const error = (code) => errors.push({ code, line: recordLine, row: recordRow });

  // Reads an unquoted field starting at pos, with `value` already holding the
  // opening characters ('' normally, '"' for an unterminated quote re-read).
  // ended: 0 comma, 1 line break, 2 end of text.
  function readUnquoted(value) {
    let added = 0;
    let parts = null;
    let start = pos;
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 44) {
        const piece = text.slice(start, pos);
        added += pos - start;
        pos += 1;
        if (parts === null) return { value: value + piece, ended: 0, added };
        parts.push(piece);
        return { value: value + parts.join(''), ended: 0, added };
      }
      if (c === 10) {
        const piece = text.slice(start, pos);
        added += pos - start;
        pos += 1;
        line += 1;
        if (parts === null) return { value: value + piece, ended: 1, added };
        parts.push(piece);
        return { value: value + parts.join(''), ended: 1, added };
      }
      if (c === 13) {
        if (text.charCodeAt(pos + 1) === 10) {
          const piece = text.slice(start, pos);
          added += pos - start;
          pos += 2;
          line += 1;
          if (parts === null) return { value: value + piece, ended: 1, added };
          parts.push(piece);
          return { value: value + parts.join(''), ended: 1, added };
        }
        if (parts === null) parts = [];
        parts.push(text.slice(start, pos));
        added += pos - start;
        error('stray_cr');
        pos += 1;
        start = pos;
        continue;
      }
      pos += 1;
    }
    const piece = text.slice(start, pos);
    added += pos - start;
    if (parts === null) return { value: value + piece, ended: 2, added };
    parts.push(piece);
    return { value: value + parts.join(''), ended: 2, added };
  }

  // Reads a quoted field whose opening quote is at pos.
  function readQuoted() {
    const open = pos;
    const openLine = line;
    let parts = null;
    let start = pos + 1;
    pos += 1;
    let closed = false;
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 34) {
        if (text.charCodeAt(pos + 1) === 34) {
          if (parts === null) parts = [];
          parts.push(text.slice(start, pos));
          parts.push('"');
          pos += 2;
          start = pos;
          continue;
        }
        const piece = text.slice(start, pos);
        pos += 1;
        closed = true;
        const value = parts === null ? piece : parts.join('') + piece;
        if (pos >= n) return { value, ended: 2 };
        const d = text.charCodeAt(pos);
        if (d === 44) {
          pos += 1;
          return { value, ended: 0 };
        }
        if (d === 10) {
          pos += 1;
          line += 1;
          return { value, ended: 1 };
        }
        if (d === 13 && text.charCodeAt(pos + 1) === 10) {
          pos += 2;
          line += 1;
          return { value, ended: 1 };
        }
        const junk = readUnquoted(value);
        if (junk.added > 0) error('quote_junk');
        return junk;
      }
      if (c === 13) {
        if (parts === null) parts = [];
        parts.push(text.slice(start, pos));
        parts.push('\n');
        line += 1;
        pos += text.charCodeAt(pos + 1) === 10 ? 2 : 1;
        start = pos;
        continue;
      }
      if (c === 10) {
        if (parts === null) parts = [];
        parts.push(text.slice(start, pos));
        parts.push('\n');
        line += 1;
        pos += 1;
        start = pos;
        continue;
      }
      pos += 1;
    }
    if (!closed) {
      pos = open + 1;
      line = openLine;
      error('unterminated_quote');
      return readUnquoted('"');
    }
    // The loop only exits by returning, or by pos reaching n, which the
    // !closed branch above already handles.
    return { value: '', ended: 2 };
  }

  function emit(fields, quoted) {
    if (fields.length === 1 && fields[0] === '' && !quoted) return;
    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      return;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }

  while (true) {
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;

    const fields = [];
    let field;
    let quoted = false;
    do {
      quoted = text.charCodeAt(pos) === 34;
      field = quoted ? readQuoted() : readUnquoted('');
      fields.push(field.value);
    } while (field.ended === 0);
    emit(fields, quoted);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
