'use strict';

const MAX_CHILDREN_PER_ENTRY = 20;
const MAX_CHILD_NAME_LENGTH = 60;

function deduplicateChildNames(values) {
  const childNames = [];
  const seen = new Set();
  for (const value of values) {
    const name = String(value || '').trim();
    const key = name.toLocaleLowerCase('bg-BG');
    if (!name || seen.has(key)) continue;
    seen.add(key);
    childNames.push(name);
  }
  return childNames;
}

function childNamesFromInput(body) {
  const values = Array.isArray(body.childNames) ? body.childNames : [body.childName];
  if (values.some(value => typeof value !== 'string')) {
    return { error: 'Имената на децата трябва да са текст.' };
  }

  const childNames = deduplicateChildNames(values);
  if (!childNames.length) return { error: 'Избери поне едно дете.' };
  if (childNames.length > MAX_CHILDREN_PER_ENTRY) {
    return { error: `Към един запис могат да се добавят до ${MAX_CHILDREN_PER_ENTRY} деца.` };
  }
  if (childNames.some(name => name.length > MAX_CHILD_NAME_LENGTH)) {
    return { error: `Името на всяко дете трябва да е до ${MAX_CHILD_NAME_LENGTH} символа.` };
  }
  return { childNames };
}

function childNamesFromRow(row) {
  let values = [];
  try {
    const parsed = JSON.parse(row.child_names_json || '[]');
    if (Array.isArray(parsed)) values = parsed;
  } catch {}
  if (!values.length && row.child_name) values = [row.child_name];
  return deduplicateChildNames(values);
}

module.exports = {
  childNamesFromInput,
  childNamesFromRow,
};
