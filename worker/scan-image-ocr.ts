export interface ImageTextExtraction {
  texts: string[];
  warnings: string[];
}

export async function extractImageTexts(
  images: string[],
  localOcrTexts: string[]
): Promise<ImageTextExtraction> {
  const texts = images.map((_, index) => {
    const localText = localOcrTexts[index]?.trim() || '';
    return localText
      ? `[Local OCR hint; may contain errors]\n${localText}`.slice(0, 60_000)
      : '';
  });

  return {
    texts,
    warnings: []
  };
}
