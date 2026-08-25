export function serializeResults(results, select) {
  // Parse select into a tree structure
  const selectTree = buildSelectTree(select);
  return results.map(row => serializeRow(row, selectTree));
}

function buildSelectTree(select) {
  const tree = { id: true }; // Always include id
  for (const field of select) {
    const parts = field.split('.');
    if (parts.length === 1) {
      tree[parts[0]] = true;
    } else {
      if (!tree[parts[0]] || typeof tree[parts[0]] !== 'object') tree[parts[0]] = {};
      tree[parts[0]][parts[1]] = true;
    }
  }
  return tree;
}

function serializeRow(row, selectTree) {
  if (!row || typeof row !== 'object') return row;
  const result = {};
  for (const [key, spec] of Object.entries(selectTree)) {
    if (!(key in row)) continue;
    if (spec === true) {
      result[key] = row[key] instanceof Date ? row[key].toISOString() : row[key];
    } else if (typeof spec === 'object' && row[key] && typeof row[key] === 'object') {
      // Relation object - serialize its sub-fields
      const subResult = {};
      for (const [subKey, subSpec] of Object.entries(spec)) {
        if (subKey in row[key]) {
          subResult[subKey] = row[key][subKey] instanceof Date ? row[key][subKey].toISOString() : row[key][subKey];
        }
      }
      result[key] = subResult;
    }
  }
  return result;
}
