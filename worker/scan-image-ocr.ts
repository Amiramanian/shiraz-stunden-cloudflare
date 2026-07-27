import type { Env } from './types';

export interface ImageTextExtraction {
  texts: string[];
  warnings: string[];
}

function decodeImageDataUrl(dataUrl: string): { bytes: Uint8Array; mimeType: string } {
  const match = dataUrl.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=\s]+)$/i);
  if (!match) {
    throw new Error('Invalid image data URL');
  }

  const binary = atob(match[2].replace(/\s+/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return { bytes, mimeType: match[1].toLowerCase() };
}

export async function extractImageTexts(
  env: Env,
  images: string[],
  localOcrTexts: string[]
): Promise<ImageTextExtraction> {
  const documents = images.map((image, index) => {
    const decoded = decodeImageDataUrl(image);
    const extension = decoded.mimeType === 'image/png'
      ? 'png'
      : decoded.mimeType === 'image/webp'
        ? 'webp'
        : 'jpg';
    const buffer = new ArrayBuffer(decoded.bytes.byteLength);
    new Uint8Array(buffer).set(decoded.bytes);
    return {
      name: `uploaded-sheet-${String(index + 1).padStart(2, '0')}.${extension}`,
      blob: new Blob([buffer], { type: decoded.mimeType })
    };
  });

  const warnings: string[] = [];
  let cloudTexts = images.map(() => '');

  try {
    const conversions = await env.AI.toMarkdown(documents, {
      conversionOptions: {
        image: {
          descriptionLanguage: 'de'
        }
      }
    });

    cloudTexts = conversions.map((conversion, index) => {
      if (conversion.format === 'error') {
        warnings.push(
          `Bild ${index + 1}: Cloud-Bilderkennung fehlgeschlagen; lokale OCR wird als Ersatz verwendet.`
        );
        return '';
      }
      return String(conversion.data || '').trim().slice(0, 50_000);
    });
  } catch (error) {
    console.warn(JSON.stringify({
      event: 'scan_tomarkdown_failed',
      message: error instanceof Error ? error.message.slice(0, 180) : 'unknown'
    }));
    warnings.push(
      'Cloud-Bilderkennung war nicht verfügbar; lokale OCR wird als Ersatz verwendet.'
    );
  }

  const texts = images.map((_, index) => {
    const cloudText = cloudTexts[index]?.trim() || '';
    const localText = localOcrTexts[index]?.trim() || '';
    const blocks: string[] = [];

    if (cloudText) {
      blocks.push(`[Cloud image transcription]\n${cloudText}`);
    }
    if (localText) {
      blocks.push(`[Local OCR hint; may contain errors]\n${localText}`);
    }

    return blocks.join('\n\n').slice(0, 60_000);
  });

  return {
    texts,
    warnings: [...new Set(warnings)]
  };
}
