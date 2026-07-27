import Tesseract from 'tesseract.js';

const MAX_IMAGE_COUNT = 5;
const MAX_IMAGE_SIZE = 8 * 1024 * 1024;

/**
 * Prepares an uploaded image for OCR:
 * - limits the maximum image dimensions
 * - converts the image to grayscale
 * - increases contrast
 * - returns a JPEG data URL
 */
export async function preprocessImage(file, maxDimension = 1920) {
  if (!(file instanceof File || file instanceof Blob)) {
    throw new Error('Invalid image file.');
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onerror = () => {
      reject(new Error('The image could not be read.'));
    };

    reader.onload = () => {
      const image = new Image();

      image.onerror = () => {
        reject(new Error('The selected file is not a readable image.'));
      };

      image.onload = () => {
        try {
          const largestDimension = Math.max(
            image.naturalWidth || image.width,
            image.naturalHeight || image.height
          );

          const scale =
            largestDimension > maxDimension
              ? maxDimension / largestDimension
              : 1;

          const width = Math.max(
            1,
            Math.round((image.naturalWidth || image.width) * scale)
          );

          const height = Math.max(
            1,
            Math.round((image.naturalHeight || image.height) * scale)
          );

          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;

          const context = canvas.getContext('2d', {
            willReadFrequently: true
          });

          if (!context) {
            throw new Error('Could not initialize image processing.');
          }

          context.drawImage(image, 0, 0, width, height);

          const imageData = context.getImageData(0, 0, width, height);
          const pixels = imageData.data;

          for (let index = 0; index < pixels.length; index += 4) {
            const red = pixels[index];
            const green = pixels[index + 1];
            const blue = pixels[index + 2];

            const grayscale =
              red * 0.299 +
              green * 0.587 +
              blue * 0.114;

            /*
             * Moderate contrast enhancement is preferable to converting
             * everything to pure black and white. Hard thresholding can
             * remove thin numbers and table lines from schedule images.
             */
            const contrasted = Math.max(
              0,
              Math.min(255, (grayscale - 128) * 1.35 + 128)
            );

            pixels[index] = contrasted;
            pixels[index + 1] = contrasted;
            pixels[index + 2] = contrasted;
          }

          context.putImageData(imageData, 0, 0);

          resolve(canvas.toDataURL('image/jpeg', 0.92));
        } catch (error) {
          reject(
            error instanceof Error
              ? error
              : new Error(String(error))
          );
        }
      };

      image.src = String(reader.result);
    };

    reader.readAsDataURL(file);
  });
}

/**
 * Runs German OCR locally in the browser with Tesseract.js 4.x.
 */
export async function runLocalOCR(dataUrl, onProgress) {
  let worker = null;

  try {
    if (
      !Tesseract ||
      typeof Tesseract.createWorker !== 'function'
    ) {
      throw new Error(
        'Tesseract OCR could not be initialized.'
      );
    }

    worker = await Tesseract.createWorker({
      logger: (message) => {
        if (
          typeof onProgress === 'function' &&
          typeof message?.progress === 'number'
        ) {
          onProgress({
            status: message.status || '',
            progress: message.progress
          });
        }
      }
    });

    await worker.loadLanguage('deu');
    await worker.initialize('deu');

    const result = await worker.recognize(dataUrl);
    return result?.data?.text?.trim() || '';
  } catch (error) {
    console.error('OCR error:', error);

    throw new Error(
      `OCR processing failed: ${
        error instanceof Error
          ? error.message
          : String(error)
      }`
    );
  } finally {
    if (worker) {
      try {
        await worker.terminate();
      } catch (terminationError) {
        console.warn(
          'OCR worker could not be terminated cleanly:',
          terminationError
        );
      }
    }
  }
}

/**
 * Validates one uploaded image.
 */
export function validateImage(file) {
  if (!(file instanceof File || file instanceof Blob)) {
    return 'Invalid image file';
  }

  const allowedMimeTypes = [
    'image/jpeg',
    'image/png',
    'image/webp'
  ];

  if (!allowedMimeTypes.includes(file.type)) {
    return 'Only JPEG, PNG, or WebP images are supported';
  }

  if (file.size > MAX_IMAGE_SIZE) {
    return 'Image must be smaller than 8 MB';
  }

  return null;
}

/**
 * Validates the complete image selection.
 */
export function validateImages(files) {
  const imageFiles = Array.from(files || []);

  if (imageFiles.length === 0) {
    return 'Please select at least one image';
  }

  if (imageFiles.length > MAX_IMAGE_COUNT) {
    return `A maximum of ${MAX_IMAGE_COUNT} images can be uploaded`;
  }

  for (const file of imageFiles) {
    const error = validateImage(file);

    if (error) {
      return `${file.name || 'Image'}: ${error}`;
    }
  }

  return null;
}