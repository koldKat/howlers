'use strict';

function normalizeName(value) {
  return String(value || '').trim().toLocaleLowerCase('bg-BG');
}

function calculateAgeAtDate(dob, referenceDate) {
  if (!dob || !referenceDate) return '';
  const birth = new Date(`${dob}T12:00:00`);
  const reference = new Date(`${referenceDate}T12:00:00`);
  if (Number.isNaN(birth.getTime()) || Number.isNaN(reference.getTime()) || reference < birth) return '';

  let years = reference.getFullYear() - birth.getFullYear();
  let months = reference.getMonth() - birth.getMonth();
  if (reference.getDate() < birth.getDate()) months -= 1;
  if (months < 0) { years -= 1; months += 12; }
  if (years < 0) return '';
  if (years > 0) return months > 0 ? `${years} г. ${months} мес.` : `${years} г.`;
  return months > 0 ? `${months} мес.` : 'под 1 месец';
}

function buildMultiChildAgeNote(childNames, kids, happenedOn) {
  if (!Array.isArray(childNames) || childNames.length < 2) return '';
  const kidsByName = new Map((kids || []).map(kid => [normalizeName(kid.name), kid]));
  const ages = childNames.map(name => {
    const kid = kidsByName.get(normalizeName(name));
    const age = calculateAgeAtDate(kid?.dob, happenedOn);
    return age ? `${name}: ${age}` : '';
  }).filter(Boolean);
  return ages.length > 1 ? ages.join('; ') : '';
}

module.exports = { buildMultiChildAgeNote, calculateAgeAtDate };
