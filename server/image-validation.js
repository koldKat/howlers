'use strict';

const RASTER_IMAGE_RE = /^data:image\/(jpeg|png|webp|gif);base64,([A-Za-z0-9+/]+={0,2})$/;

function matchesRasterSignature(bytes, format) {
  if (format === 'jpeg') return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (format === 'png') return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (format === 'gif') return bytes.length >= 6 && ['GIF87a', 'GIF89a'].includes(bytes.subarray(0, 6).toString('ascii'));
  if (format === 'webp') return bytes.length >= 12
    && bytes.subarray(0, 4).toString('ascii') === 'RIFF'
    && bytes.subarray(8, 12).toString('ascii') === 'WEBP';
  return false;
}

function validateRasterImageDataUrl(value, maxBytes, maxSizeLabel) {
  const match = String(value || '').match(RASTER_IMAGE_RE);
  if (!match) return 'Снимката трябва да е във формат JPEG, PNG, WebP или GIF.';

  const bytes = Buffer.from(match[2], 'base64');
  if (bytes.length > maxBytes) return `Снимката не може да е по-голяма от ${maxSizeLabel}.`;
  if (!matchesRasterSignature(bytes, match[1])) {
    return 'Данните на снимката не отговарят на посочения формат.';
  }
  return null;
}

module.exports = { validateRasterImageDataUrl };
