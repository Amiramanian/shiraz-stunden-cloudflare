import { Tesseract } from 'tesseract.js';

// Canvas-based image preprocessing for better OCR results
export async function preprocessImage(file, maxDim = 1920) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        try {
          // Calculate scale
          const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
          const w = Math.round(img.width * scale);
          const h = Math.round(img.height * scale);

          // Create canvas
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          if (!ctx) throw new Error('Could not get canvas context');

          // Draw original image
          ctx.drawImage(img, 0, 0, w, h);

          // Get image data
          const imageData = ctx.getImageData(0, 0, w, h);
          const data = imageData.data;

          // Convert to grayscale and improve contrast
          for (let i = 0; i < data.length; i += 4) {
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];
            const gray = r * 0.299 + g * 0.587 + b * 0.114;
            data[i] = data[i + 1] = data[i + 2] = gray;
          }

          // Apply contrast enhancement
          const threshold = 128;
          for (let i = 0; i < data.length; i += 4) {
            data[i] = data[i] > threshold ? 255 : 0;
            data[i + 1] = data[i + 1] > threshold ? 255 : 0;
            data[i + 2] = data[i + 2] > threshold ? 255 : 0;
          }

          ctx.putImageData(imageData, 0, 0);

          // Convert to data URL (JPEG quality 0.9)
          resolve(canvas.toDataURL('image/jpeg', 0.9));
        } catch (error) {
          reject(error);
        }
      };
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Local Tesseract OCR
export async function runLocalOCR(dataUrl) {
  try {
    const worker = await Tesseract.createWorker('deu'); // German language
    const result = await worker.recognize(dataUrl);
    const text = result.data.text || '';
    await worker.terminate();
    return text;
  } catch (error) {
    console.error('OCR error:', error);
    throw new Error(`OCR processing failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// Validate image before processing
export function validateImage(file) {
  const validMimes = ['image/jpeg', 'image/png', 'image/webp'];
  if (!validMimes.includes(file.type)) {
    return 'Only JPEG, PNG, or WebP images are supported';
  }
  if (file.size > 50 * 1024 * 1024) {
    return 'Image must be smaller than 50MB';
  }
  return null;
}
