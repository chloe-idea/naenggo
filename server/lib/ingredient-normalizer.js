import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const aliasesPath = path.join(__dirname, '../../public/data/ingredient-aliases.json');
const ingredientAliases = JSON.parse(fs.readFileSync(aliasesPath, 'utf8'));
const aliasLookup = new Map();

function cleanName(value) {
  if (typeof value !== 'string') return '';
  return value.trim().toLocaleLowerCase().replace(/\s+/g, ' ');
}

function comparisonKey(value) {
  return cleanName(value).replace(/\s/g, '');
}

Object.entries(ingredientAliases).forEach(([canonicalName, aliases]) => {
  aliases.forEach((alias) => aliasLookup.set(comparisonKey(alias), canonicalName));
});

export function normalizeIngredientName(value) {
  if (typeof value !== 'string') return '';
  const cleaned = cleanName(value);
  return aliasLookup.get(comparisonKey(cleaned)) || cleaned;
}
